# M02 · Pass D — Enrichment · Concepts 2.1–2.8

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-redundancy-fds-1nf-bcnf.md` (Pass B) and `04-passC-…` (Pass C). Domain: payments/wallet.

---

## 2.1 · Why normalize? The cost of redundancy

**🔧 Code-specifics.**
```sql
-- Redundant: address copied onto every transaction row (can disagree with itself)
-- payment_record(txn_id, customer_id, customer_address, amount, ...)

-- Normalized: address lives once on customer; transactions reference it
CREATE TABLE customer (
  customer_id BIGINT NOT NULL AUTO_INCREMENT,
  address     VARCHAR(255) NOT NULL,
  PRIMARY KEY (customer_id)
) ENGINE=InnoDB;
CREATE TABLE ledger_entry (
  entry_id    BIGINT NOT NULL AUTO_INCREMENT,
  customer_id BIGINT NOT NULL,
  amount      DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (entry_id),
  CONSTRAINT fk_e_cust FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
) ENGINE=InnoDB;                            -- address change = ONE update, can't partially apply
```

**⚠️ Failure modes & gotchas.**
- **Silent inter-row contradiction** — partial updates leave the DB holding two truths with no "which is current" flag.
- **"Joins are slow, so duplicate" applied prematurely** — on well-indexed InnoDB, 3NF joins are usually fast; redundancy is the bigger risk.
- **Redundancy that crept in via copy-paste DDL** — no one *decided* to denormalize, so no one owns the sync.

**💰 Fintech lens.** A normalized financial schema **cannot hold two rows that disagree about the same money fact** — that's the structural floor under *money-never-lies*. Redundant money data is data that can drift into a discrepancy auditors will find.

**🎯 Interview / SD angle.** Frame normalization as **"a single source of truth per fact → contradiction becomes unrepresentable,"** not as "saving space." Name the tradeoff (reads pay with joins) so it's clear you're choosing, not dogmatic.

**✅ Self-check.**
1. What does normalization remove that's worse than wasted space?
2. Why is a partially-applied update the core danger of redundancy?
3. What's the cost you accept in exchange for removing redundancy?

---

## 2.2 · The three update anomalies

**🔧 Code-specifics.**
```sql
-- All three come from ONE table mixing facts. Decompose so each table is about one thing:
CREATE TABLE account_type (             -- fixes INSERT anomaly: add a type w/o any account
  type_code  VARCHAR(16) PRIMARY KEY,
  label      VARCHAR(64) NOT NULL       -- fixes UPDATE anomaly: rename label in ONE row
) ENGINE=InnoDB;
CREATE TABLE account (
  account_id BIGINT NOT NULL AUTO_INCREMENT,
  type_code  VARCHAR(16) NOT NULL,
  PRIMARY KEY (account_id),             -- fixes DELETE anomaly: account exists independent of txns
  CONSTRAINT fk_a_type FOREIGN KEY (type_code) REFERENCES account_type(type_code)
) ENGINE=InnoDB;
```

**⚠️ Failure modes & gotchas.**
- **Partial-update anomaly under concurrency** (M07/M08) — two sessions each updating "some copies" interleave into a state neither intended.
- **Delete anomaly hides as "cleanup"** — deleting the last child row silently erases a parent fact.
- **Insert anomaly forces fake rows** — placeholder/sentinel rows invented just to record an independent fact.

**💰 Fintech lens.** In money systems the delete anomaly is especially nasty: "clean up" a reversed transaction and you may erase the only record an account/relationship existed — destroying audit trail (tie to never-delete, M01/1.6).

**🎯 Interview / SD angle.** Use the three anomalies as a **diagnostic vocabulary**: given a schema, predict which anomaly it suffers and which normal form fixes it. Strong signal that you reason from root cause, not pattern-matching.

**✅ Self-check.**
1. Name the three anomalies and the single root cause they share.
2. Which anomaly makes you invent placeholder rows, and why?
3. Why is the partial-update anomaly worse under concurrency?

---

## 2.3 · Functional dependencies (FDs)

**🔧 Code-specifics.**
```sql
-- You can't DECLARE an FD in MySQL; you ENCODE it structurally + enforce what you can:
--   account_id → currency   ⇒  currency lives on `account` (keyed by account_id), not copied
ALTER TABLE account ADD COLUMN currency CHAR(3) NOT NULL;   -- one row per account fixes it
--   bank_code → bank_name   ⇒  separate bank table (3NF, 2.7)
-- MySQL DOES reason about FDs in ONLY_FULL_GROUP_BY:
SELECT account_id, currency FROM account GROUP BY account_id;  -- OK: account_id → currency
-- SELECT account_id, status  FROM ledger_entry GROUP BY account_id;  -- ERROR if status not functionally determined
```

**⚠️ Failure modes & gotchas.**
- **Assuming a false FD** (e.g., `zip → city`, which has exceptions) → "correctly" normalizing around a rule that doesn't hold.
- **Disabling `ONLY_FULL_GROUP_BY`** to silence errors → MySQL returns an *arbitrary* value for non-determined columns (a real correctness bug).
- **Confusing an FD (single-valued) with an MVD** (one account → many signatories) → wrong decomposition (2.9).

**💰 Fintech lens.** FDs are where you encode real domain rules ("an account has one currency," "a transaction's lines sum to zero"). A wrong FD in a money schema is a wrong invariant — the schema will faithfully enforce the wrong thing.

**🎯 Interview / SD angle.** Saying "let me write the functional dependencies first" before normalizing is a senior tell — it shows you derive normal forms rather than guess. Mention that `ONLY_FULL_GROUP_BY` is literally FD reasoning in MySQL.

**✅ Self-check.**
1. What does `X → Y` assert, precisely?
2. Why is asserting a false FD dangerous even if you normalize "correctly"?
3. How does MySQL's `ONLY_FULL_GROUP_BY` relate to FDs?

---

## 2.4 · Keys, revisited through FDs

**🔧 Code-specifics.**
```sql
-- A candidate key = an attribute set whose FD-closure covers ALL attributes.
-- You DERIVE it, then DECLARE it (MySQL won't compute it for you):
CREATE TABLE ledger_line (
  transaction_id BIGINT NOT NULL,
  line_no        INT    NOT NULL,
  amount         DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (transaction_id, line_no)        -- the minimal candidate key, derived via closure
) ENGINE=InnoDB;
-- Multiple overlapping candidate keys → one PK + UNIQUEs (preserves BCNF guarantees, 2.8):
ALTER TABLE account ADD UNIQUE KEY uq_iban (iban);   -- alternate candidate key
```

**⚠️ Failure modes & gotchas.**
- **Choosing a superkey (non-minimal) as PK** → wider clustered key, bloats every InnoDB secondary index (M01/1.3).
- **Missing a candidate key entirely** on a wide legacy table → duplicates and anomalies hide.
- **Closure done with wrong FDs** → wrong "key."

**💰 Fintech lens.** Deriving the true key of a messy inherited financial table (via closure) is how you find the *real* uniqueness rule that's been silently violated — e.g., discovering there's no constraint preventing a duplicated transaction line.

**🎯 Interview / SD angle.** Be ready to **compute a candidate key from FDs by closure** live — a classic exercise. Distinguish prime vs non-prime attributes (the vocabulary 2NF/3NF use). Note minimality matters physically in InnoDB.

**✅ Self-check.**
1. Define a candidate key in terms of FD closure.
2. Prime vs non-prime attribute — what's the difference?
3. Why does choosing a non-minimal key hurt in InnoDB specifically?

---

## 2.5 · First Normal Form (1NF): atomic values

**🔧 Code-specifics.**
```sql
-- ❌ smuggled list: customer.phone_numbers VARCHAR(255) = '555-1,555-2'
--    WHERE phone_numbers LIKE '%555-2%'  -- full scan, matches substrings, no integrity
-- ✅ 1NF: one value per row in a child table
CREATE TABLE customer_phone (
  customer_id BIGINT NOT NULL,
  phone       VARCHAR(32) NOT NULL,
  PRIMARY KEY (customer_id, phone),
  CONSTRAINT fk_p_cust FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
) ENGINE=InnoDB;
-- ✅ sanctioned exception: document-shaped data queried as a unit → JSON + indexed generated col (M03)
ALTER TABLE account ADD COLUMN metadata JSON,
  ADD COLUMN tier VARCHAR(16) AS (metadata->>'$.tier') STORED, ADD KEY ix_tier (tier);
```

**⚠️ Failure modes & gotchas.**
- **CSV/`FIND_IN_SET` columns** → no index, full scans, substring false-matches, no FK.
- **`item1, item2, item3` repeating columns** → can't query "all items," fixed arity.
- **Over-using JSON** as an EAV escape hatch (M01/1.18) instead of proper rows.

**💰 Fintech lens.** A list of entry IDs or account IDs crammed in one column means you **can't FK them** — referential integrity on money references is gone (M01/1.18 dangling-reference risk). Money references must be first-class rows.

**🎯 Interview / SD angle.** State that **"atomic" is relative to your queries** (a full name is atomic unless you filter by surname). Draw the line: query *into* it → rows; fetch *as a unit* → JSON is OK. Naming JSON+generated-column as the modern exception signals current MySQL knowledge.

**✅ Self-check.**
1. Why can't you index an individual element of a CSV column?
2. When is a JSON column a legitimate 1NF exception?
3. What does "atomic" depend on?

---

## 2.6 · Second Normal Form (2NF): no partial dependencies

**🔧 Code-specifics.**
```sql
-- ❌ partial dependency: account_currency depends on account_id, not the whole (txn_id,line_no)
-- ledger_entry(transaction_id, line_no, account_id, amount, account_currency)
-- ✅ 2NF: move the partially-dependent attr to where its determinant is the key
ALTER TABLE ledger_entry DROP COLUMN account_currency;     -- shrinks the clustered row (M09 win)
-- currency now lives on account, keyed by account_id:
--   account(account_id PK, currency CHAR(3) NOT NULL)
```

**⚠️ Failure modes & gotchas.**
- **Partial deps hide on composite-key tables** (junctions, line items) — exactly the fintech shapes.
- **The redundant column also sits in every secondary index** that included it → wasted space + IO.
- **2NF often co-occurs with 3NF violations** — fix together.

**💰 Fintech lens.** Removing a partially-dependent column from the high-volume `ledger_entry` line table is *also* a storage/IO win on your hottest table (more lines per InnoDB page, M09) — normalization paying performance dividends, not costing them.

**🎯 Interview / SD angle.** Note 2NF **only matters with composite keys** — and those are common in fintech (transaction lines, junctions). Tie the fix to a concrete InnoDB clustered-row size win to show you connect modeling to physical performance.

**✅ Self-check.**
1. When can a table even *have* a 2NF violation?
2. What's a partial dependency, in terms of the key?
3. What InnoDB performance side-benefit does fixing 2NF give on a line table?

---

## 2.7 · Third Normal Form (3NF): no transitive dependencies

**🔧 Code-specifics.**
```sql
-- ❌ transitive: account_id → bank_code → bank_name (bank_name depends via bank_code)
-- account(account_id, bank_code, bank_name, ...)
-- ✅ 3NF: lookup moves to its own entity
CREATE TABLE bank (
  bank_code VARCHAR(8) PRIMARY KEY,
  bank_name VARCHAR(128) NOT NULL          -- bank rename = ONE row now
) ENGINE=InnoDB;
ALTER TABLE account DROP COLUMN bank_name,
  ADD CONSTRAINT fk_a_bank FOREIGN KEY (bank_code) REFERENCES bank(bank_code);
-- If a hot read needs bank_name, try a COVERING INDEX before denormalizing (M05):
--   ALTER TABLE bank ADD KEY ix_bank_cover (bank_code, bank_name);
```

**⚠️ Failure modes & gotchas.**
- **Accidental transitive dependency** (a copy nobody noticed) → silent update anomaly.
- **Premature denormalization** of a lookup before measuring or trying a covering index.
- **The "why does this row know that?" smell** ignored.

**💰 Fintech lens.** A transitively-stored attribute (bank name on every account) renamed in some rows but not others is the classic drift; 3NF makes a bank rename atomic. Keep deliberate denormalizations (if any) explicitly sync-managed (2.15).

**🎯 Interview / SD angle.** 3NF is **the practical target** (2.11). The senior nuance: "before denormalizing a 3NF lookup on a hot path, **try a covering index first** (M05), validated with EXPLAIN (M06)" — shows you exhaust cheaper options before taking on consistency debt.

**✅ Self-check.**
1. What's a transitive dependency (key → A → B)?
2. What's the "smell" that flags one?
3. What's the first thing to try before denormalizing a hot 3NF lookup?

---

## 2.8 · Boyce-Codd Normal Form (BCNF): every determinant is a key

**🔧 Code-specifics.**
```sql
-- 3NF can pass but BCNF fails when a non-key determinant exists among overlapping candidate keys.
-- ❌ link(account_id, signatory, role) with FD: signatory → role  (signatory not a key)
-- ✅ BCNF: signatory → role gets its own table where signatory IS the key
CREATE TABLE signatory (
  signatory_id BIGINT PRIMARY KEY,
  role         ENUM('primary','secondary') NOT NULL   -- role stored ONCE per signatory
) ENGINE=InnoDB;
-- link table keeps signatory as FK:
--   account_signatory(account_id, signatory_id, PRIMARY KEY(account_id, signatory_id), FK signatory_id)
-- ⚠ if a BCNF split makes an FD only checkable via join → may stay at 3NF + enforce via app/trigger
```

**⚠️ Failure modes & gotchas.**
- **BCNF decomposition not always dependency-preserving** → some FD now needs a join/app-check; rare reason to stay at 3NF.
- **BCNF violations need overlapping candidate keys** — uncommon, so easy to miss when present.
- **Relying on a multi-column UNIQUE to approximate** a lost FD without realizing the gap.

**💰 Fintech lens.** A signatory's role repeated across every account they're on, edited inconsistently, means ambiguous authorization (who can move money, in what capacity) — BCNF makes the role single-sourced.

**🎯 Interview / SD angle.** Lead with the **clean rule: "every determinant must be a candidate key"** (easier than 3NF's exception-laden definition). Mention the **dependency-preservation tradeoff** (BCNF vs 3NF) — high-signal, most candidates don't.

**✅ Self-check.**
1. State the one-line BCNF test.
2. What structural situation is required for a 3NF-but-not-BCNF table?
3. When might you deliberately stop at 3NF instead of BCNF?

---

*Enrichment for 2.1–2.8 complete. Next Pass D file: 2.9–2.11.*
