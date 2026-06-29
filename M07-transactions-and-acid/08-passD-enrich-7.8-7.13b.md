# M07 · Pass D — Enrichment · Concepts 7.8–7.13b

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-isolation-in-depth.md` + `05-passC-…`. Domain: payments/wallet. (Lock/MVCC mechanics are M08.)

---

## 7.8 · The isolation levels (the SQL standard four)

**🔧 Code-specifics.**
```sql
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;   -- weakest
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;    -- InnoDB DEFAULT
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;       -- strongest (locks reads)
SELECT @@transaction_isolation;                     -- check current
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;  -- for the whole session
```

**⚠️ Failure modes & gotchas.**
- **SERIALIZABLE everywhere** → throughput collapse, more deadlocks/aborts.
- **READ UNCOMMITTED** → dirty reads; almost never appropriate.
- **Assuming the level fixes write anomalies** (it doesn't — 7.11/7.13).

**💰 Fintech lens.** Money movement → RR (+ locking for read-modify-write); tolerant reporting → READ COMMITTED. Pick the lowest level that's correct for the operation, not blanket-maximal.

**🎯 Interview / SD angle.** The four levels as a ladder, each preventing one more anomaly at more cost. InnoDB default = RR (not RC). "Choose the lowest level (+ targeted locks) that's correct." Connects to consistency-vs-availability (M12).

**✅ Self-check.**
1. Name the four levels and what each adds.
2. What's InnoDB's default, and how does it differ from most databases?
3. Why not run everything at SERIALIZABLE?

---

## 7.9 · Read anomalies: dirty, non-repeatable, phantom

**🔧 Code-specifics.**
```sql
-- DIRTY (RU only): T1 reads T2's uncommitted write, T2 rolls back.
-- NON-REPEATABLE: T1 reads balance, T2 commits a change, T1 re-reads → different.
-- PHANTOM: T1 counts rows, T2 inserts a matching row + commits, T1 re-counts → more.
-- prevented:  dirty ≥ READ COMMITTED · non-repeatable ≥ REPEATABLE READ · phantom = SERIALIZABLE (InnoDB RR via next-key locks, 7.13b)
```

**⚠️ Failure modes & gotchas.**
- **`NOT IN`/re-read logic** breaking under non-repeatable reads at READ COMMITTED.
- **Confusing the read anomalies with the write anomalies** (lost update/write skew are separate, 7.11/7.13).
- **Expecting phantoms at InnoDB RR** (InnoDB prevents them, 7.13b).

**💰 Fintech lens.** A statement that re-reads a balance can't tolerate non-repeatable reads → needs RR. A reconciliation counting entries can't tolerate phantoms → InnoDB RR (next-key locks) covers it.

**🎯 Interview / SD angle.** The three anomalies *define* the levels. Be able to describe each as a two-transaction timeline and name the level that prevents it. Note these are READ anomalies — write anomalies are separate.

**✅ Self-check.**
1. Define dirty / non-repeatable / phantom read.
2. Which level prevents each?
3. Why aren't these enough to reason about all concurrency bugs?

---

## 7.10 · The isolation × anomaly matrix

**🔧 Code-specifics.**
```sql
-- The matrix as a decision tool: find the lowest level preventing your intolerable anomaly.
-- (RU: ✓✓✓ · RC: ✗✓✓ · RR: ✗✗✓std/✗InnoDB · SER: ✗✗✗)
-- InnoDB RR is stronger than the standard (phantoms prevented). Verify behavior:
SELECT @@transaction_isolation;
-- ⚠ the matrix OMITS lost update (7.11) & write skew (7.13) — handle those explicitly.
```

**⚠️ Failure modes & gotchas.**
- **Trusting the matrix as complete** → missing the write anomalies it omits.
- **Using standard-RR reasoning on InnoDB** (which prevents phantoms).
- **Choosing a level without checking the implementation's actual behavior.**

**💰 Fintech lens.** Use the matrix for read consistency (InnoDB RR is strong), but ALWAYS handle the write anomalies (lost update, write skew) separately — a balance update needs an atomic update/lock regardless of level.

**🎯 Interview / SD angle.** Reproduce the matrix and annotate it: InnoDB RR prevents phantoms (✗ where standard says ✓); the matrix omits lost update & write skew. Reduces a complex tradeoff to a lookup table — and knowing its gaps is the senior signal.

**✅ Self-check.**
1. Reproduce the matrix (levels × three anomalies).
2. Where does InnoDB differ from the standard?
3. What does the matrix omit, and why does that matter?

---

## 7.11 · The lost update problem ★

**🔧 Code-specifics.**
```sql
-- ❌ read-modify-write (lost update under concurrency):
-- SELECT balance ... ; (app adds 50) ; UPDATE account SET balance = 150 WHERE id=42;
-- ✅ FIX 1 — atomic update (best):
UPDATE account SET balance = balance + 50 WHERE account_id = 42;   -- engine serializes under row lock
-- ✅ FIX 2 — pessimistic lock:
START TRANSACTION; SELECT balance FROM account WHERE account_id=42 FOR UPDATE; /* decide */ UPDATE ...; COMMIT;
-- ✅ FIX 3 — optimistic version check:
UPDATE account SET balance=:new, version=:v+1 WHERE account_id=42 AND version=:v;  -- 0 rows → retry
```

**⚠️ Failure modes & gotchas.**
- **REPEATABLE READ does NOT prevent lost update** — the classic surprise.
- **Read-then-write balance in app code** under concurrency → silent money loss.
- **Hot account** → `FOR UPDATE` contention (M08/M16).

**💰 Fintech lens (★).** Two concurrent deposits → one vanishes unless the read-modify-write is atomic/locked. This is *why* M02/2.17 / M16 use `balance = balance + :delta` in the same transaction — never read-then-write.

**🎯 Interview / SD angle.** *The* classic concurrency bug = non-atomic `counter++`. Three fixes: atomic update (best) / pessimistic lock / optimistic CAS. "Consistent reads don't fix it." Guaranteed interview topic.

**✅ Self-check.**
1. Walk the lost-update interleaving.
2. Why doesn't RR prevent it?
3. The three fixes and when to use each.

---

## 7.12 · Optimistic vs pessimistic concurrency control

**🔧 Code-specifics.**
```sql
-- PESSIMISTIC (hot rows): lock first, others block.
SELECT * FROM account WHERE account_id=42 FOR UPDATE;     -- exclusive
SELECT * FROM job WHERE status='pending' LIMIT 10 FOR UPDATE SKIP LOCKED;  -- queue (M08)
-- OPTIMISTIC (low contention): version check, retry on conflict.
UPDATE settings SET ..., version=version+1 WHERE id=:id AND version=:v;   -- rows_affected=0 → retry
```

**⚠️ Failure modes & gotchas.**
- **Optimistic under high contention** → retry thrash/livelock.
- **Pessimistic on hot rows** → blocking, deadlock risk (M08).
- **Forgetting to check rows_affected** in optimistic (silent lost conflict).

**💰 Fintech lens.** Hot balance → pessimistic (`FOR UPDATE`) or atomic update; rarely-edited settings → optimistic. `SKIP LOCKED` for queue-style settlement processing (M08/M16).

**🎯 Interview / SD angle.** Lock-first (pessimistic) vs detect-and-retry (optimistic) — match to conflict rate (high → pessimistic, low → optimistic). Same as lock-based vs lock-free/CAS. `SKIP LOCKED`/`NOWAIT` for queues.

**✅ Self-check.**
1. Optimistic vs pessimistic — the core difference?
2. Which fits high contention vs low contention, and why?
3. What does `SKIP LOCKED` enable?

---

## 7.13 · Write skew & SERIALIZABLE's role

**🔧 Code-specifics.**
```sql
-- write skew: two txns read overlapping data, check an invariant, write DISJOINT rows → jointly violate it.
-- RR/snapshot PERMITS it. Fixes:
-- 1) SERIALIZABLE:
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
-- 2) lock the WHOLE read-set at RR:
SELECT * FROM sub_account WHERE account_id=42 FOR UPDATE;   -- lock BOTH sub-balances before deciding
-- 3) materialize the invariant onto one row → atomic update (turns write-skew into lost-update-style)
```

**⚠️ Failure modes & gotchas.**
- **"I use RR so I'm safe"** — FALSE for write skew (multi-row invariants).
- **Locking only the rows you write** (not the rows you read for the decision) → write skew slips through.
- **Snapshot isolation ≠ serializable** — the core misconception.

**💰 Fintech lens.** A shared spending limit, or "total across linked accounts ≥ 0," is write-skew-prone — two concurrent withdrawals each valid, together overdrawing. Lock the full read-set (`FOR UPDATE`) or use SERIALIZABLE.

**🎯 Interview / SD angle.** Write skew = overlapping reads + disjoint writes + multi-row invariant → only SERIALIZABLE or read-set locking prevents it. Proves snapshot isolation ≠ serializable. Strong concurrency-depth signal.

**✅ Self-check.**
1. What's the signature of write skew (vs lost update)?
2. Why doesn't snapshot isolation/RR prevent it?
3. Three ways to prevent it.

---

## 7.13b · MySQL/InnoDB's actual defaults & behavior

**🔧 Code-specifics.**
```sql
SELECT @@transaction_isolation;        -- REPEATABLE-READ (InnoDB default)
-- RR snapshot established at FIRST read; next-key locks prevent phantoms (M08).
-- some high-throughput shops switch to RC for less gap-locking / fewer deadlocks:
SET GLOBAL TRANSACTION ISOLATION LEVEL READ COMMITTED;   -- a deliberate tradeoff
-- still need explicit handling for lost update (7.11) + write skew (7.13).
```

**⚠️ Failure modes & gotchas.**
- **Porting Postgres/Oracle reasoning** (RC default) to MySQL (RR default) → wrong assumptions.
- **Expecting standard-RR phantom behavior** (InnoDB prevents them).
- **Assuming RR's strength covers write anomalies** (it doesn't).
- **Snapshot age in long transactions** → history-list bloat (7.15/M09).

**💰 Fintech lens.** InnoDB's default RR gives money reads strong consistency for free (incl. phantom protection); money writes still need atomic updates/locks. Long transactions degrade (snapshot age, 7.15).

**🎯 Interview / SD angle.** "The implementation deviates from the spec — know your system." InnoDB: RR default, snapshot at first read, next-key locks prevent phantoms (stronger than standard), MVCC reads + locking writes. Lost update/write skew still need handling. Mechanism = M08.

**✅ Self-check.**
1. Three ways InnoDB's behavior differs from the textbook.
2. Why does InnoDB's RR prevent phantoms?
3. What does InnoDB's strong RR still NOT prevent?

---

*Enrichment for 7.8–7.13b complete. Next Pass D file: 7.14–7.16.*
