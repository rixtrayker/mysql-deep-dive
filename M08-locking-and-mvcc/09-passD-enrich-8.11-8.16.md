# M08 · Pass D — Enrichment · Concepts 8.11–8.16

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-contention-failures-capstone.md` + `06-passC-…`. Domain: payments/wallet. These close out M08.

---

## 8.11 · Deadlocks: detection, victim selection, avoidance ★

**🔧 Code-specifics.**
```sql
-- AVOID: lock accounts in a CONSISTENT order (ascending account_id), regardless of transfer direction:
START TRANSACTION;
  SELECT * FROM account WHERE account_id IN (1, 2) ORDER BY account_id FOR UPDATE;  -- lock lower id first
  UPDATE account SET balance = balance - 100 WHERE account_id = 1;
  UPDATE account SET balance = balance + 100 WHERE account_id = 2;
COMMIT;
-- DETECT (automatic) + inspect the last deadlock:
SHOW ENGINE INNODB STATUS\G          -- "LATEST DETECTED DEADLOCK"
SHOW VARIABLES LIKE 'innodb_deadlock_detect';   -- ON by default
-- RETRY: app catches error 1213 → retry the whole transaction (M07/7.7).
```

**⚠️ Failure modes & gotchas.**
- **Inconsistent lock order** (A→B vs B→A) → deadlock cycle.
- **No retry loop** on 1213 → the victim transaction just fails.
- **Gap locks (RR)** cause surprising deadlocks (8.7); RC reduces them.

**💰 Fintech lens.** Two transfers between the same accounts in opposite directions deadlock unless you lock in consistent `account_id` order. The canonical money deadlock + fix.

**🎯 Interview / SD angle.** "Consistent global lock ordering prevents deadlock cycles (dining philosophers); InnoDB detects + kills the cheapest victim (1213); the app retries." AVOID + DETECT + RETRY. Top interview topic.

**✅ Self-check.**
1. What causes a deadlock, and how does InnoDB resolve it?
2. How does consistent lock ordering prevent it?
3. What must the application do on error 1213?

---

## 8.12 · Lock waits, timeouts & SKIP LOCKED / NOWAIT

**🔧 Code-specifics.**
```sql
-- queue processing: each worker grabs DIFFERENT unlocked rows, no blocking, no double-processing:
START TRANSACTION;
  SELECT id FROM settlement_queue WHERE status='pending' LIMIT 10 FOR UPDATE SKIP LOCKED;
  -- ... process + mark done ...
