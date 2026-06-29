# M01 · Pass D — Enrichment · Concepts 1.1–1.8

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL/DDL/config appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check** questions. Pairs with `01-relational-core.md` (Pass B) and `04-passC-…` (Pass C). Domain: payments/wallet.

---

## 1.1 · The relational model

**🔧 Code-specifics.** No code per se — the relational model is theory. The one concrete artifact worth seeing is that *declarative* SQL hides the physical "how":
```sql
-- You declare the SET you want; the optimizer picks the access path.
SELECT account_id FROM account WHERE status = 'active' AND currency = 'USD';
-- Same statement is satisfied by a full scan today and an index seek tomorrow
-- after: CREATE INDEX ix_acct_status_ccy ON account (status, currency);
-- The query text does NOT change — that invariance IS data independence.
```

**⚠️ Failure modes & gotchas.**
- **Thinking procedurally in a declarative system** — writing queries that force a particular access path (correlated subqueries, row-by-row cursors) when a set-based query would let the optimizer do better.
- **Assuming "relational" guarantees purity** — SQL relaxes the model (bags, NULLs, order leaks); relying on textbook relational properties MySQL doesn't actually enforce is a recurring bug source (see 1.2, 1.7).

**💰 Fintech lens.** The declarative/set mindset is *why* you can reason about money in aggregates ("sum all entries for this account," "all unsettled transactions today") rather than walking records — and why the system of record can stay authoritative while physical layout (indexes, partitions, shards) changes underneath without altering what the money queries *mean*.

**🎯 Interview / SD angle.** If asked "why relational for a ledger?" the crisp answer is **data independence + set-based integrity**: you get ad-hoc queryability and engine-enforced invariants, and you can re-tune storage without rewriting application queries. Name the tradeoff: you pay join cost and an impedance mismatch vs document/KV stores, which is acceptable because correctness and queryability dominate for money.

**✅ Self-check.**
1. What does "data independence" let you change without rewriting queries?
2. Why is relational algebra being *closed* (ops return relations) important?
3. Give one thing SQL relaxes from the pure relational model.

---

## 1.2 · Relations vs tables (theory vs SQL)

**🔧 Code-specifics.** A table is a bag until a key makes it a set:
```sql
-- Without a key, byte-identical duplicate rows are physically storable.
-- Re-impose set semantics with a uniqueness promise the duplicate violates:
ALTER TABLE ledger_entry
  ADD CONSTRAINT uq_entry_idem UNIQUE (transaction_id, idempotency_key);

-- Order only exists where you ask for it; never rely on storage order:
SELECT * FROM ledger_entry WHERE account_id = 42 ORDER BY created_at, entry_id;
```

**⚠️ Failure modes & gotchas.**
- **Relying on implicit row order** (insertion/clustered order) — works until a plan change reorders results; the classic "it was sorted in dev" bug. Always `ORDER BY`.
- **Forgetting a uniqueness constraint** → duplicate "facts" (double-posted entries) that the bag happily stores.
- **`LIMIT` without `ORDER BY`** returns an arbitrary row, not "the first."

**💰 Fintech lens.** The retry-storm double-post (Pass C example) is *the* canonical money bug this concept prevents: enforce uniqueness on the idempotency/transaction identity so a SQL table behaves like the set the ledger logically is. Without it, balances drift by real money.

**🎯 Interview / SD angle.** A strong signal in interviews: when someone says "table," ask "is it a set or a bag here — what enforces no duplicates?" Tie it to **idempotency** (M16): the uniqueness constraint is how you make at-least-once delivery safe.

**✅ Self-check.**
1. Name three ways a SQL table diverges from a mathematical relation.
2. What single declaration drags a table back toward set semantics?
3. Why is `SELECT … LIMIT 10` without `ORDER BY` a latent bug?

---

## 1.3 · Keys: candidate, primary, alternate

**🔧 Code-specifics.**
```sql
CREATE TABLE account (
  account_id    BIGINT       NOT NULL AUTO_INCREMENT,   -- surrogate (1.4)
  bank_code     CHAR(8)      NOT NULL,
  account_number VARCHAR(34) NOT NULL,
  currency      CHAR(3)      NOT NULL,
  status        ENUM('active','closed') NOT NULL DEFAULT 'active',
  PRIMARY KEY (account_id),                              -- primary key = InnoDB clustered index
  UNIQUE KEY uq_bank_number (bank_code, account_number)  -- alternate (candidate) key
) ENGINE=InnoDB;
```

**⚠️ Failure modes & gotchas.**
- **No explicit PK** → InnoDB invents a hidden 6-byte rowid you can't use, and you lose control of clustering.
- **Wide/volatile PK** → it's embedded in *every* secondary index (InnoDB), bloating storage and slowing everything; changing a PK value cascades through FKs.
- **Promoting the business key to PK** couples row identity to data an external party controls (1.4).

**💰 Fintech lens.** PK choice on `ledger_entry`/`transaction` sets the physical clustering of your highest-volume tables (statement scans, M05) and the size of every index on the ledger — a direct, ongoing performance and cost lever as the books grow forever.

