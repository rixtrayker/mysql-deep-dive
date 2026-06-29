# M07 · Pass D — Enrichment · Concepts 7.1–7.7

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-acid-and-boundaries.md` (Pass B) and `04-passC-…` (Pass C). Domain: payments/wallet.

---

## 7.1 · What a transaction is & why ★

**🔧 Code-specifics.**
```sql
-- A transaction = one explicit boundary around the atomic unit:
START TRANSACTION;
  INSERT INTO ledger_entry (transaction_id,line_no,account_id,amount) VALUES (700,1,1,-100.00),(700,2,2,100.00);
  UPDATE account SET balance = balance - 100 WHERE account_id = 1;
  UPDATE account SET balance = balance + 100 WHERE account_id = 2;
COMMIT;   -- (or ROLLBACK to undo everything)
-- money tables MUST be InnoDB (M04/4.12) — MyISAM has no transactions:
SELECT engine FROM information_schema.tables WHERE table_name='ledger_entry';  -- InnoDB
```

**⚠️ Failure modes & gotchas.**
- **Multi-step money op without an explicit transaction** → not atomic (7.6) → half-applied on failure.
- **Money table on a non-transactional engine** (MyISAM) → no atomicity/rollback (M04/4.12).
- **Forgetting the boundary** is the #1 transaction bug.

**💰 Fintech lens.** A transfer has *no safe intermediate state* (debit-without-credit = money lost), so it MUST be a transaction. This is the deepest reason money lives in a transactional DB.

**🎯 Interview / SD angle.** "A transaction makes a group of operations all-or-nothing, isolated, durable — so partial failure and concurrency can't leave inconsistent state." App declares the boundary; engine guarantees ACID. The universal atomic-unit abstraction.

**✅ Self-check.**
1. What two hard problems do transactions solve?
2. Why must a transfer be one transaction, not separate statements?
3. What does the application provide vs the engine?

---

## 7.2 · Atomicity: all-or-nothing

**🔧 Code-specifics.**
```sql
START TRANSACTION;
  UPDATE account SET balance = balance - 100 WHERE account_id = 1;  -- debit applied (undo recorded)
  -- credit fails (constraint / crash / error) →
