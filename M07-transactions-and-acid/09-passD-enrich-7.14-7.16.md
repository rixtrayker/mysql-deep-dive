# M07 · Pass D — Enrichment · Concepts 7.14–7.16

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-choosing-pitfalls-capstone.md` + `06-passC-…`. Domain: payments/wallet. These close out M07.

---

## 7.14 · Choosing an isolation level (the decision)

**🔧 Code-specifics.**
```sql
-- Money movement: RR (default) + atomic update / FOR UPDATE for the read-modify-write:
START TRANSACTION;  /* RR */
  UPDATE account SET balance = balance - 100 WHERE account_id = 1;   -- atomic (7.11)
COMMIT;
-- Tolerant reporting: weaker level, on a replica (M10):
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- Consistent multi-query report: stable snapshot:
START TRANSACTION WITH CONSISTENT SNAPSHOT;  SELECT ...; SELECT ...;  COMMIT;
```

**⚠️ Failure modes & gotchas.**
- **One blanket level for the whole app** → over-pays or under-protects.
- **Forgetting that the level alone doesn't cover write anomalies** — add locks (7.11/7.13).
- **Heavy reporting on the primary** → pins undo (7.15); move to a replica.

**💰 Fintech lens.** Transfers: RR + atomic updates; multi-row invariants: SERIALIZABLE/read-set locking; consistent reports: snapshot on a replica; dashboards: READ COMMITTED. Bias money movement toward correctness.

**🎯 Interview / SD angle.** Per-operation decision: invariants → intolerable anomalies (read matrix + write anomalies) → lowest level + targeted locks that's correct → weigh concurrency cost. Right-size consistency per operation. Frequent SD question.

**✅ Self-check.**
1. The decision procedure for choosing a level?
2. Why is it per-operation, not per-application?
3. When does the level need to be supplemented with explicit locks?

---

## 7.15 · Transactions, performance & pitfalls

**🔧 Code-specifics.**
```sql
-- Find long-running transactions (they hold locks + pin undo):
SELECT trx_id, trx_started, TIMESTAMPDIFF(SECOND, trx_started, NOW()) age_s, trx_rows_locked
FROM information_schema.INNODB_TRX ORDER BY trx_started LIMIT 10;
-- History list length (undo bloat from old snapshots, M09):
SHOW ENGINE INNODB STATUS\G   -- "History list length"
SHOW VARIABLES LIKE 'innodb_lock_wait_timeout';   -- cap how long a txn waits for a lock
-- ✅ keep the external payment call OUTSIDE the transaction (M16).
```

**⚠️ Failure modes & gotchas.**
- **Slow/external work inside the transaction** → locks held long → contention + history-list bloat.
- **Idle-in-transaction** (pool leak, forgotten COMMIT, M04/4.2) → resources held indefinitely.
- **Huge transactions** → long rollback, big locks, replication impact (M10).

**💰 Fintech lens.** The transfer transaction must be SHORT — do the external card-network call outside it (idempotency/outbox bridge the gap, M16). One long/forgotten transaction can stall the whole DB.

**🎯 Interview / SD angle.** "A transaction is a critical section — keep it short, no I/O while holding it." Long transactions hold locks + pin undo (history-list bloat). Detect via `INNODB_TRX` + history-list length. "Don't do I/O while holding a lock."

**✅ Self-check.**
1. What does a long-running transaction hold, and why does it hurt others?
2. Where should an external payment call go relative to the transaction?
3. How do you detect a long/idle transaction?

---

## 7.16 · Fintech capstone — the atomic transfer & money invariants ★

**🔧 Code-specifics.**
```sql
-- The canonical atomic transfer (all five guarantees):
START TRANSACTION;                                                    -- short boundary (7.6)
  INSERT INTO transaction_ (idempotency_key, created_at) VALUES ('abc-123', NOW(6))
    ON DUPLICATE KEY UPDATE transaction_id = transaction_id;          -- idempotent (M05/5.17, M16)
  INSERT INTO ledger_entry (transaction_id,line_no,account_id,amount,created_at)
    VALUES (700,1,1,-100.00,NOW(6)), (700,2,2,100.00,NOW(6));         -- SUM=0 (M01/1.19)
  UPDATE account SET balance = balance - 100 WHERE account_id = 1;    -- atomic (no lost update, 7.11)
  UPDATE account SET balance = balance + 100 WHERE account_id = 2;
COMMIT;                                                               -- durable (M09)
-- on deadlock/lock-timeout (M08) → retry the whole transaction (safe: idempotent).
```

**⚠️ Failure modes & gotchas.**
- **Read-then-write balance** → lost update (7.11). **No transaction boundary** → half-applied.
- **No idempotency** → double-post on retry. **FLOAT money** → inexact sums (M03/3.4).
- **External call inside the transaction** → long-transaction harm (7.15).
- **Hot-account contention** on the balance row (M08/M16).

**💰 Fintech lens (★).** Money conserved (SUM=0), attributed, never lost (atomic+durable), never duplicated (idempotent) — under concurrency AND crashes. The transactional heart of the platform; synthesizes M01/M02/M05/M07.

**🎯 Interview / SD angle.** Design a transfer: atomic boundary + balanced entries + atomic balance updates + durable commit + idempotency key + retry on conflict. Naming idempotency + atomic update are the top signals. The recipe generalizes to any critical state change.

**✅ Self-check.**
1. Walk the atomic transfer, naming which guarantee each step provides.
2. Which step prevents double-posting on retry?
3. Why is the balance update an atomic increment, not read-then-write?
4. Why does the external payment call go outside the transaction?

---

*Enrichment for 7.14–7.16 complete. **M07 Pass D is fully drafted (all 16 concepts) — M07 is now content-complete across Passes A–D.***
