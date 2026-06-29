# M12 · Pass D — Enrichment · Concepts 12.6–12.10

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-2pc-saga-idempotency-dualwrite.md` + `05-passC-…`. Domain: payments/wallet, the ledger.

---

## 12.6 · Distributed transactions & 2PC ★

**🔧 Code-specifics.**
```sql
-- MySQL's ROBUST 2PC is INTERNAL: binlog ↔ redo two-phase commit (M09/9.11) — invisible, reliable
-- application-level cross-node 2PC = XA (12.7), avoided. The 2PC shape:
--   phase 1: coordinator → participants "PREPARE" (do work, hold locks, vote)
--   phase 2: all yes → "COMMIT"; any no → "ABORT"
-- ⚠ coordinator crash between phases → participants IN-DOUBT, holding locks (M08)
```

**⚠️ Failure modes & gotchas.**
- **Coordinator crash after prepare** → participants blocked in-doubt, holding locks indefinitely (the classic failure).
- **Lock-holding across network round-trips** → hot-row contention (account balances, M08).
- **Synchronous two phases** → poor throughput.

**💰 Fintech lens.** 2PC freezing account balances on a coordinator crash is intolerable for money. Preference: **avoid (co-locate, M11/11.9) > Saga (12.8) > 2PC**. MySQL's valuable 2PC is the internal binlog-redo one (M09).

**🎯 Interview / SD angle.** "Cross-node atomicity via prepare-then-commit — correct, but holds locks throughout and BLOCKS if the coordinator dies mid-decision (in-doubt). Not partition-tolerant → the instinct is to *avoid needing* distributed transactions, not do them well." Foundational atomic-commit protocol.

**✅ Self-check.**
1. Walk the two phases.
2. What's the in-doubt/blocking failure?
3. Why is MySQL's *internal* 2PC fine but *application* 2PC avoided?

---

## 12.7 · XA in MySQL (and why it's avoided)

**🔧 Code-specifics.**
```sql
XA START 'xid'; /* debit/credit */ XA END 'xid';
XA PREPARE 'xid';     -- ⚠ durably prepared, HOLDS LOCKS, now IN-DOUBT
XA COMMIT 'xid';      -- (or XA ROLLBACK 'xid')
XA RECOVER;           -- list in-doubt branches after a coordinator crash (manual resolution)
-- use instead: co-locate (M11/11.9) > Saga + idempotency + reconciliation (12.8/12.9/12.14)
```

**⚠️ Failure modes & gotchas.**
- **In-doubt after PREPARE + coordinator death** → frozen account balances until resolved.
- **Lock-holding** across the prepare window → hot-balance contention (M08).
- **Historically fragile** XA recovery + replication/connection-pooling interactions.
- **Throughput** — synchronous 2PC per transfer.

**💰 Fintech lens.** A payments platform **does not use XA** for cross-shard transfers (frozen balances on coordinator failure are unacceptable). Co-locate (M11/11.9) for the majority; Saga + idempotency + reconciliation for the cross-shard minority.

**🎯 Interview / SD angle.** "XA is correct (2PC across resources) but operationally costly — lock-holding, in-doubt blocking, throughput, fragility — so high-scale systems route around it with Sagas/outbox. The existence of a 'correct' synchronous solution doesn't make it the *right* one." Prefer designs that don't *need* distributed transactions.

**✅ Self-check.**
1. Why does fintech avoid XA specifically?
2. What does `XA RECOVER` resolve, and why is it needed?
3. The preference order vs XA?

---

## 12.8 · The Saga pattern ★

**🔧 Code-specifics.**
```sql
-- no MySQL syntax — an orchestration pattern OVER single-node transactions. Each step:
BEGIN; /* local ACID step (one shard) */ INSERT idempotency_key …; INSERT outbox …; COMMIT;
-- forward: T1 (debit, shard A) → T2 (credit, shard B); on failure: C1 (re-credit, shard A)
-- Saga state durable (outbox/orchestrator) → a crashed Saga RESUMES (not stuck) · steps idempotent (12.9)
```

**⚠️ Failure modes & gotchas.**
- **A Saga stuck mid-flight** (orchestrator crash, lost state) → money in limbo → make state durable so it resumes (M15 if not).
- **Incorrect compensations** ("undo a credit" after the money was spent) → unrecoverable.
- **Non-idempotent steps** → retries double-apply (12.9).
- **Eventually consistent** — a visible in-flight window.

**💰 Fintech lens.** Cross-shard transfers are **Sagas** (12.8) over single-shard local transactions + compensations + idempotency keys + reconciliation (M02/2.17) — never fragile 2PC. Orchestration (monitorable) preferred over choreography for money.

**🎯 Interview / SD angle.** "Replace one distributed txn with local txns + semantic compensations — non-blocking, scalable, but eventually consistent; make every step idempotent + durable so it's safely retryable + resumable. Trade atomicity for *recoverability*." The backbone of microservices/cross-shard operations.

**✅ Self-check.**
1. Forward steps vs compensations — how does failure unwind?
2. Why must steps be idempotent + state durable?
3. Orchestration vs choreography — which for money, why?

---

## 12.9 · Idempotency: the load-bearing primitive ★

**🔧 Code-specifics.**
```sql
-- the unique-constraint pattern — atomic dedup, database-enforced:
CREATE TABLE idempotency_key (k BINARY(16) PRIMARY KEY, result JSON, created_at DATETIME);
BEGIN;
  INSERT INTO idempotency_key (k, …) VALUES (:key, …);  -- duplicate → UNIQUE violation → "already done"
  UPDATE account SET balance_minor = balance_minor - 100 WHERE …;   -- effect, SAME txn (money in minor units)
  INSERT INTO ledger_entry …;
