# M02 · Pass D — Enrichment · Concepts 2.12–2.17

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-denormalization-sync-distributed-capstone.md` + `06-passC-…`. Domain: payments/wallet. These close out M02.

---

## 2.12 · Denormalization: the deliberate reversal

**🔧 Code-specifics.**
```sql
-- Denormalize ONLY after measuring + exhausting cheaper fixes. Add the copy + its sync together:
ALTER TABLE account ADD COLUMN balance DECIMAL(18,2) NOT NULL DEFAULT 0;  -- the deliberate copy
-- Safe denormalization where it's same-row derivable → generated column (CAN'T drift, M03):
ALTER TABLE ledger_entry ADD COLUMN amount_minor BIGINT AS (amount * 100) STORED;
-- Cross-row copies (balance) have NO native materialized view in MySQL → you own the sync (2.15).
```

**⚠️ Failure modes & gotchas.**
- **Denormalizing first, measuring never** → consistency debt with no payoff proof.
- **A copy with no sync mechanism** → guaranteed drift.
- **Independently-writable copy** (anyone can `UPDATE balance`) → drift with no recovery; prefer *derived* (rebuildable).

**💰 Fintech lens.** The moment you add `account.balance` you've taken on a **standing promise** that it equals `SUM(entries)`. In money, an un-reconciled denormalized balance *is* a balance that can lie — the exact thing the thread forbids.

**🎯 Interview / SD angle.** "A cache is a copy you've promised to keep correct" — denormalization is **caching inside the schema**, inheriting invalidation/staleness/race. Lead with the **escalation order** (index → replica → denormalize-with-sync), denormalize **last**.

**✅ Self-check.**
1. What obligation do you take on the instant you denormalize?
2. Why prefer a *derived* copy over an independently-writable one?
3. What's the safe denormalization that can't drift, and why?

---

## 2.13 · Read vs write tradeoffs

**🔧 Code-specifics.**
```sql
-- Same domain, opposite ends of the seesaw — chosen by workload, not taste:
-- WRITE/integrity-critical (ledger): stay normalized, small atomic writes
INSERT INTO ledger_entry (transaction_id, account_id, amount) VALUES (700, 1, -100.00);
-- READ-latency-critical (balance): denormalized O(1) read
SELECT balance FROM account WHERE account_id = 1;     -- vs SUM over a growing log
-- Often avoid the seesaw: covering index (M05) or read replica (M10) before schema denormalization
```

**⚠️ Failure modes & gotchas.**
- **Optimizing the abundant resource at the expense of the scarce one** (denormalizing a read that was never hot, slowing every write).
- **Treating it as right/wrong** instead of workload-dependent.
- **Ignoring replicas/covering indexes** that sidestep the trade.

**💰 Fintech lens.** The ledger write path stays normalized (correctness > throughput); the balance read path denormalizes (latency-critical). Both correct, same system — the workload differs, not the principle.

**🎯 Interview / SD angle.** "Every optimization *moves* cost, rarely deletes it." Decide by **measured read:write ratio + latency SLO.** Mention CQRS (normalized write model + denormalized read model, M16) as the formalized version.

**✅ Self-check.**
1. Which side does normalization favor; which does denormalization?
2. What two measurements drive the choice?
3. Name a technique that avoids the seesaw entirely.

---

## 2.14 · Derived & materialized data

**🔧 Code-specifics.**
```sql
-- Same-row derived → generated column (engine-maintained, drift-proof):
ALTER TABLE ledger_entry ADD COLUMN amount_minor BIGINT AS (amount*100) VIRTUAL;
-- Cross-row materialized rollup → hand-built summary table (no native matviews in MySQL):
CREATE TABLE settlement_totals (
  settle_date DATE NOT NULL, currency CHAR(3) NOT NULL, total DECIMAL(20,2) NOT NULL,
  PRIMARY KEY (settle_date, currency)
) ENGINE=InnoDB;
-- Rebuild / reconcile from the source of truth at any time:
SELECT DATE(created_at) d, currency, SUM(amount)
FROM ledger_entry GROUP BY d, currency;     -- run on a REPLICA to spare the primary (M10)
```

**⚠️ Failure modes & gotchas.**
- **Treating a materialized aggregate as authoritative** instead of as a projection.
- **No rebuild path** → drift becomes unrecoverable (can't tell which value is right).
- **VIRTUAL vs STORED** confusion — only STORED generated columns are stored/indexable the way you may expect (M03).

**💰 Fintech lens.** Derived data is the *best-behaved* denormalization for money: one source of truth + deterministic recompute = **drift is detectable** (`SUM` vs stored) and **repairable**. This is what makes a fast balance trustworthy.

**🎯 Interview / SD angle.** "Prefer derivable over duplicated — a value you can recompute is a value you can verify." Note MySQL has **no native materialized views** (unlike Postgres), so cross-row materialization is DIY + reconciliation — a concrete MySQL-vs-Postgres distinction.

**✅ Self-check.**
1. Why is derived data the best-behaved kind of denormalization?
2. What does MySQL lack that forces hand-built summary tables?
3. What makes drift in a derived value *detectable*?

---

## 2.15 · Keeping copies consistent: the sync problem ★

**🔧 Code-specifics.**
```sql
-- Mechanism 1 — SAME-TRANSACTION (default for money: atomic, strongly consistent):
START TRANSACTION;
  INSERT INTO ledger_entry (transaction_id, account_id, amount) VALUES (700, 1, -100.00);
  UPDATE account SET balance = balance - 100.00 WHERE account_id = 1;
