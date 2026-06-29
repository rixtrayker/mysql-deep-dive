# M02 · Pass D — Enrichment · Concepts 2.9–2.11

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-higher-forms-ladder-target.md` + `05-passC-…`. Domain: payments/wallet.

---

## 2.9 · Higher normal forms (4NF, 5NF): multivalued & join dependencies

**🔧 Code-specifics.**
```sql
-- ❌ 4NF violation: independent multivalued facts entangled → forced cross-product
-- account_thing(account_id, currency, signatory)  -- (42,USD,Alice)(42,USD,Bob)(42,EUR,Alice)...
-- ✅ 4NF: each independent M:N in its own table (this is just good M:N modeling, M01/1.12)
CREATE TABLE account_currency (
  account_id BIGINT NOT NULL, currency CHAR(3) NOT NULL,
  PRIMARY KEY (account_id, currency)
) ENGINE=InnoDB;
CREATE TABLE account_signatory (
  account_id BIGINT NOT NULL, signatory_id BIGINT NOT NULL,
  PRIMARY KEY (account_id, signatory_id)
) ENGINE=InnoDB;   -- adding a currency is now ONE row, not N (one per signatory)
```

**⚠️ Failure modes & gotchas.**
- **The cross-product smell** ("add one value → insert N rows") ignored → exploding redundancy.
- **Trying to fix an MVD as if it were an FD** → wrong decomposition.
- **5NF rabbit-holing** — chasing join dependencies that good M:N modeling already prevented.

**💰 Fintech lens.** Entangling "currencies an account supports" with "signatories on the account" creates meaningless (currency × signatory) rows — and authorization logic reading that table could mis-grant. Separate junctions keep each fact clean.

**🎯 Interview / SD angle.** Name **MVDs** and the cross-product symptom; then deliver the practical punchline: **"model each independent M:N as its own junction and you get 4NF for free."** Knowing 4NF is mostly for *diagnosing* a legacy mash-up and for interview signal.

**✅ Self-check.**
1. What's the smell of a 4NF violation?
2. Why doesn't BCNF catch it?
3. How do you usually get 4NF "for free"?

---

## 2.10 · The normalization ladder, end to end ★

**🔧 Code-specifics.**
```sql
-- The climb's end state: the messy payment_record decomposed into clean tables.
-- (one table per "thing"; every fact depends on the whole key and nothing but a key)
--   customer(customer_id PK, ...)            -- 3NF: customer_name moved here
--   bank(bank_code PK, bank_name)            -- 3NF: bank_name moved here
--   account(account_id PK, customer_id FK, bank_code FK, ...)
--   transaction_(transaction_id PK, ...)
--   ledger_line(transaction_id, line_no, account_id FK, amount, PRIMARY KEY(transaction_id,line_no))  -- 1NF+2NF
--   signatory(signatory_id PK, role)         -- BCNF: signatory→role
--   account_currency(account_id, currency, PRIMARY KEY(...))    -- 4NF
--   account_signatory(account_id, signatory_id, PRIMARY KEY(...)) -- 4NF
-- Then PHYSICAL (M01/1.9): clustered PKs, secondary indexes for the new joins (M05), FKs (InnoDB).
```

**⚠️ Failure modes & gotchas.**
- **Stopping mid-ladder unintentionally** (e.g., at 1NF) → residual anomalies.
- **A lossy or non-dependency-preserving decomposition** done by hand → can't rejoin, or can't enforce an FD.
- **Forgetting the physical hand-off** — a perfectly normalized schema with no indexes for the joins it introduced is slow (M05).

**💰 Fintech lens.** The clean end-state schema *is* the seed of the M16 payments model — `ledger_line` immutable, `transaction_` owning balanced lines, accounts/banks/customers/signatories each single-sourced. Climbing the ladder is how you arrive at an auditable money schema.

**🎯 Interview / SD angle.** Present the six forms as **one question at increasing resolution** ("does every fact depend on the whole key and nothing but a key?"), not six rules. Mention decomposition must be **lossless** and ideally **dependency-preserving**. Walking a messy table up the ladder live is a common exercise.

**✅ Self-check.**
1. What single question unifies all six normal forms?
2. What two properties should every decomposition step preserve?
3. What must happen *after* the logical climb (physical layer)?

---

## 2.11 · "3NF is usually enough" — the practical target

**🔧 Code-specifics.**
```sql
-- The stopping workflow in practice:
-- 1) design to 3NF/BCNF (baseline)
-- 2) check for 4NF cross-product smell; split if present
-- 3) measure the hot read:
EXPLAIN ANALYZE
SELECT SUM(amount) FROM ledger_entry WHERE account_id = 42;   -- slow over a growing log?
-- 4) try cheaper first: covering index / replica (M05/M10)
ALTER TABLE ledger_entry ADD KEY ix_acct_amt (account_id, amount);   -- helps point sums, not unbounded
-- 5) only then denormalize a derived balance + sync (2.12/2.15)
```

**⚠️ Failure modes & gotchas.**
- **Over-normalizing** → every query a six-way join for redundancy that didn't exist.
- **Under-normalizing** ("joins are slow") → anomalies shipped to prod.
- **Denormalizing without measuring** → consistency debt you didn't need.

**💰 Fintech lens.** The OLTP money core targets **3NF/BCNF** (integrity-critical, write-heavy); reporting/analytics (M16) deliberately denormalizes (star schemas, rollups) because reads dominate and writes are bulk. Matching form to workload per subsystem.

**🎯 Interview / SD angle.** "How far do you normalize?" → **"3NF/BCNF baseline; 4NF only if the cross-product smell is present; denormalize *down* only on a measured hot path with a sync plan."** Calibration (knowing where to stop, both directions) is the maturity signal — not maximizing the normal-form number.

**✅ Self-check.**
1. What's the default target for OLTP, and when do you go to 4NF?
2. What two opposite mistakes does "3NF is usually enough" guard against?
3. What's the escalation order before denormalizing a slow read?

---

*Enrichment for 2.9–2.11 complete. Next Pass D file: 2.12–2.17.*
