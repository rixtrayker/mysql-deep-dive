# M01 · Pass D — Enrichment · Concepts 1.9–1.14

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-modeling-and-er.md` + `05-passC-…`. Domain: payments/wallet.

---

## 1.9 · Conceptual → logical → physical modeling

**🔧 Code-specifics.** The same idea descends to MySQL-specific DDL only at the physical layer:
```sql
-- LOGICAL (vendor-neutral intent): customer 1—N account, owner mandatory.
-- PHYSICAL (MySQL reality lands here):
CREATE TABLE account (
  account_id  BIGINT NOT NULL AUTO_INCREMENT,   -- type + clustering decision (M05)
  customer_id BIGINT NOT NULL,                  -- mandatory owner → NOT NULL
  currency    CHAR(3) NOT NULL,
  PRIMARY KEY (account_id),
  KEY ix_customer (customer_id),                -- because "accounts for a customer" is hot (1.14)
  CONSTRAINT fk_acct_cust FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
) ENGINE=InnoDB;
```

**⚠️ Failure modes & gotchas.**
- **Skipping the conceptual layer** → baking in a wrong business assumption that's expensive to undo after data exists.
- **Leaking physical concerns up** (designing the conceptual model around MySQL index quirks) → an unvalidated, hard-to-explain model.
- **Treating the logical model as final** and never tuning physically → correct but slow.

**💰 Fintech lens.** The conceptual model is where you validate *with compliance/finance people* that "a transaction balances" and "entries are immutable" before any table exists — catching a regulatory misunderstanding on a whiteboard instead of in a migration.

**🎯 Interview / SD angle.** In a design round, *explicitly move through the altitudes*: state entities/relationships first (conceptual), then keys/normalization (logical), then index/PK/engine/sharding (physical). It signals structured thinking and keeps you from prematurely optimizing storage before the model is right.

**✅ Self-check.**
1. What belongs at each altitude (conceptual / logical / physical)?
2. Which layer is portable across SQL databases, and which is MySQL-specific?
3. What's the risk of jumping straight to `CREATE TABLE`?

---

## 1.10 · Entities, attributes & relationships (ER modeling)

**🔧 Code-specifics.** A multi-valued attribute signals a child table, not a column:
```sql
-- WRONG: phone numbers as a column (violates 1NF, M02; can't index/query individually)
-- customer.phone_numbers VARCHAR(255)  -- "555-1, 555-2"  ← anti-pattern (1.18)

-- RIGHT: multi-valued attribute → child table
CREATE TABLE customer_phone (
  customer_id BIGINT NOT NULL,
  phone       VARCHAR(32) NOT NULL,
  PRIMARY KEY (customer_id, phone),
  CONSTRAINT fk_phone_cust FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
) ENGINE=InnoDB;
```

**⚠️ Failure modes & gotchas.**
- **Multi-valued attribute crammed into one column** (CSV) → un-queryable, no integrity (1.18).
- **Composite attribute** (address) modeled as one blob when you need to query parts.
- **Over-modeling** — drawing speculative entities before you know they're needed.
- **Confusing an attribute with an entity** (is "currency" a column or its own table with metadata?).

**💰 Fintech lens.** Getting entity boundaries right early (party vs account vs transaction vs entry) is what lets the model scale into double-entry and sharding (M11/M16). A `transaction` that's really two concepts mashed together becomes a god-table (1.18) later.

**🎯 Interview / SD angle.** Decompose the prompt out loud: **nouns → entities, details → attributes, verbs → relationships.** Flag multi-valued/composite attributes as future child tables. Interviewers watch for whether you spot M:N and weak entities (1.12/1.13) from the wording.

**✅ Self-check.**
1. What does a multi-valued attribute tell you about the schema?
2. Entity vs attribute — what tips "currency" from column to table?
3. From "a customer holds accounts," what's the entity, attribute, relationship?

---

## 1.11 · Cardinality & optionality

**🔧 Code-specifics.**
```sql
-- 1:N, mandatory participation → FK on the many side, NOT NULL:
account.customer_id BIGINT NOT NULL   -- every account MUST have exactly one owner
-- 1:1 → UNIQUE FK (or shared PK) to isolate sensitive/cold columns:
CREATE TABLE account_kyc (
  account_id BIGINT NOT NULL,
  PRIMARY KEY (account_id),                              -- shared PK = 1:1
  CONSTRAINT fk_kyc_acct FOREIGN KEY (account_id) REFERENCES account(account_id)
) ENGINE=InnoDB;
-- "every customer must have >=1 account" is NOT expressible with a plain FK → app/trigger logic.
```

**⚠️ Failure modes & gotchas.**
- **Modeling 1:N when it's secretly M:N** (joint accounts) → painful migration to a junction (1.12).
- **Wrong optionality** → orphan accounts (FK nullable when it should be mandatory) or impossible inserts (mandatory when zero is valid).
- **Minimum-cardinality > 0 on the "one" side** can't be a simple FK — needs app/trigger/deferred logic.

**💰 Fintech lens.** "An account has exactly one owner" vs "joint accounts allowed" is a *business/legal* distinction that, modeled wrong, either blocks a product (can't add a co-owner) or corrupts ownership. Decide it with the business before the FK shape is set.

**🎯 Interview / SD angle.** Always nail down **both axes** explicitly: "one or many?" *and* "is zero allowed?" Mention that FKs enforce "child needs a parent," **not** "parent needs ≥1 child" — a limitation worth stating. Leaning M:N when "many" is plausible makes evolution cheaper.

**✅ Self-check.**
1. Where does the FK go for a 1:N relationship, and why?
2. How do you express mandatory vs optional participation in MySQL?
3. Why can't a plain FK enforce "every customer has at least one account"?

---

## 1.12 · Associative (junction) tables & many-to-many

**🔧 Code-specifics.**
```sql
CREATE TABLE account_holder (
  customer_id BIGINT NOT NULL,
  account_id  BIGINT NOT NULL,
  role        ENUM('primary','secondary') NOT NULL,
  added_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, account_id),                 -- composite PK forbids dup pairings
  KEY ix_holder_account (account_id, customer_id),       -- reverse lookup "who holds acct X?"
  CONSTRAINT fk_h_cust FOREIGN KEY (customer_id) REFERENCES customer(customer_id),
  CONSTRAINT fk_h_acct FOREIGN KEY (account_id)  REFERENCES account(account_id)
) ENGINE=InnoDB;
```

**⚠️ Failure modes & gotchas.**
- **Missing the reverse index** `(account_id, customer_id)` → "who holds this account?" becomes a full scan (leftmost-prefix, M05).
- **No PK/UNIQUE on the pair** → duplicate pairings (same holder twice).
- **CSV of IDs instead of a junction** (1.18) → no integrity, no indexing.
- **Surrogate-vs-composite PK** chosen without thinking about who references the relationship.

**💰 Fintech lens.** Joint accounts, beneficiaries, authorized signatories — all M:N with *relationship attributes* (role, permission, added date) that only a junction can hold. Getting this right is prerequisite to authorization and audit (who could move money, since when).

**🎯 Interview / SD angle.** Recognizing M:N → junction is table stakes; the senior signal is mentioning the **reverse index** and the **composite-vs-surrogate PK** tradeoff, and noting the junction is the home for relationship attributes ("reify the relationship").

**✅ Self-check.**
1. Why can't M:N be a single foreign key?
2. What index does a bidirectionally-queried junction need beyond its PK?
3. When would you give the junction a surrogate PK instead of a composite one?

---

## 1.13 · Weak entities & identifying relationships

**🔧 Code-specifics.**
```sql
-- Pure weak entity: parent key + local discriminator as composite PK
CREATE TABLE ledger_line (
  transaction_id BIGINT NOT NULL,
  line_no        INT    NOT NULL,
  account_id     BIGINT NOT NULL,
  amount         DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (transaction_id, line_no),                 -- borrows parent key; clusters lines together
  CONSTRAINT fk_line_txn FOREIGN KEY (transaction_id)
    REFERENCES transaction_(transaction_id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- Pragmatic alternative: surrogate PK + UNIQUE to keep the invariant without the composite-key tax:
--   id BIGINT AUTO_INCREMENT PRIMARY KEY, UNIQUE KEY uq_line (transaction_id, line_no)
```

**⚠️ Failure modes & gotchas.**
- **Composite key propagates** into every referencing table (wider FKs, bigger indexes) — sometimes the surrogate+UNIQUE alternative is better.
- **CASCADE here is defensible** (a line can't outlive its txn) — but for ledger/audit data the never-delete rule (1.6) still applies.
- **Forgetting the local discriminator is only unique *within* the parent.**

**💰 Fintech lens.** Transaction lines / payment legs are the textbook weak entity. The composite PK leading with `transaction_id` clusters all of a transaction's lines together (fast "fetch whole transaction"), and makes "lines are unique within a transaction" structural — directly supporting double-entry posting (1.19/M16).

**🎯 Interview / SD angle.** Identify weak entities by the test "**can this row be identified without its parent?**" Mention the composite-PK *clustering* benefit (a performance win, not just modeling purity) and the pragmatic surrogate+UNIQUE alternative — shows you balance theory and ops.

**✅ Self-check.**
1. What makes an entity "weak"?
2. How is its primary key constructed?
3. What InnoDB performance benefit comes from a parent-led composite PK?

---

## 1.14 · Designing for the queries you'll run

**🔧 Code-specifics.**
```sql
-- Query-shaped clustered key: statements = sequential scan within an account
CREATE TABLE ledger_entry (
  account_id BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  entry_id   BIGINT NOT NULL AUTO_INCREMENT,
  amount     DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (account_id, created_at, entry_id),   -- clusters an account's history by time
  UNIQUE KEY uq_entry (entry_id)                     -- keep a global handle too
) ENGINE=InnoDB;
-- Derived cache for O(1) balance reads (maintained transactionally with each insert):
CREATE TABLE account_balance (account_id BIGINT PRIMARY KEY, balance DECIMAL(18,2) NOT NULL);
-- Verify the plan instead of guessing:
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42 AND created_at >= '2025-01-01';
```

**⚠️ Failure modes & gotchas.**
- **Random PK (UUIDv4)** → statement scans become scattered random IO (1.15, M09).
- **Denormalized balance drifting** from the entry log if not updated in the *same* transaction (reconciliation needed, M16).
- **Over-fitting to today's queries** → tomorrow's access pattern is painful.
- **Premature denormalization** → write-time duplication bugs.

**💰 Fintech lens.** The whole "log is source of truth, balance is a rebuildable cache" pattern lives here: fast reads from `account_balance`, integrity/audit from the immutable `ledger_entry`, continuous reconciliation that `balance == SUM(entries)`. This is the practical spine of M16.

**🎯 Interview / SD angle.** Say it explicitly: **"there's no schema without a workload."** Enumerate access patterns first, then choose PK/clustering, covering indexes, and summary tables to serve them; keep the system of record normalized and treat read-models as derived. The `write query → EXPLAIN → adjust → repeat` loop (M06) is the concrete method.

**✅ Self-check.**
1. Why does PK choice affect statement-query performance in InnoDB?
2. What keeps a denormalized balance from drifting from the ledger?
3. What's the rule about which structures are the "source of truth"?

---

*Enrichment for 1.9–1.14 complete. Next Pass D file: 1.15–1.19.*