COMMIT;                          -- entry + balance can NEVER disagree
-- Mechanism 2 — TRIGGER (synchronous, same-DB only; ⚠ InnoDB cascades bypass triggers):
CREATE TRIGGER trg_bal AFTER INSERT ON ledger_entry FOR EACH ROW
  UPDATE account SET balance = balance + NEW.amount WHERE account_id = NEW.account_id;
-- Mechanism 3/4 — ASYNC job / CDC off the binlog (eventual; outbox/CQRS, M12/M16)
-- + RECONCILIATION safety net (catches drift from ANY mechanism):
SELECT a.account_id FROM account a
JOIN (SELECT account_id, SUM(amount) s FROM ledger_entry GROUP BY account_id) e
  ON e.account_id = a.account_id
WHERE a.balance <> e.s;           -- any row here = drift to repair
```

**⚠️ Failure modes & gotchas.**
- **Same-transaction on a hot account** → contention on the single balance row (M08); mitigations in M16.
- **Trigger pitfalls** — hidden, per-row overhead, untested, and **cascades bypass them** (M01/1.6).
- **Async/CDC staleness** served as if authoritative → spending decisions on a stale balance.
- **No reconciliation** → drift becomes silent and permanent.

**💰 Fintech lens.** Pick **same-transaction for the authoritative spendable balance**; reserve async/CDC for tolerant read-models (dashboards). **Always** run reconciliation — it's what lets you safely choose a faster mechanism elsewhere. A money copy without reconciliation is a liability.

**🎯 Interview / SD angle.** This is the highest-signal concept in M02. Lay out the **four mechanisms on the consistency-vs-decoupling axis + reconciliation as the orthogonal safety net.** Mention CDC-off-the-binlog and the **outbox pattern** (avoids dual-write) — strong distributed-systems signal.

**✅ Self-check.**
1. List the four sync mechanisms and their freshness/coupling tradeoff.
2. Why is reconciliation orthogonal to the mechanism choice?
3. Which mechanism for an authoritative balance, and why?

---

## 2.16 · Normalization vs denormalization in distributed/scaled systems

**🔧 Code-specifics.**
```sql
-- Single node: cross-entity JOIN is local + cheap.
-- Sharded (M11): cross-shard JOIN/FK/transaction unavailable → two structural moves:
-- 1) DENORMALIZE a read-model so a read hits ONE shard/row (pre-joined display fields)
-- 2) CO-LOCATE transactionally-coupled rows on one shard (both legs of a transfer)
--    → shard key chosen so each money-conserving transaction stays LOCAL:
--      e.g. route by a shared 'ledger_group_id' so debit+credit land on the same shard
-- Integrity bill moves to app: idempotency keys + reconciliation + CDC/outbox (M12/M16)
```

**⚠️ Failure modes & gotchas.**
- **Carrying single-node instincts into a sharded design** ("just join it back") → scatter-gather or impossible.
- **A transfer's debit and credit on different shards** → no atomic transaction; broken double-entry.
- **Dropping FKs for scale without replacing the guarantee** (app checks + reconciliation).

**💰 Fintech lens.** The governing sharding rule: **shard so each money-conserving transaction stays within one shard**, preserving the `SUM=0` invariant under one local InnoDB transaction even in a distributed system. Cross-shard money movement needs Saga/2PC + reconciliation (M12).

**🎯 Interview / SD angle.** "Locality changes the cost model — cheap within a boundary, prohibitive across one." At scale **denormalization is structural, not optional**, and the integrity you lose for free must be re-bought (idempotency, reconciliation, outbox/CDC). Bridges into M11/M12.

**✅ Self-check.**
1. Why does denormalization become mandatory under sharding?
2. Where does the integrity bill go when cross-shard FKs disappear?
3. What's the fintech rule for choosing a shard key w.r.t. transactions?

---

## 2.17 · Fintech capstone — the normalized ledger + denormalized balance ★

**🔧 Code-specifics.**
```sql
-- Normalized + immutable source of truth:
CREATE TABLE ledger_entry (
  transaction_id BIGINT NOT NULL, line_no INT NOT NULL,
  account_id BIGINT NOT NULL,
  amount DECIMAL(18,2) NOT NULL,            -- DECIMAL / minor units, NEVER FLOAT (M03)
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (account_id, created_at, transaction_id, line_no),   -- query-shaped clustering (M01/1.14)
  CONSTRAINT fk_e_acct FOREIGN KEY (account_id) REFERENCES account(account_id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- Denormalized derived balance, updated in the SAME transaction (strong consistency):
START TRANSACTION;
  INSERT INTO ledger_entry VALUES (700,1,1,-100.00,NOW(6)), (700,2,2,+100.00,NOW(6)); -- SUM=0
  UPDATE account SET balance = balance - 100 WHERE account_id = 1;
  UPDATE account SET balance = balance + 100 WHERE account_id = 2;
COMMIT;
-- Reconciliation (scheduled, on a replica): stored balance must equal SUM(entries)
SELECT account_id FROM account a
WHERE a.balance <> (SELECT COALESCE(SUM(amount),0) FROM ledger_entry e WHERE e.account_id=a.account_id);
```

**⚠️ Failure modes & gotchas.**
- **`account.balance` as the only record** (no entries) → no audit, races, money can vanish/appear.
- **FLOAT money** → derived sums lose cents.
- **Balance updated outside the entry's transaction** → drift; reconciliation must catch it.
- **Hot-account contention** on the balance row (M08/M16).

**💰 Fintech lens (★).** Truth is **normalized + immutable** (no two entries disagree; `SUM=0` conserves money); speed is **derived + reconciled** (O(1) balance, rollups); drift is **detectable + repairable**, never silent. This is the structural realization of *money-never-lies* and the seed of the M16 platform.

**🎯 Interview / SD angle.** Asked to design a wallet/ledger: produce **normalized immutable double-entry ledger + denormalized balance (same-txn) + rollups (async/CDC) + reconciliation**, money as DECIMAL/minor-units, FKs RESTRICT. Naming **reconciliation** and **same-transaction balance update** are the top signals; CQRS/event-sourcing as the maximalist extension.

**✅ Self-check.**
1. Which parts of the money model are normalized, which denormalized, and why each?
2. What makes the fast balance *trustworthy* despite being a copy?
3. Why DECIMAL/minor-units instead of FLOAT for derived sums?
4. Which sync mechanism for the balance, and which for reporting rollups?

---

*Enrichment for 2.12–2.17 complete. **M02 Pass D is fully drafted (all 17 concepts) — M02 is now content-complete across Passes A–D.***