ROLLBACK;   -- applies undo logs in reverse → debit UNDONE too → no trace
-- ⚠ DDL implicitly COMMITS and can't be rolled back:
-- ALTER TABLE ... ;   -- ends any open transaction (migration footgun, M13)
```

**⚠️ Failure modes & gotchas.**
- **DDL (CREATE/ALTER/DROP) implicitly commits** → can't be rolled back; surprises in migration scripts.
- **Assuming a failed statement rolled back the whole transaction** — it may only roll back the statement; you must `ROLLBACK`.
- **Huge transactions** → slow rollback if they fail (undo replay).

**💰 Fintech lens.** If the credit fails after the debit, atomicity rolls back the debit too — money conserved, SUM=0 invariant (M01/1.19) never left broken. Crash recovery (M09) rolls back in-flight transfers.

**🎯 Interview / SD angle.** All-or-nothing via undo logs (M09); crash recovery rolls back uncommitted. "Hand-rolled cleanup can't undo a crash." Universal atomic-commit principle (journaling, git, atomic rename).

**✅ Self-check.**
1. How is atomicity implemented (the mechanism)?
2. What happens to a transfer's debit if the credit fails?
3. Why does DDL break the all-or-nothing assumption?

---

## 7.3 · Consistency: invariants preserved

**🔧 Code-specifics.**
```sql
-- Engine enforces DECLARED constraints inside the transaction:
ALTER TABLE account ADD CONSTRAINT ck_nonneg CHECK (balance >= 0);   -- 8.0.16+
-- a transfer violating it errors → ROLLBACK → stays in a valid state.
-- Application-level invariants (double-entry SUM=0, balance=Σentries) preserved by
-- ATOMIC single-transaction design + reconciliation (M02/2.17):
SELECT account_id FROM account a
WHERE a.balance <> (SELECT COALESCE(SUM(amount),0) FROM ledger_entry e WHERE e.account_id=a.account_id);
```

**⚠️ Failure modes & gotchas.**
- **Cross-row invariants** (SUM=0, balance=Σentries) aren't engine-enforced — they rely on atomic transaction design + reconciliation.
- **CHECK ignored pre-8.0.16** (M01/1.8) — verify version.
- **Splitting an invariant across transactions** → a crash leaves it broken.

**💰 Fintech lens.** The double-entry invariant holds because balanced entries are posted in ONE atomic transaction. Reconciliation (M02/2.17) verifies the cross-row invariants the engine can't.

**🎯 Interview / SD angle.** Consistency = engine-enforced constraints + app-designed transactions preserving invariants. The "least pure-engine" ACID property — leans on atomicity + isolation + correct logic. Every committed state is valid.

**✅ Self-check.**
1. What part of consistency does the engine enforce vs the application?
2. Why does the double-entry invariant need atomicity?
3. How do you verify a cross-row invariant the engine can't enforce?

---

## 7.4 · Isolation: concurrent transactions don't interfere

**🔧 Code-specifics.**
```sql
SELECT @@transaction_isolation;        -- InnoDB default: REPEATABLE-READ (7.13b)
-- isolation comes in LEVELS (7.8); set per session/transaction:
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;   -- next transaction
-- InnoDB delivers it via MVCC (non-blocking snapshot reads) + locks (writes) — M08
```

**⚠️ Failure modes & gotchas.**
- **Assuming isolation level alone prevents all concurrency bugs** — it doesn't (lost update 7.11, write skew 7.13 need explicit handling).
- **Over-isolating** (SERIALIZABLE everywhere) → throughput collapse.
- **Under-isolating** money paths → corruption.

**💰 Fintech lens.** Two concurrent transfers to one hot account must not corrupt the balance. InnoDB's default RR gives strong reads, but the read-modify-write still needs an atomic update/lock (7.11).

**🎯 Interview / SD angle.** "Each transaction behaves as if alone — the hardest, most expensive ACID property, delivered in LEVELS (correctness vs concurrency)." MVCC + locks. Connects to CAP/PACELC (M12).

**✅ Self-check.**
1. Why is isolation the hardest ACID property?
2. Why does it come in levels rather than being all-or-nothing?
3. Does a strong isolation level prevent lost updates?

---

## 7.5 · Durability: committed survives a crash

**🔧 Code-specifics.**
```sql
-- Durability tunables (mechanism in M09):
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit';  -- 1 = fsync every commit (durable)
SHOW VARIABLES LIKE 'sync_binlog';                     -- 1 = binlog durable (replication, M10)
-- for money: keep both = 1 (a lost committed payment is unacceptable).
-- COMMIT writes the redo log (WAL) + fsync → recovery replays it on restart (M09).
```

**⚠️ Failure modes & gotchas.**
- **Relaxed flush settings** (`flush_log_at_trx_commit=2`/`0`) → a crash loses the last fraction of a second of committed transactions (M09/M15).
- **fsync not actually reaching disk** (lying disks, cloud-storage semantics) → silent durability loss (M15).
- **Assuming "COMMIT returned" = durable** without verifying flush settings.

**💰 Fintech lens.** A committed transfer must survive a crash — the durable settings (`=1`) are mandatory for money, accepting the throughput cost. The rare-but-catastrophic failure modes are M15.

**🎯 Interview / SD angle.** "Committed survives a crash" via WAL (sequential redo log + fsync, lazy data pages, replay on recovery). The durability/throughput tunable. Universal "log-then-ack" pattern (Kafka, Raft, journals).

**✅ Self-check.**
1. How does WAL provide durability without writing every page at commit?
2. What does `innodb_flush_log_at_trx_commit=1` guarantee vs `=2`?
3. Why can durability still fail even when COMMIT returns?

---

## 7.6 · Transaction boundaries & autocommit

**🔧 Code-specifics.**
```sql
SELECT @@autocommit;          -- 1 (default) → each statement auto-commits!
-- multi-step ops need an explicit boundary:
START TRANSACTION; ... COMMIT;          -- or BEGIN; ... COMMIT;
-- or: SET autocommit=0; ... COMMIT;
-- draw the boundary around EXACTLY the atomic unit; nothing slow inside (7.15).
```

**⚠️ Failure modes & gotchas.**
- **Autocommit splits a multi-step op** into independent commits → not atomic (the half-applied-transfer bug).
- **Left-open transaction** (forgotten COMMIT, idle pooled connection, M04/4.2) → holds locks/undo indefinitely (7.15).
- **DDL implicitly commits**, ending an open transaction.
- **ORM-managed boundaries** too wide (across slow work) → contention.

**💰 Fintech lens.** The transfer MUST be one explicit transaction — autocommit would commit the debit, then separately the credit, losing money on failure between them.

**🎯 Interview / SD angle.** "MySQL defaults to autocommit-per-statement — multi-step ops must be explicitly grouped." Boundary = a design decision: wide enough to be correct, narrow enough to not hold locks (7.15). Scope your critical section.

**✅ Self-check.**
1. What does autocommit=1 mean for a multi-step operation?
2. How do you draw a transaction boundary, and how wide should it be?
3. What's the danger of an idle-in-transaction connection?

---

## 7.7 · COMMIT, ROLLBACK & savepoints

**🔧 Code-specifics.**
```sql
START TRANSACTION;
  -- process transfer 1 ...
  SAVEPOINT after_1;
  -- process transfer 2 ... fails →
  ROLLBACK TO SAVEPOINT after_1;   -- undo ONLY transfer 2; txn still open, 1 intact
  -- process transfer 3 ...
COMMIT;
-- robust money code: retry the whole txn on deadlock/lock-timeout (M08):
-- (app loop) on error 1213 (deadlock) / 1205 (lock wait timeout) → retry
```

**⚠️ Failure modes & gotchas.**
- **Deadlock/lock-timeout** (M08) rolls back the transaction (or statement) → must **retry** (standard money pattern).
- **Savepoint complexity** — subtle lock-retention semantics; overuse hurts readability.
- **DDL ends the transaction** (implicit commit).

**💰 Fintech lens.** Savepoints let a batch settlement skip a failed transfer without aborting the whole batch. But often separate transactions per transfer + idempotency (M16) are simpler and more resilient. Retry loops are essential under contention.

**🎯 Interview / SD angle.** COMMIT (permanent) / ROLLBACK (undo all) / SAVEPOINT (partial undo to a marked point). Databases lack true nested transactions — savepoints approximate them. Robust pattern: COMMIT/ROLLBACK + retry on transient conflict.

**✅ Self-check.**
1. What does a savepoint let you do that ROLLBACK alone doesn't?
2. Why must money code have a retry loop?
3. Savepoints vs separate transactions per batch item — tradeoff?

---

*Enrichment for 7.1–7.7 complete. Next Pass D file: 7.8–7.13b.*