**🎯 Interview / SD angle.** Expect "natural vs surrogate PK?" and "what makes a good PK in InnoDB?" Winning answer names **short, monotonic, stable, and the clustered-index implication** — and that the *business* uniqueness rule still lives in a separate UNIQUE key. Distinguish *candidate* (minimal unique) from *primary* (the chosen canonical one).

**✅ Self-check.**
1. Superkey vs candidate key vs primary key — define each in one line.
2. In InnoDB, why does PK width affect *every* secondary index?
3. Where does the business uniqueness rule go if the PK is a surrogate?

---

## 1.4 · Natural vs surrogate keys

**🔧 Code-specifics.**
```sql
-- Surrogate PK for identity + natural key kept as UNIQUE for the business rule:
CREATE TABLE account (
  account_id BIGINT NOT NULL AUTO_INCREMENT,
  iban       VARCHAR(34) NOT NULL,
  PRIMARY KEY (account_id),
  UNIQUE KEY uq_iban (iban)          -- natural identifier, enforced but NOT the identity
) ENGINE=InnoDB;
-- If you need distributed/unguessable ids instead of AUTO_INCREMENT, see 1.15:
--   account_id BINARY(16)  -- store a UUIDv7/ULID as 16 bytes, never CHAR(36)
```

**⚠️ Failure modes & gotchas.**
- **Surrogate PK but forgot the natural UNIQUE** → two "same" customers/accounts (duplicate business entities the surrogate can't prevent).
- **Natural key as PK** → reassignment/format changes corrupt references (the IBAN-reassignment story, Pass C).
- **Mutable natural PK** → updating it cascades through all FKs (expensive, lock-heavy).

**💰 Fintech lens.** External identifiers (IBAN, card PAN, MSISDN) get rotated, masked, and *reassigned*. A stable surrogate `account_id` guarantees ledger entries never silently re-point at a different party — a core *money-never-lies* protection.

**🎯 Interview / SD angle.** The expected answer to "natural or surrogate?": **surrogate for identity, natural as a UNIQUE alternate key** — and articulate *why* (stability, decoupling from external control, InnoDB index width). Bonus: mention exposing an unguessable *public* ID separate from the internal sequential PK (don't leak counts).

**✅ Self-check.**
1. Why keep the natural key at all if you use a surrogate PK?
2. What breaks if you make a mutable business value your primary key?
3. When is a natural key genuinely acceptable as PK?

---

## 1.5 · Foreign keys & referential integrity

**🔧 Code-specifics.**
```sql
CREATE TABLE ledger_entry (
  entry_id   BIGINT NOT NULL AUTO_INCREMENT,
  account_id BIGINT NOT NULL,
  amount     DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (entry_id),
  KEY ix_account (account_id),                      -- index the child side for fast checks
  CONSTRAINT fk_entry_account FOREIGN KEY (account_id)
    REFERENCES account (account_id)                 -- referenced cols must be a key/indexed
) ENGINE=InnoDB;                                     -- FKs are an InnoDB feature; MyISAM ignores them
```

**⚠️ Failure modes & gotchas.**
- **MyISAM silently ignores FKs** — they parse but enforce nothing; a historic footgun.
- **Missing index on referenced/child columns** → slow checks, lock contention on hot parents.
- **Big cascading deletes** → wide locks, long transactions, replication lag.
- **Online schema-change tools** (gh-ost/pt-osc, M13) struggle with FKs.

**💰 Fintech lens.** A dangling `ledger_entry.account_id` is *orphaned money* — a movement attributed to nothing, invisible until reconciliation. The FK makes that state unrepresentable; dropping FKs for scale (M11) means you must replace the guarantee with app checks + async reconciliation, deliberately.

**🎯 Interview / SD angle.** Be ready to argue **both sides**: FKs give hard integrity but cost write throughput and block cross-shard scaling, so high-scale systems sometimes drop them and enforce integrity in the app/reconciliation. State it as a *deliberate tradeoff*, never an accident; for correctness-critical fintech tables, integrity usually wins.

**✅ Self-check.**
1. What two things must be true (engine, indexing) for an FK to work well in MySQL?
2. Why might a huge system *remove* DB-enforced FKs — and what replaces them?
3. What real-world bad state does an FK on `ledger_entry.account_id` prevent?

---

## 1.6 · Referential actions (CASCADE / RESTRICT / SET NULL / NO ACTION)

**🔧 Code-specifics.**
```sql
-- Audit-critical: block deletes that would strand children. Never CASCADE the ledger.
CONSTRAINT fk_entry_account FOREIGN KEY (account_id)
  REFERENCES account (account_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Soft-delete pattern instead of physical delete (preserves audit history):
ALTER TABLE account ADD COLUMN closed_at DATETIME NULL;     -- mark, don't remove
-- Note: SET DEFAULT is parsed but UNSUPPORTED by InnoDB; cascades BYPASS triggers.
```

**⚠️ Failure modes & gotchas.**
- **`ON DELETE CASCADE` on audit data** → one DELETE silently erases subtrees of history; **InnoDB cascades skip triggers**, so audit-logging triggers don't fire.
- **`SET NULL`** requires a nullable FK and introduces 3VL hazards (1.7) + "entry belonging to no account" semantics.
- **`SET DEFAULT`** silently does nothing in InnoDB.

**💰 Fintech lens (★).** The load-bearing rule: **ledgers RESTRICT (or are append-only/soft-delete), never CASCADE.** Cascading a customer delete into ledger entries destroys the legal financial record with no trace. Accounts/customers are *closed*, not deleted; entries are never deleted at all.

**🎯 Interview / SD angle.** A great signal: when asked "how do you handle deleting a user with data?", answer **soft delete + RESTRICT for audit-critical data**, and explain *why CASCADE is dangerous* (silent mass deletion, trigger bypass). Mention regulatory retention.

**✅ Self-check.**
1. Why is CASCADE especially dangerous for audited financial data?
2. What does InnoDB do with `ON DELETE SET DEFAULT`?
3. What's the safe pattern for "deleting" an account that has ledger entries?

---

## 1.7 · NULL and three-valued logic

**🔧 Code-specifics.**
```sql
-- Absence must be tested explicitly; '=' never matches NULL:
SELECT * FROM account WHERE balance IS NULL;          -- correct
SELECT * FROM account WHERE balance = NULL;           -- WRONG: always UNKNOWN → 0 rows
-- NULL-safe equality when you DO want to match unknowns:
SELECT * FROM account WHERE balance <=> NULL;         -- TRUE when balance IS NULL
-- Make money unambiguous: forbid NULL, default 0, enforce sign:
ALTER TABLE account
  MODIFY balance DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_balance_nonneg CHECK (balance >= 0);   -- enforced on 8.0.16+
```

**⚠️ Failure modes & gotchas.**
- **`WHERE x <> v` silently drops NULL rows** (the lost-rows bug, Pass C).
- **`COUNT(col)` skips NULLs; `COUNT(*)` doesn't** — different answers.
- **UNIQUE allows multiple NULLs** — a UNIQUE column is *not* unique across NULLs.
- **`NOT IN (subquery)` with a NULL in the subquery** → returns no rows (3VL surprise).

**💰 Fintech lens.** Nullable money/amount columns make aggregates and comparisons ambiguous exactly where you need certainty. Fintech schemas minimize nullable numeric columns: `NOT NULL DEFAULT 0` + CHECK, or model "not computed yet" as an explicit *status*, not a NULL balance.

**🎯 Interview / SD angle.** Drop "three-valued logic" and the `NOT IN`/NULL trap — strong senior signals. Frame: *absence is not a value; SQL's 3VL is a leaky handling of it; enforce NOT NULL where ambiguity is unacceptable.*

**✅ Self-check.**
1. Why does `balance <> 0` exclude rows where balance IS NULL?
2. How do `COUNT(*)` and `COUNT(balance)` differ?
3. Why can a UNIQUE constraint still allow two rows that "look" the same?

---

## 1.8 · Domains, constraints & the closed-world assumption

**🔧 Code-specifics.**
```sql
CREATE TABLE ledger_entry (
  entry_id   BIGINT NOT NULL AUTO_INCREMENT,
  account_id BIGINT NOT NULL,
  amount     DECIMAL(18,2) NOT NULL,
  currency   CHAR(3) NOT NULL,
  PRIMARY KEY (entry_id),
  CONSTRAINT ck_amount_nonneg CHECK (amount >= 0),                 -- enforced 8.0.16+
  CONSTRAINT ck_currency CHECK (currency IN ('USD','EUR','GBP'))
) ENGINE=InnoDB;
-- Strict mode turns silent coercion into rejection (set per session or globally):
SET SESSION sql_mode = 'STRICT_ALL_TABLES';
SELECT @@version;   -- confirm >= 8.0.16 or CHECK is parsed-but-ignored!
```

**⚠️ Failure modes & gotchas.**
- **CHECK silently ignored before MySQL 8.0.16** — the fence looks present but enforces nothing.
- **Not running strict mode** → bad data is truncated/coerced instead of rejected (out-of-range numbers clamped, too-long strings cut, invalid dates → `0000-00-00`).
- **Adding a constraint to a huge table** is an expensive migration (M13).
- **ENUM edge cases** — ordering surprises; invalid value becomes empty string in loose modes.

**💰 Fintech lens.** Constraints are the *structural* prevention layer behind *money-never-lies*: `CHECK (amount >= 0)`, currency domains, NOT NULL on money columns make whole classes of bad money rows impossible in any code path — the last line that can't be bypassed by a buggy service or migration script.

**🎯 Interview / SD angle.** Theme: **push hard invariants into the schema (engine-guaranteed), richer/contextual rules into the app.** Name the MySQL caveat (verify 8.0.16+ and strict mode) — it shows you know the difference between "declared" and "enforced." Connect to "make illegal states unrepresentable."

**✅ Self-check.**
1. On what MySQL version did CHECK constraints start being enforced?
2. What does strict SQL mode change about bad-data handling?
3. Which invariants belong in the schema vs the application, and why?

---

*Enrichment for 1.1–1.8 complete. Next Pass D file: 1.9–1.14.*
