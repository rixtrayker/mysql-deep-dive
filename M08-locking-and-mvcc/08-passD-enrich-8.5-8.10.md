# M08 · Pass D — Enrichment · Concepts 8.5–8.10

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-the-lock-taxonomy.md` + `05-passC-…`. Domain: payments/wallet.

---

## 8.5 · Lock granularity: row vs table (and intention locks)

**🔧 Code-specifics.**
```sql
-- Row-level locking is automatic in InnoDB; intention locks (IS/IX) are taken automatically.
-- Inspect what's locked (mode shows intention + row locks):
SELECT object_name, lock_type, lock_mode, lock_status
FROM performance_schema.data_locks;   -- lock_type: TABLE (IS/IX) vs RECORD; lock_mode: X/S/IX/IS
-- money tables MUST be InnoDB for row locking (MyISAM = table locks, M04/4.12):
SELECT engine FROM information_schema.tables WHERE table_name = 'account';   -- InnoDB
```

**⚠️ Failure modes & gotchas.**
- **MyISAM table locks** → every write serializes the whole table (M04/4.12) — disqualifying for money.
- **Assuming intention locks conflict** — IS/IX are mutually compatible (many txns row-lock in parallel).
- **A table-level operation (DDL) waiting on IX intention locks** → the MDL/table-lock story (8.13).

**💰 Fintech lens.** Transfers to *different* accounts take row locks on different rows → run fully in parallel. Only the *same* hot account serializes (8.15). This is the foundational InnoDB win for payments throughput.

**🎯 Interview / SD angle.** "Row-level locking for concurrency; intention locks (IS/IX) summarize row locks at the table level so a table op checks one flag, not every row." Multi-granularity locking. The reason InnoDB beats MyISAM for concurrent writes.

**✅ Self-check.**
1. Why does row-level locking beat table-level for concurrent writes?
2. What do intention locks (IS/IX) accomplish?
3. Are IS/IX compatible with each other?

---

## 8.6 · Shared vs exclusive locks (the compatibility matrix) ★

**🔧 Code-specifics.**
```sql
-- S (shared) for FOR SHARE; X (exclusive) for FOR UPDATE and all writes; plain SELECT = none (MVCC).
SELECT * FROM account WHERE account_id = 42 FOR SHARE;    -- S — coexists with other S
SELECT * FROM account WHERE account_id = 42 FOR UPDATE;   -- X — excludes everything
-- matrix: S+S ✓ · S+X ✗ · X+S ✗ · X+X ✗
-- ⚠ avoid the S→X upgrade deadlock: take FOR UPDATE (X) up front for read-then-write.
```

**⚠️ Failure modes & gotchas.**
- **S→X upgrade deadlock** — two txns hold S, both try to upgrade to X (8.11). Prefer `FOR UPDATE` up front.
- **Writer starvation** under continuous readers (general RW-lock hazard).
- **Forgetting plain SELECT takes no lock** (MVCC) — it's not in the matrix.

**💰 Fintech lens.** Two `FOR SHARE` reconciliation reads on an account coexist; a transfer's `FOR UPDATE` (X) blocks them. The S/X matrix decides exactly who waits for whom.

**🎯 Interview / SD angle.** "Reads share, writes are exclusive — the readers-writer lock." S+S compatible; X excludes all. Same as RwLock/flock. Know the S→X upgrade-deadlock hazard.

**✅ Self-check.**
1. State the S/X compatibility matrix.
2. Why prefer `FOR UPDATE` over `FOR SHARE`-then-update?
3. Why doesn't a plain SELECT appear in the matrix?

---

## 8.7 · Record, gap & next-key locks ★

**🔧 Code-specifics.**
```sql
-- next-key locks (RR default) on a range FOR UPDATE → lock records AND gaps → block phantom inserts:
START TRANSACTION;  /* RR */
SELECT * FROM account WHERE account_id BETWEEN 40 AND 50 FOR UPDATE;   -- next-key locks the range
-- a concurrent INSERT account_id=43 BLOCKS (gap locked) → phantom prevented (M07/7.13b)
-- inspect lock types:
SELECT lock_mode FROM performance_schema.data_locks;
--   X,REC_NOT_GAP = record · X,GAP = gap · X = next-key
```

**⚠️ Failure modes & gotchas.**
- **Gap/next-key locks cause "surprising" deadlocks** (8.11) — a top RR deadlock cause.
- **Range locking blocks more inserts than necessary** (the whole gap).
- **RC disables gap locks** → phantoms possible (M07/7.9) but fewer deadlocks.

**💰 Fintech lens.** A `FOR UPDATE` over an account's recent entries at RR takes next-key locks, blocking concurrent inserts in that range — phantom prevention for a consistent range op, but also a contention/deadlock source.

**🎯 Interview / SD angle.** "A gap lock locks the *possibility* of a new row, not an existing one — that's how InnoDB prevents phantoms at RR (next-key = record + gap)." Predicate/range locking. RR (next-key) vs RC (record-only) is the phantom-vs-deadlock tradeoff.

**✅ Self-check.**
1. What does a gap lock lock, and why?
2. How do next-key locks prevent phantoms?
3. Why does RC have fewer deadlocks than RR?

---

## 8.8 · Locks are on index records (which index matters)

**🔧 Code-specifics.**
```sql
-- indexed predicate → tight lock footprint:
UPDATE account SET balance = balance - 100 WHERE account_id = 42;   -- PK → ONE record lock
-- unindexed predicate → scans + locks every examined row (potentially the whole table!):
-- UPDATE ledger_entry SET flag=1 WHERE unindexed_col = 'x';        -- ❌ contention bomb
-- diagnose: EXPLAIN the locking statement — type: ALL = locking everything it scans
EXPLAIN UPDATE account SET balance = balance - 100 WHERE account_id = 42;
```

**⚠️ Failure modes & gotchas.**
- **Locking statement on an unindexed column** → locks every scanned row (table-wide) — a notorious contention/deadlock cause.
- **`type: ALL` on a write** = it's locking the whole scan.
- **Gets worse as the table grows** (works fine small, disaster large).

**💰 Fintech lens.** The transfer's PK-based balance update locks one row (tight). A poorly-written unindexed maintenance update on the ledger would lock huge swaths — a contention disaster. Index your locking predicates.

**🎯 Interview / SD angle.** "Locks follow the *access path*, not the result set — an unindexed locking predicate locks everything it scans." Indexing is a *concurrency* requirement, not just speed. `EXPLAIN` a locking statement to see its footprint.

**✅ Self-check.**
1. Why can an unindexed `UPDATE … WHERE` lock the whole table?
2. How do you diagnose an oversized lock footprint?
3. Why is indexing a concurrency concern, not just performance?

---

## 8.9 · Insert-intention & auto-increment locks

**🔧 Code-specifics.**
```sql
-- insert-intention locks (automatic) let concurrent inserts at different positions coexist.
-- auto-inc lock mode (insert-heavy tables):
SHOW VARIABLES LIKE 'innodb_autoinc_lock_mode';   -- 0 traditional / 1 consecutive / 2 interleaved (8.0 default)
-- coordination-free keys avoid the auto-inc serialization point entirely (M03/3.12):
--   id BINARY(16)  -- ULID/UUIDv7, app-generated → no central sequence
```

**⚠️ Failure modes & gotchas.**
- **Auto-inc lock = serialization point** for very-high-insert-rate single tables.
- **Interleaved mode (2) + statement-based binlog** → non-deterministic auto-inc order (M10) — use row-based.
- **Insert-intention conflicts with a gap lock** → a range `FOR UPDATE` blocks inserts (8.7).

**💰 Fintech lens.** The ever-growing `ledger_entry` is insert-heavy → auto-inc behavior (or a time-ordered/coordination-free key, M03/3.12) is a throughput consideration at scale; sharding gives each shard its own sequence (M11/M16).

**🎯 Interview / SD angle.** "A central auto-inc sequence is a concurrency bottleneck under high insert rates → coordination-free keys (ULID/Snowflake) avoid it." Insert-intention locks let non-conflicting inserts proceed. `innodb_autoinc_lock_mode` = concurrency vs consecutiveness.

**✅ Self-check.**
1. Why don't concurrent inserts always block each other (insert-intention)?
2. Why is the auto-inc lock a bottleneck, and how do you avoid it?
3. What does `innodb_autoinc_lock_mode=2` trade?

---

## 8.10 · Two-phase locking & lock lifetime

**🔧 Code-specifics.**
```sql
-- strict 2PL: locks acquired as needed, ALL released at commit/rollback (no early release).
-- → lock lifetime = transaction lifetime → keep transactions SHORT (M07/7.15).
-- find a long txn holding locks others wait on:
SELECT * FROM performance_schema.data_lock_waits;   -- who waits for whom
SELECT trx_id, trx_started, trx_rows_locked FROM information_schema.INNODB_TRX ORDER BY trx_started;
```

**⚠️ Failure modes & gotchas.**
- **Locks held to commit** → a long transaction blocks everyone needing its rows for its whole duration.
- **No early release** — the only lever is transaction duration.
- **Slow/external work inside the transaction** → locks held long → contention (M07/7.15).

**💰 Fintech lens.** A transfer holds the hot account's X lock until commit → every other transfer to that account waits. This is *why* the transfer must be short (external call outside, M07/7.16) and why hot-account contention is so duration-sensitive (8.15).

**🎯 Interview / SD angle.** "Strict 2PL holds locks to commit → lock duration = transaction duration → keep transactions short (you can't release early without breaking correctness)." InnoDB uses MVCC for reads to keep them OUT of 2PL. "Don't do I/O while holding a lock."

**✅ Self-check.**
1. When are locks released under strict 2PL?
2. Why is the only lever for lock-hold time the transaction duration?
3. How does InnoDB keep reads out of 2PL?

---

*Enrichment for 8.5–8.10 complete. Next Pass D file: 8.11–8.16.*
