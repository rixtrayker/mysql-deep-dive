# M04 · Pass D — Enrichment · Concepts 4.10–4.16

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-execution-engine-results-capstone.md` + `06-passC-…`. Domain: payments/wallet. These close out M04.

---

## 4.10 · The execution engine: running the plan

**🔧 Code-specifics.**
```sql
-- EXPLAIN ANALYZE actually RUNS the plan and reports per-operator actual time/rows:
EXPLAIN ANALYZE SELECT * FROM account a JOIN ledger_entry e
  ON e.account_id = a.account_id WHERE a.status_code = 1;
--  '-> Nested loop  (actual time=0.1..12.4 rows=3500 loops=1)'
--    '-> Filter: status_code=1 on account  (rows=120)'      ← driving, streams
--    '-> Index lookup on e using ix_account (rows≈29 loops=120)'  ← inner, per driving row
-- TREE format shows the operator tree without running:
EXPLAIN FORMAT=TREE <query>;
```

**⚠️ Failure modes & gotchas.**
- **Blocking operators** (sort/group/distinct) materialize all input → memory spikes, disk spills (4.13).
- **`EXPLAIN ANALYZE` runs the query** — careful on writes/expensive queries.
- **High `loops` count** on an inner operator signals a large driving set / missing index.

**💰 Fintech lens.** `EXPLAIN ANALYZE` on a slow reconciliation query reveals *where* time goes (which operator, how many loops) — turning "the report is slow" into a precise fix (index the inner lookup, eliminate a sort).

**🎯 Interview / SD angle.** The executor is a **pull-based iterator pipeline**; distinguish **streaming vs blocking** operators. `EXPLAIN ANALYZE` (8.0) reports actuals (time/rows/loops) — the window into this stage. Iterator/Volcano model is universal.

**✅ Self-check.**
1. Streaming vs blocking operator — give an example of each.
2. What does `EXPLAIN ANALYZE` add over `EXPLAIN`?
3. What does a high `loops` count on the inner table suggest?

---

## 4.11 · The storage engine API & pluggable engines ★

**🔧 Code-specifics.**
```sql
SHOW ENGINES;                                  -- InnoDB (default), MEMORY, MyISAM, CSV, …
SHOW TABLE STATUS WHERE name='ledger_entry';   -- Engine column per table
CREATE TABLE scratch (...) ENGINE=MEMORY;       -- volatile in-RAM (transient data)
CREATE TABLE ledger_entry (...) ENGINE=InnoDB;  -- transactional (money tables)
-- Same SELECT runs identically over any engine (SQL layer is engine-agnostic);
-- the GUARANTEES differ (transactions, durability, FKs) — that's 4.12.
```

**⚠️ Failure modes & gotchas.**
- **Capabilities depend on the engine** behind the API (transactions, FKs, crash-safety) — same SQL, different guarantees.
- **Mixing engines** in one transaction → no atomicity across the non-transactional one.
- **Row-at-a-time handler API** historically limited some optimizations.

**💰 Fintech lens.** The engine choice (made via `ENGINE=`) is a **correctness decision**: money tables declare `ENGINE=InnoDB` to get the transactional/crash-safe guarantees the API *allows* engines to provide — the wrong engine silently wouldn't.

**🎯 Interview / SD angle.** MySQL's signature: **SQL layer separated from storage via the handler API**, engine pluggable per table. Strategy-pattern / pluggable-backend at architectural scale (like a VFS). Practical truth: **use InnoDB for everything real**.

**✅ Self-check.**
1. What does the handler API separate, and why is that powerful?
2. Why does the *same* SQL get different guarantees on different engines?
3. Is the engine chosen per server or per table?

---

## 4.12 · InnoDB vs MyISAM (and why InnoDB) ★

**🔧 Code-specifics.**
```sql
-- Money tables: InnoDB, always.
CREATE TABLE ledger_entry (...) ENGINE=InnoDB;
-- Audit a legacy schema for the footgun:
SELECT table_name, engine FROM information_schema.tables
WHERE table_schema='payments' AND engine <> 'InnoDB';     -- any row = a problem
-- Convert a legacy MyISAM table (plan as a migration, M13):
ALTER TABLE legacy_t ENGINE=InnoDB;
```

**⚠️ Failure modes & gotchas.**
- **MyISAM: no transactions** → no atomic debit+credit, no rollback → money can vanish.
- **MyISAM: not crash-safe** → corruption/data loss on crash.
- **MyISAM: table-level locks** → writes serialize the whole table.
- **MyISAM: FKs parsed but silently ignored** → orphaned references.

**💰 Fintech lens (★).** A money table on MyISAM violates *every* requirement: atomicity (M07), durability (M09), concurrency (M08), referential integrity (M01/1.5). **All money tables are InnoDB** — the engine choice *is* a money-safety control, non-negotiable.

**🎯 Interview / SD angle.** "Transactionality, crash-safety, isolation, FKs are **correctness properties, not performance options**." InnoDB is the default and right answer; MyISAM is legacy/cautionary. Naming the four MyISAM failures (esp. silent FK-ignoring) is high-signal.

**✅ Self-check.**
1. Name four guarantees InnoDB gives that MyISAM doesn't.
2. Why is choosing an engine a correctness decision, not a perf knob?
3. What happens to a debit+credit pair on MyISAM if a crash hits between them?

---

## 4.13 · Result handling, buffers & sorting (filesort, temp tables)

**🔧 Code-specifics.**
```sql
-- Spot blocking ops in EXPLAIN Extra:
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42 ORDER BY created_at DESC;
--   Extra: 'Using filesort'   ← sort step; eliminate with an ordered index
--   Extra: 'Using temporary'  ← temp table (GROUP BY/DISTINCT); eliminate with an index
-- The fix: an index that delivers rows already sorted → NO filesort:
ALTER TABLE ledger_entry ADD KEY ix_acct_created (account_id, created_at);
SHOW VARIABLES LIKE 'sort_buffer_size';     -- in-memory threshold (per connection!)
SHOW VARIABLES LIKE 'tmp_table_size';       -- in-memory temp-table threshold
```

**⚠️ Failure modes & gotchas.**
- **"Using filesort" / "Using temporary"** on hot queries → spills to disk = performance cliff.
- **Bumping buffers** just delays the cliff and costs RAM × connections — the real fix is an index.
- **On-disk temp tables** from large GROUP BY/DISTINCT.

**💰 Fintech lens.** "Account's entries newest-first" must read from a `(account_id, created_at)` index in order — no filesort. A high-volume account's statement query spilling to disk is a latency spike on a core screen.

**🎯 Interview / SD angle.** Streaming vs blocking; **the cheapest sort is the one you avoided by reading data already in order.** "Using filesort"/"Using temporary" are top tuning targets (M06). Index to eliminate, don't just enlarge buffers.

**✅ Self-check.**
1. What two EXPLAIN Extra flags signal blocking ops?
2. Why is "bigger sort buffer" a poor primary fix?
3. How does an index eliminate a filesort?

---

## 4.14 · Caching layers in the path (and the dead query cache)

**🔧 Code-specifics.**
```sql
-- The cache that matters — buffer pool (primary memory knob, M09):
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
SHOW STATUS LIKE 'Innodb_buffer_pool_read%';     -- hit behavior (reads vs disk reads)
-- The query cache is GONE in 8.0 — these don't exist:
-- SHOW VARIABLES LIKE 'query_cache_size';   -- not present in 8.0
-- For result caching → external (Redis) with app-controlled invalidation.
```

**⚠️ Failure modes & gotchas.**
- **Recommending/enabling the query cache in 8.0** — it's removed; advice mentioning it is pre-8.0.
- **Undersized buffer pool** → working set spills → disk I/O on every read.
- **Expecting a "result cache"** — the buffer pool caches *pages*, not results.

**💰 Fintech lens.** Repeated balance reads are fast because the buffer pool holds the page — *why compact rows (M03/3.2) matter* (more pages fit). For true result caching of, e.g., expensive dashboards, use Redis with explicit invalidation.

**🎯 Interview / SD angle.** **Query cache removed in 8.0** (common gotcha); the **buffer pool** is the cache that matters (`innodb_buffer_pool_size`). Why the query cache died: coarse invalidation (any write nukes all results) + global mutex → net-negative under concurrency.

**✅ Self-check.**
1. What happened to the query cache, and why?
2. What does the buffer pool actually cache, and why does that help broadly?
3. Where should result caching live now?

---

## 4.15 · Reading a plan: from concept to EXPLAIN (bridge to M06)

**🔧 Code-specifics.**
```sql
EXPLAIN SELECT amount FROM ledger_entry WHERE account_id=42 AND created_at>='2025-06-01';
-- Map each column to an M04 concept:
--   type   → access path (4.8): const/eq_ref/ref/range/index/ALL
--   key    → chosen index (4.6/4.8), or NULL
--   rows   → estimate from statistics (4.7) — compare to reality via EXPLAIN ANALYZE
--   (row order) → join order (4.9)
--   Extra  → Using index (covering) / Using filesort / Using temporary (4.13)
EXPLAIN ANALYZE <query>;     -- actuals; estimate-vs-actual gap → stale stats
```

**⚠️ Failure modes & gotchas.**
- **Reading estimates as truth** — `rows` is an estimate; confirm with `EXPLAIN ANALYZE`.
- **`EXPLAIN ANALYZE` executes** the query (side effects/cost).
- **Tuning without EXPLAIN** — guessing instead of seeing the plan.

**💰 Fintech lens.** The tuning loop for every hot money query: **EXPLAIN → spot `ALL`/filesort/wrong estimate → add index or `ANALYZE TABLE` → re-EXPLAIN** (M01/1.14 made operational). Verify "account's recent entries" uses the index, not a ledger scan.

**🎯 Interview / SD angle.** "To optimize, first make decisions observable." Map EXPLAIN columns (`type`/`key`/`rows`/`Extra`) to access path/index/estimate/blocking ops. `EXPLAIN` (no run) vs `EXPLAIN ANALYZE` (actuals) vs optimizer trace (why). Bridge to M06.

**✅ Self-check.**
1. Map `type`, `key`, `rows`, `Extra` to M04 concepts.
2. `EXPLAIN` vs `EXPLAIN ANALYZE` — difference and when to use each?
3. What does an estimate-vs-actual `rows` gap suggest?

---

## 4.16 · Fintech capstone — the lifecycle of a money query ★

**🔧 Code-specifics.**
```sql
-- The whole lifecycle, in code (correctness at engine layer, speed at plan layer):
START TRANSACTION;                                            -- InnoDB atomic unit (M07)
  INSERT INTO ledger_entry (transaction_id,line_no,account_id,amount,created_at)
    VALUES (700,1,1,-100.00,NOW(6)), (700,2,2,100.00,NOW(6)); -- SUM=0 (M01/1.19)
  UPDATE account SET balance = balance - 100 WHERE account_id = 1;   -- eq_ref PK access (4.8)
  UPDATE account SET balance = balance + 100 WHERE account_id = 2;
