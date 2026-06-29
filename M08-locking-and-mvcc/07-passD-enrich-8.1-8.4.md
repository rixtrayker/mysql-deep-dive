# M08 · Pass D — Enrichment · Concepts 8.1–8.4

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-mvcc-and-read-modes.md` (Pass B) and `04-passC-…` (Pass C, with ★ SVGs). Domain: payments/wallet.

---

## 8.1 · Why two mechanisms: MVCC + locking ★

**🔧 Code-specifics.**
```sql
-- plain SELECT → MVCC snapshot read (no locks, never blocks):
SELECT SUM(amount) FROM ledger_entry WHERE account_id = 42;   -- reconciliation, concurrent with writes
-- write / locking read → takes row locks:
UPDATE account SET balance = balance - 100 WHERE account_id = 42;   -- X row lock
SELECT * FROM account WHERE account_id = 42 FOR UPDATE;             -- X lock, blocks conflicting writers
-- see live locks vs snapshot reads:
SELECT * FROM performance_schema.data_locks;        -- only writes/locking reads appear (MVCC reads don't lock)
```

**⚠️ Failure modes & gotchas.**
- **Assuming reads take locks** — plain SELECTs use MVCC (no locks); only writes/locking-reads lock.
- **A long transaction pinning old versions** → history-list bloat (8.2/M09).
- **Expecting a pure-locking mental model** → mis-predicting what blocks what.

**💰 Fintech lens.** A heavy reconciliation read (plain SELECT, MVCC) runs concurrently with the stream of transfers (writes, locking) — neither blocks the other. True read/write concurrency is *why* a payments system handles reporting + transfers at once.

**🎯 Interview / SD angle.** "Readers don't block writers, writers don't block readers (MVCC) + writers block conflicting writers (locks)." Two mechanisms: versioning for the common case (reads), locking for the conflicting case (writes). Same as RCU/copy-on-write.

**✅ Self-check.**
1. Which read mode takes no locks, and why?
2. What's the slogan that captures the two-mechanism design?
3. What's the cost of MVCC's non-blocking reads?

---

## 8.2 · MVCC: multi-version concurrency control ★

**🔧 Code-specifics.**
```sql
-- MVCC is automatic (no syntax) — each row carries hidden DB_TRX_ID + DB_ROLL_PTR (chain to undo).
-- a long transaction pins old versions → history-list bloat:
SHOW ENGINE INNODB STATUS\G          -- "History list length" (key health metric, M09)
SELECT trx_id, trx_started FROM information_schema.INNODB_TRX ORDER BY trx_started LIMIT 5;  -- oldest = pins
```

**⚠️ Failure modes & gotchas.**
- **Long transaction** → pins old versions → history-list bloat, longer chains slow reads (M07/7.15, M09).
- **Frequently-updated hot row** → long version chain → slower reads of it.
- **Secondary indexes don't carry full version chains** → some reads consult the clustered index.

**💰 Fintech lens.** When a transfer updates a hot account's balance, it creates a new version and pushes the old to undo; a concurrent reconciliation read sees the *old* snapshot-consistent balance without blocking. Powered by the version chain.

**🎯 Interview / SD angle.** "Writers create new versions instead of overwriting; readers walk the chain to their snapshot version — non-blocking reads." DB_TRX_ID + DB_ROLL_PTR. Universal immutability-for-concurrency (copy-on-write, RCU, Git). Cost: version retention.

**✅ Self-check.**
1. How does a writer keep old versions reachable?
2. Why can two transactions read the same row and see different values?
3. What pins old versions and causes history-list bloat?

---

## 8.3 · Read views & visibility (how a snapshot is chosen) ★

**🔧 Code-specifics.**
```sql
-- Read view created at FIRST read (RR) — or immediately with:
START TRANSACTION WITH CONSISTENT SNAPSHOT;   -- take the snapshot now
-- RR: one read view reused; RC: new read view per statement (8.14):
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;   -- fresh snapshot each statement → non-repeatable reads
-- visibility rule: own writes + committed-before-snapshot are visible; active/later → skip to older version.
```

**⚠️ Failure modes & gotchas.**
- **Snapshot taken at first read, not at START TRANSACTION** — surprising if you expect an immediate snapshot (use `WITH CONSISTENT SNAPSHOT`).
- **Long-lived RR read view** pins history (8.2).
- **Expecting RR to see committed changes mid-transaction** (it won't — stable snapshot).

**💰 Fintech lens.** A multi-query reconciliation report at RR sees ONE consistent point-in-time view of all balances (one read view, reused) even as transfers commit during it — the basis of consistent reconciliation (M02/2.17).

**🎯 Interview / SD angle.** "A read view = the set of transactions active at snapshot time; the *timing* of the read view is the isolation level (one per txn at RR, one per statement at RC)." Visibility = own + committed-before-snapshot. Snapshot isolation via commit-visibility.

**✅ Self-check.**
1. What does a read view record, and how does it decide visibility?
2. How does read-view timing differ between RR and RC?
3. When is the read view created by default?

---

## 8.4 · Consistent reads vs locking reads

**🔧 Code-specifics.**
```sql
-- consistent (snapshot) read — no locks, may be stale, UNSAFE before a write:
SELECT balance FROM account WHERE account_id = 42;
-- locking read — latest committed + lock, SAFE for read-decide-write:
SELECT balance FROM account WHERE account_id = 42 FOR UPDATE;   -- X lock
SELECT balance FROM account WHERE account_id = 42 FOR SHARE;    -- S lock
-- best for a pure debit — atomic, combines check+write (M07/7.11):
UPDATE account SET balance = balance - 100 WHERE account_id = 42 AND balance >= 100;
```

**⚠️ Failure modes & gotchas.**
- **Plain SELECT before a write** (read-modify-write) → lost update / write skew (M07/7.11/7.13).
- **`FOR SHARE` then UPDATE** → S→X upgrade deadlock (8.6) — prefer `FOR UPDATE` up front.
- **Over-using locking reads** → needless contention; **under-using** → corruption.

**💰 Fintech lens.** "Read balance, check ≥ $100, debit" must use `FOR UPDATE` (or an atomic update) so the balance can't change between check and debit. A plain read here is the lost-update bug.

**🎯 Interview / SD angle.** "A read that *informs a write* needs locking (`FOR UPDATE`) or an atomic update; a read that just *observes* uses a non-blocking snapshot." Plain SELECT = MVCC (no lock, maybe stale); FOR UPDATE = current + X lock. The observational-vs-read-for-update distinction.

**✅ Self-check.**
1. Consistent read vs locking read — what does each lock and return?
2. Why is a plain SELECT unsafe before a write?
3. When do you use FOR UPDATE vs an atomic update?

---

*Enrichment for 8.1–8.4 complete. Next Pass D file: 8.5–8.10.*