COMMIT;
-- fail fast instead of waiting:
SELECT * FROM account WHERE account_id=42 FOR UPDATE NOWAIT;   -- error 3572 if locked
SHOW VARIABLES LIKE 'innodb_lock_wait_timeout';                -- default 50s (error 1205 on timeout)
```

**⚠️ Failure modes & gotchas.**
- **Queue without `SKIP LOCKED`** → workers block on the same rows, serialize.
- **`SKIP LOCKED` for "lock all matching rows"** → wrong (it skips claimed rows).
- **`innodb_lock_wait_timeout` too high** → long stalls; too low → spurious failures.

**💰 Fintech lens.** A settlement queue / outbox (M16) processed by many workers with `FOR UPDATE SKIP LOCKED` scales horizontally — each grabs distinct pending transfers, no contention, claim+process+update in one transaction.

**🎯 Interview / SD angle.** "`SKIP LOCKED` turns a table into a transactional work queue — N workers claim different rows, no blocking, no double-processing." WAIT = mutual exclusion on the same item; SKIP LOCKED = distribute different items. A DB queue without a separate broker.

**✅ Self-check.**
1. What does `FOR UPDATE SKIP LOCKED` enable, and how?
2. WAIT vs SKIP LOCKED vs NOWAIT — when each?
3. Why is a `SKIP LOCKED` queue transactional in a way a separate broker isn't?

---

## 8.13 · Metadata locks (MDL): the DDL-blocks-everything trap

**🔧 Code-specifics.**
```sql
-- diagnose an MDL stall:
SELECT * FROM performance_schema.metadata_locks WHERE object_name = 'account';  -- who holds/waits
SHOW PROCESSLIST;   -- queries "Waiting for metadata lock"
-- mitigate: short lock_wait_timeout (DDL fails fast instead of stalling the table):
SET SESSION lock_wait_timeout = 5;   -- the MDL wait timeout (seconds)
-- prefer online schema-change tools for busy tables (M13): gh-ost / pt-online-schema-change.
KILL <blocking_thread_id>;            -- kill the long query/txn holding the shared MDL
```

**⚠️ Failure modes & gotchas.**
- **DDL behind a long query/idle-in-txn** → exclusive MDL waits → ALL new queries on the table queue behind it → table frozen.
- **Idle-in-transaction connections** (pool leaks, M07/7.15) hold shared MDLs indefinitely.
- **Long `lock_wait_timeout`** → the blocked ALTER holds the table hostage longer.

**💰 Fintech lens.** An `ALTER TABLE ledger_entry` run while a long reconciliation query holds a shared MDL freezes *all* ledger queries — a classic outage. Ledger schema changes use online tools (M13), coordinated against long transactions.

**🎯 Interview / SD angle.** "Every query holds a shared MDL; a DDL needs exclusive; a long query + DDL queues all new queries behind the pending exclusive → table-wide stall." Reader-writer starvation pattern. Mitigate: kill blocker, short `lock_wait_timeout`, gh-ost/pt-osc.

**✅ Self-check.**
1. Why does a quick `ALTER` + a long query freeze the whole table?
2. What general pattern is this (reader-writer ...)?
3. Three mitigations.

---

## 8.14 · How MVCC + locks deliver each isolation level

**🔧 Code-specifics.**
```sql
-- RC: per-statement read view + record-only locks (gap locks off) → fewer deadlocks, phantoms possible:
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- RR (default): one read view + next-key locks → stable snapshot + no phantoms:
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- SERIALIZABLE: plain SELECTs become locking (S) reads → full serialization:
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT @@transaction_isolation;
```

**⚠️ Failure modes & gotchas.**
- **Assuming the levels are unrelated definitions** — they're two mechanism dials (snapshot timing + lock type).
- **RR's gap locks** → more deadlocks (switch to RC to reduce, accepting phantoms).
- **SERIALIZABLE's read locks** → low concurrency.

**💰 Fintech lens.** Default RR gives money reads a phantom-free stable snapshot (good for reconciliation). If gap-lock deadlocks hurt a high-write path, switching it to RC (record-only locks) is a mechanism-informed mitigation (M07/7.13b).

**🎯 Interview / SD angle.** "Each level = two dials: read-view *timing* (controls dirty/non-repeatable reads) + lock *type* (controls phantoms); SERIALIZABLE adds read locking." This *explains* the M07 anomaly matrix rather than memorizing it.

**✅ Self-check.**
1. What two mechanism dials define each isolation level?
2. Why does InnoDB RR prevent phantoms but RC doesn't (mechanism)?
3. Why might a high-write workload choose RC?

---

## 8.15 · Hot-row & hot-account contention (the fintech problem) ★

**🔧 Code-specifics.**
```sql
-- find hot-row contention (many waiters on one row):
SELECT * FROM performance_schema.data_lock_waits;
-- mitigations:
-- 1) short txn + atomic update (minimal lock-hold):
UPDATE account SET balance = balance + :delta WHERE account_id = 42;
-- 2) shard the counter (N sub-balance rows, summed):
UPDATE account_balance_shard SET balance = balance + :delta WHERE account_id=42 AND shard = :rand_shard;
-- 3) append-only ledger + async/batched balance (M02/2.17) — appends don't contend (8.9)
```

**⚠️ Failure modes & gotchas.**
- **Synchronous single-balance-row update at scale** → throughput ceiling (1/lock-hold-time).
- **Long transactions** multiply hot-row contention (8.10).
- **Sharded counter read** must SUM the shards (don't read one shard as the balance).

**💰 Fintech lens (★).** A hot merchant account taking thousands of payments/second can't synchronously update one balance row at that rate → append entries (no hot-row contention) + maintain balance via batch/async or counter sharding, ledger as source of truth (M02/2.17). *The* fintech concurrency problem.

**🎯 Interview / SD angle.** "A single shared mutable row is a serialization ceiling regardless of hardware — relieve a hot-spot by spreading (shard the counter), removing from the hot path (append + async), or shortening the critical section." Same as a contended cache line / hot partition key. Sets up M16.

**✅ Self-check.**
1. Why does a hot account cap throughput regardless of cores?
2. Three mitigations and their tradeoffs.
3. Why don't ledger *appends* contend like balance *updates* do?

---

## 8.16 · Fintech capstone — concurrency-correct money movement at scale ★

**🔧 Code-specifics.**
```sql
-- the transfer's concurrency-correct shape (lock footprint + ordering + retry):
-- (app retry loop around this on error 1213/1205)
START TRANSACTION;
  INSERT INTO transaction_ (idempotency_key, ...) VALUES ('abc', ...)
    ON DUPLICATE KEY UPDATE transaction_id = transaction_id;        -- record lock on UNIQUE (dedup)
  -- lock accounts in CONSISTENT order (ascending id) → no deadlock (8.11):
  UPDATE account SET balance = balance - 100 WHERE account_id = 1;  -- tight X record lock (PK, 8.8)
  UPDATE account SET balance = balance + 100 WHERE account_id = 2;
  INSERT INTO ledger_entry (...) VALUES (...), (...);               -- append, insert-intention (8.9)
COMMIT;   -- locks released; durable (M09)
```

**⚠️ Failure modes & gotchas.**
- **Inconsistent lock order** → deadlock (8.11). **Unindexed predicate** → table-wide lock (8.8).
- **Read-then-write balance** → lost update (M07/7.11). **Long txn** → hot-account contention + MDL (8.10/8.13).
- **Synchronous single balance at scale** → hot-account ceiling (8.15).

**💰 Fintech lens (★).** M07 made the transfer *correct*; M08 makes it *concurrent and scalable* — precise locks, consistent ordering, short hold, non-blocking MVCC reads, hot-account mitigation. The concurrency heart of the platform; M16 scales it across shards.

**🎯 Interview / SD angle.** The recipe: **lock precisely & minimally (index predicates), in a consistent order (no cycles), for a short time (held to commit), with non-blocking reads (MVCC), avoiding hot-spots (spread/append/batch).** Universal — DB txn, concurrent data structure, distributed system. Walk the transfer's lock footprint + deadlock fix + hot-account relief.

**✅ Self-check.**
1. What locks does the transfer take, and why is the footprint tight?
2. How does it avoid deadlocks and relieve hot-account contention?
3. State the universal concurrency-correctness recipe.

---

*Enrichment for 8.11–8.16 complete. **M08 Pass D is fully drafted (all 16 concepts) — M08 is now content-complete across Passes A–D.***
