# M16 · Pass D — Enrichment · Challenges 16.1–16.8

> **Pass D scope:** **🔧 Code-specifics** (the schema/SQL that realizes each design), **💰 Money-never-lies guarantee** (reinforced), **🎯 Interview / SD angle**, **✅ Self-check** — per challenge. Pairs with `01-…` + `04-passC-…`. Domain: payments/wallet. Money is `*_minor BIGINT` / `DECIMAL` — never FLOAT; reserved word `transaction` → `transaction_`.

---

## 16.1 · The fintech design frame ★

**🔧 Code-specifics.** The frame is a *method*, not code — but it yields the schema: the immutable ledger (16.2), idempotency keys (16.3), outbox (16.12), per-currency balances (16.9). Each layer maps to concrete prior-module code.

**💰 Guarantee.** Derives the design from the money-never-lies invariants → every layer preserves "conserved, never lost/duplicated, provable, recoverable."

**🎯 Interview / SD angle.** "Start from the invariants → ledger → correct → scale → operable → survivable, weaving integration + reconciliation throughout. Build correctness before scale; never trade an invariant for performance." The meta-design.

**✅ Self-check.** 1. Why derive from invariants first? 2. The layer order? 3. What do you never trade away?

---

## 16.2 · The Ledger ★

**🔧 Code-specifics.**
```sql
CREATE TABLE ledger_entry (                       -- IMMUTABLE, append-only
  entry_id BINARY(16), transaction_ BINARY(16), account_id BIGINT,
  amount_minor BIGINT NOT NULL, currency CHAR(3), created_at DATETIME(6),
  PRIMARY KEY (entry_id, created_at)              -- partitioned by created_at (M13/13.2)
);  -- a transfer = TWO balanced entries (Σ amount_minor = 0) in ONE txn (M07)
-- balance DERIVED + cached, updated atomically with entries; re-derivable:
SELECT account_id, SUM(amount_minor) FROM ledger_entry GROUP BY account_id;  -- reconciliation (16.7)
-- NO UPDATE/DELETE on ledger_entry (M13/13.14 privilege); corrections = compensating entries
```
> Money is `amount_minor BIGINT` (integer minor units) — never FLOAT/DOUBLE. Reserved word → `transaction_`.

**💰 Guarantee.** Double-entry → conserved · immutability → provable · derived → re-derivable (reconcilable). The structural foundation of money-never-lies.

**🎯 Interview / SD angle.** "Immutable append-only double-entry ledger; balances DERIVED (Σ entries), cached + re-derivable. Corrections are compensating entries, never mutations. The naive mutable balance fails audit + correctness." The heart of every money system.

**✅ Self-check.** 1. Why immutable + append-only? 2. Why is the balance derived, not authoritative? 3. How do you correct an error without mutating?

---

## 16.3 · Idempotency ★

**🔧 Code-specifics.**
```sql
CREATE TABLE idempotency_key (k BINARY(16) PRIMARY KEY, result JSON, created_at DATETIME);
BEGIN;
  INSERT INTO idempotency_key (k, …) VALUES (:key, …);  -- duplicate → UNIQUE violation → "already done"
  UPDATE account SET balance_minor = balance_minor - :amt WHERE account_id=:a AND balance_minor >= :amt;
  INSERT INTO ledger_entry …;                            -- effect + key ATOMIC (M07)
COMMIT;   -- retry hits the constraint → return recorded result → charged ONCE
```

**💰 Guarantee.** No double-charge — the single most important request-level protection. With the atomic ledger + reconciliation → exactly once, provably.

**🎯 Interview / SD angle.** "Idempotency key (unique constraint) ATOMIC with the effect → at-least-once delivery + idempotent processing = exactly-once effect. Exactly-once delivery is a myth. The load-bearing primitive." Non-negotiable for money.

**✅ Self-check.** 1. Why must the key + effect be one transaction? 2. One key per logical payment, not per retry — why? 3. Exactly-once effect vs delivery?

---

## 16.4 · Money movement ★

**🔧 Code-specifics.**
```sql
-- atomic transfer (co-located single-shard, M11/11.9):
BEGIN; UPDATE account SET balance_minor = balance_minor - :amt WHERE account_id=:a AND balance_minor >= :amt;
       UPDATE account SET balance_minor = balance_minor + :amt WHERE account_id=:b;
       INSERT INTO ledger_entry (…) VALUES (…),(…); INSERT INTO idempotency_key …; INSERT INTO outbox …; COMMIT;
-- hold (auth): INSERT INTO hold (…) — reserve; available = settled − Σ active holds
-- capture: convert the hold to ledger entries (settle), release the hold; cross-shard → Saga (M12/12.8)
```

**💰 Guarantee.** Every movement moves money exactly once, atomically, provably — atomic (no loss) + holds (no double-spend of reserved) + two-phase (pending tracked) + idempotent.

