# M13 · Pass D — Enrichment · Concepts 13.6–13.10

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-online-ddl-observability.md` + `05-passC-…`. Domain: payments/wallet, the ledger.

---

## 13.6 · Online schema migrations (the locking problem) ★

**🔧 Code-specifics.**
```bash
# ❌ naive (may COPY-lock a large table for hours):
ALTER TABLE ledger_entry ADD COLUMN note VARCHAR(64);
# ✓ online via gh-ost (binlog-driven shadow, no triggers, throttle/abort):
gh-ost --table=ledger_entry --alter="ADD COLUMN note VARCHAR(64)" \
  --max-lag-millis=1500 --throttle-control-replicas=... --execute   # throttles on lag (M10)
# pattern: shadow → backfill (throttled) → sync → atomic cutover (= resharding M11/11.14)
```

**⚠️ Failure modes & gotchas.**
- **Naive `ALTER` (COPY) on a huge table** → locks out transfers for hours.
- **MDL stall** (M08) — even online DDL takes a brief metadata lock; a long query makes it wait, queuing everything.
- **~2× disk** during the migration; slower than a direct `ALTER`.

**💰 Fintech lens.** Evolve the ledger schema (add a column to a billion-row table) with **gh-ost** — shadow table, binlog sync, throttled backfill (pause on replica lag so reporting replicas don't fall behind), atomic cutover — *without locking out transfers*.

**🎯 Interview / SD angle.** "A naive ALTER locks a large table for the rebuild → hours of downtime. Online DDL builds a new-schema shadow, syncs via the change log, cuts over atomically — the same copy-sync-cutover as resharding, blue-green, CDC. Never modify-in-place-while-locked." Universal online migration.

**✅ Self-check.**
1. Why does a naive `ALTER` lock a large table?
2. Walk the four online-DDL steps.
3. What pattern does this share with resharding/CDC?

---

## 13.7 · gh-ost & pt-online-schema-change

**🔧 Code-specifics.**
```bash
# pt-osc — sync via TRIGGERS (overhead on every write):
pt-online-schema-change --alter "ADD INDEX idx (account_id)" D=payments,t=ledger_entry --execute
# gh-ost — sync via the BINLOG (no triggers, throttle/pause/abort — modern favorite):
gh-ost --alter="..." --max-lag-millis=1500 --execute   # reads binlog like CDC (M12/12.12)
# both: shadow → backfill → sync → atomic cutover; throttle on replication lag (M10)
```

**⚠️ Failure modes & gotchas.**
- **pt-osc triggers** — overhead on every write; conflict with existing triggers/FKs.
- **gh-ost** needs ROW binlog access (M10/10.3).
- **Not throttling on lag** → reporting/reconciliation replicas fall behind.

**💰 Fintech lens.** Migrate the ledger with **gh-ost** (binlog-driven, no trigger overhead on transfers, throttle/pause/abort) — CDC applied to schema change, decoupled from the write path.

**🎯 Interview / SD angle.** "pt-osc syncs via triggers (overhead, coupled); gh-ost syncs via the binlog (no overhead, decoupled, throttle/abort — like CDC). The change log is the better sync primitive (same lesson as CDC) → gh-ost is the modern favorite." Universal.

**✅ Self-check.**
1. Triggers (pt-osc) vs binlog (gh-ost) — the tradeoff?
2. Why is gh-ost "CDC applied to schema migration"?
3. Why throttle on replication lag?

---

## 13.8 · MySQL's own online DDL (and its limits)

**🔧 Code-specifics.**
```sql
ALTER TABLE ledger_entry ADD COLUMN note VARCHAR(64), ALGORITHM=INSTANT;  -- metadata-only, instant
ALTER TABLE ledger_entry ADD INDEX idx (account_id), ALGORITHM=INPLACE;   -- online, but real work
-- ⚠ FORCE the algorithm so it FAILS FAST rather than silently COPY-locking a big table:
ALTER TABLE ... ALGORITHM=INSTANT;   -- errors if it can't → fall back to gh-ost (13.7)
```

**⚠️ Failure modes & gotchas.**
- **Letting MySQL silently `COPY`-lock** a large table (force `ALGORITHM=` to fail fast).
- **Even `INPLACE` takes a brief MDL** (M08 — a long query makes it wait, queuing everything).
- **Not knowing which algorithm** a given change uses → surprise lock.

**💰 Fintech lens.** Add a nullable column to the ledger → `INSTANT` (instant); add an index → `INPLACE` (online, watch load); change a column type → would `COPY`-lock → use **gh-ost** (13.7).

**🎯 Interview / SD angle.** "The DB does SOME changes online natively (INSTANT metadata changes are free, INPLACE rebuilds in place) but not all (some COPY-lock) — know which, use native for the easy ones, a tool for the rest. Metadata-only changes are nearly free; structural rebuilds are expensive." Universal.

**✅ Self-check.**
1. INSTANT vs INPLACE vs COPY — which locks?
2. Why force `ALGORITHM=` to fail fast?
3. Which ledger changes are INSTANT vs need gh-ost?

---

## 13.9 · Observability: metrics, logs, the golden signals ★

**🔧 Code-specifics.**
```sql
SHOW GLOBAL STATUS LIKE 'Threads_connected';   -- saturation (vs max_connections)
SHOW GLOBAL STATUS LIKE 'Rpl_semi_sync_source_status';  -- durability (M10/10.12)
-- slow query log (latency) + error log; scrape into Prometheus/PMM, alert on golden signals
SET GLOBAL slow_query_log = ON; SET GLOBAL long_query_time = 1;
-- golden signals: Latency (p99) · Traffic (QPS/TPS) · Errors (Aborted_connects, deadlocks) · Saturation
```

**⚠️ Failure modes & gotchas.**
- **Flying blind** (minimal monitoring) → problems surface as outages.
- **Alert fatigue** (too many/too tight) → the real alert is ignored.
- **Over-instrumenting** (logging every query) → overhead.

**💰 Fintech lens.** Watch latency/traffic/errors/saturation per shard; alert on the **early-warning signals** (13.11); keep slow/error logs for diagnosis; run **reconciliation** (M12/12.14) as the money-correctness watchdog — so a degrading ledger is caught early.

**🎯 Interview / SD angle.** "Metrics (trends, alertable), logs (diagnosis), traces (distributed) — organized by the golden signals: latency, traffic, errors, saturation. Saturation is the leading indicator. You can't operate what you can't see." Universal observability (SRE).

**✅ Self-check.**
1. The three pillars and the four golden signals?
2. Why is saturation the leading indicator?
3. The overhead-vs-visibility tradeoff?

---

## 13.10 · performance_schema, sys & the slow query log

**🔧 Code-specifics.**
```sql
SELECT * FROM sys.statement_analysis ORDER BY total_latency DESC LIMIT 10;  -- slowest by TOTAL time
SELECT * FROM sys.innodb_lock_waits;          -- what's blocking what (M08)
SELECT * FROM sys.schema_unused_indexes;      -- indexes to drop (M05)
-- slow log → pt-query-digest (rank by TOTAL time) → EXPLAIN (M06) → fix
```

**⚠️ Failure modes & gotchas.**
- **Ranking by single-slowest** instead of total time (a fast query × a million calls dominates).
- **P_S overhead** if over-instrumented (tune the instruments).
- **`long_query_time=0`** (log everything) → heavy.

**💰 Fintech lens.** Find the query causing **replica lag** (slow log + digest + `EXPLAIN`, M06 → a missing index, M05); find **lock waits** on hot accounts (`sys.innodb_lock_waits`, M08). Measurement-driven, not guessing.

**🎯 Interview / SD angle.** "Find the queries that cost the most TOTAL (not the single slowest), understand why (EXPLAIN, lock waits, I/O), fix the biggest wins first. performance_schema → sys views → slow log → pt-query-digest. Optimize what the data says matters." Universal diagnosis (M06 in production).

**✅ Self-check.**
1. Why rank by total time, not single-slowest?
2. Which tool shows what's blocking what (M08)?
3. The find → diagnose → fix loop?

---

*Enrichment for 13.6–13.10 complete. Next Pass D file: 13.11–13.16.*