COMMIT;                                                       -- redo log → durable (M09)
SELECT balance FROM account WHERE account_id = 1;             -- const lookup, buffer pool (4.8/4.14)
-- Verify the plan: EXPLAIN the UPDATE/SELECT → expect eq_ref/const, not ALL.
```

**⚠️ Failure modes & gotchas.**
- **Non-InnoDB engine** → no atomicity/durability → money loss (4.12).
- **Balance UPDATE doing a full scan** (missing index) → degrades as accounts grow (4.8).
- **Hot-account contention** on the balance row (row lock, M08/M16).
- **Stale stats** → plan regression on the reconciliation read (4.7).

**💰 Fintech lens (★).** Correctness won at the **engine layer** (InnoDB: atomic commit, redo-log durability, row locks, FKs — 4.12, M07–M09); performance won at the **plan layer** (index access paths over the M03-typed, M01/1.14-indexed schema — 4.6–4.9, M05–M06); both observable via EXPLAIN. This trace is the spine the rest of the resource fleshes out.

**🎯 Interview / SD angle.** For any critical query, reason **separately** about: *"what guarantees does the storage layer give?"* (engine/transaction) and *"what plan will the optimizer use?"* (access paths) — won at different layers. Trace a transfer end-to-end naming each stage; that synthesis is the signal.

**✅ Self-check.**
1. Where in the lifecycle is correctness won vs performance won?
2. Which stages guarantee the transfer survives a crash?
3. What two questions should you ask of any critical query?

---

*Enrichment for 4.10–4.16 complete. **M04 Pass D is fully drafted (all 16 concepts) — M04 is now content-complete across Passes A–D.***