**🎯 Interview / SD angle.** "Atomic transfer (single-shard ACID, conditional UPDATE — no lost update). Auth-hold-capture for two-phase: available = settled − holds; every hold captured or released. Cross-shard → Saga, never 2PC." Pending vs settled is the key subtlety.

**✅ Self-check.** 1. Why a conditional `UPDATE … WHERE balance >= :amt`? 2. What is available balance with holds? 3. Why Saga not 2PC for cross-shard?

---

## 16.5 · Consistency for money

**🔧 Code-specifics.**
```sql
-- money decision → PRIMARY (strong):  SELECT balance_minor FROM account WHERE account_id=:a;  -- on primary
-- own read after write → read-your-writes:  SELECT WAIT_FOR_EXECUTED_GTID_SET('…',1); then read replica
-- reporting → async replica / warehouse (eventual). routing by app or Vitess (M11/11.13)
```

**💰 Guarantee.** Money decisions on strong reads → no decision against stale data (no stale-read double-spend, M15/15.9).

**🎯 Interview / SD angle.** "Per-operation consistency: strong (primary) for money decisions, read-your-writes for own data, eventual (replica) for reporting. Heterogeneous — correctness on the money path, scale elsewhere." Never one global level.

**✅ Self-check.** 1. Why read the primary for an authorization? 2. When read-your-writes? 3. Why heterogeneous consistency?

---

## 16.6 · Hot account contention ★

**🔧 Code-specifics.**
```sql
UPDATE account SET balance_minor = balance_minor + :amt WHERE account_id=:hot;  -- atomic, no RMW gap (always)
-- split: N sub-balances; each transfer → MOD(rand, N); true balance = SUM(sub_balance_minor)
-- batch/async: INSERT ledger_entry NOW (uncontended); batch-apply to the balance later (reconciled, 16.7)
-- SELECT … FOR UPDATE SKIP LOCKED for queue-style processing (M08)
```

**💰 Guarantee.** Money conserved — every transfer still writes a ledger entry (never lost); the derived balance is scaled (split/batched) and reconciled against the entries.

**🎯 Interview / SD angle.** "A hot account = a hot ROW on the balance — but the append-only LEDGER is never contended. Relieve the derived balance: atomic increments, split balances (N sub-rows), batch/async, SKIP LOCKED. Reconcile." M08's hot row at platform scale.

**✅ Self-check.** 1. Why isn't the ledger contended? 2. Three relief patterns? 3. How is correctness preserved?

---

## 16.7 · Reconciliation ★

**🔧 Code-specifics.**
```sql
-- internal (on a replica/warehouse): cached balance vs Σ entries
SELECT a.account_id FROM account a
JOIN (SELECT account_id, SUM(amount_minor) d FROM ledger_entry GROUP BY account_id) e
  ON e.account_id=a.account_id WHERE a.balance_minor <> e.d;   -- DRIFT → investigate + compensating entry
-- + Σ debits = Σ credits (conservation); + match external processor settlement records
```

**💰 Guarantee.** The backstop — makes "did money get lost/duplicated?" answerable; why eventual consistency is safe for money; the final guarantee under the platform.

**🎯 Interview / SD angle.** "Independently re-derive (from the immutable ledger) + match external records → detect/repair drift. A backstop after idempotency/atomic/outbox. Must use a genuinely independent source. Runs on replicas/warehouse." The money-never-lies safety net.

**✅ Self-check.** 1. What does internal vs external reconciliation check? 2. Why independent source? 3. Why does it make eventual consistency safe for money?

---

## 16.8 · Audit trails & compliance

**🔧 Code-specifics.**
```sql
-- the immutable ledger IS the audit trail (16.2) — query by account + time (indexed, M05):
SELECT * FROM ledger_entry WHERE account_id=:a AND created_at BETWEEN :from AND :to ORDER BY created_at;
-- + audit log (M13/13.14 — who acted) + retention via partitioning (DROP PARTITION at expiry, M13/13.2)
-- immutability enforced: app accounts have NO UPDATE/DELETE on ledger_entry (M13/13.14)
```

**💰 Guarantee.** Every money movement is permanently provable = money-never-lies at the audit level (prove nothing was lost/duplicated via the immutable, balanced, complete history).

**🎯 Interview / SD angle.** "The immutable ledger IS the audit trail (event-sourcing-like) — reuse it, don't build a separate system. + retention via partitioning + enforced immutability. Satisfies compliance AND enables reconciliation." Same entries, two uses.

**✅ Self-check.** 1. Why is the ledger already the audit trail? 2. How is retention handled? 3. How is immutability enforced?

---

*Enrichment for 16.1–16.8 complete. Next Pass D file: 16.9–16.16.*