COMMIT;   -- key + effect atomic → a crash between them can't double-apply
```
> Money is `balance_minor BIGINT` (integer minor units) — never FLOAT/DOUBLE.

**⚠️ Failure modes & gotchas.**
- **Recording the key in a separate transaction from the effect** → a crash between them lets a retry double-apply.
- **New key per retry** (instead of per logical operation) → defeats dedup → double-charge.
- **No key retention** → an old retry isn't recognized as a duplicate.

**💰 Fintech lens (★).** Every payment/transfer carries an **idempotency key** inserted (unique constraint) in the *same transaction* as the debit/credit (M11/11.9) → a retried payment hits the constraint → returns the original result, **charges once**. The load-bearing primitive of all money movement.

**🎯 Interview / SD angle.** "Make operations safe to repeat — you can't prevent duplicate *delivery*, so make duplicate *processing* harmless. At-least-once delivery + idempotent processing = exactly-once *effect*. The primitive under Sagas, CDC consumers, payment APIs (Stripe idempotency keys)." If you learn one pattern, this.

**✅ Self-check.**
1. Why must the key-insert and effect be in one transaction?
2. Why one key per logical operation (not per retry)?
3. How does idempotency turn at-least-once into exactly-once effect?

---

## 12.10 · The dual-write problem ★

**🔧 Code-specifics.**
```sql
-- ❌ the trap (two non-atomic writes):
COMMIT;                          -- transfer durable in DB …
kafka.publish("TransferCompleted");   -- … crash here → event LOST → downstream never knows
-- ✅ the fix — OUTBOX (12.11): event in the SAME transaction as the state change
BEGIN; /* debit/credit/ledger */ INSERT INTO outbox (event_type, payload, event_id) VALUES (…); COMMIT;
-- then a relay / CDC (12.12) publishes the outbox reliably · DON'T use XA here (12.7)
```

**⚠️ Failure modes & gotchas.**
- **Naive "commit then publish"** → crash between → **lost event** (silent, intermittent — the worst bug).
- **Publish then commit** → DB rollback → **phantom event** (no safe order exists).
- **Reaching for XA** to make DB+queue atomic → XA's problems (12.7) — use the outbox instead.

**💰 Fintech lens.** A dropped "TransferCompleted" event = a missed settlement / un-sent confirmation / reconciliation discrepancy. Write the event to the **outbox in the transfer's transaction** (M11/11.9, atomic) → never lost.

**🎯 Interview / SD angle.** "You can't atomically write to two systems without a shared transaction → a crash between leaves them inconsistent. Never dual-write — make the event part of the state-change txn (outbox) or derive it from the change log (CDC). One atomic write, derive the rest." The most practically-important distributed-data lesson.

**✅ Self-check.**
1. Why is *no* ordering of two non-transactional writes safe?
2. Why is it silent and intermittent?
3. The two fixes, and why not XA?

---

*Enrichment for 12.6–12.10 complete. Next Pass D file: 12.11–12.16.*
