# M01 · Pass D — Enrichment · Concepts 1.15–1.19

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-deeper-…money.md` + `06-passC-…`. Domain: payments/wallet. These close out M01.

---

## 1.15 · Surrogate-key generation strategies

**🔧 Code-specifics.**
```sql
-- Local, compact, monotonic — best clustered-index locality:
account_id BIGINT NOT NULL AUTO_INCREMENT

-- Distributed / unguessable: store a time-ordered UUIDv7/ULID as 16 BYTES, never CHAR(36):
account_id BINARY(16) NOT NULL            -- app generates UUIDv7/ULID
-- ❌ account_id CHAR(36)                  -- 36 bytes, bloats every index, slow compares
-- Optional: keep an unguessable PUBLIC id separate from the internal sequential PK:
ALTER TABLE account ADD COLUMN public_id BINARY(16) NOT NULL, ADD UNIQUE KEY uq_pub (public_id);
```
*(MySQL 8 has `UUID_TO_BIN(uuid, 1)` to store UUIDs byte-swapped for better locality; UUIDv7/ULID are generated app-side.)*

**⚠️ Failure modes & gotchas.**
- **UUIDv4 as clustered PK** → random inserts → page splits, fragmentation, buffer-pool thrash (M09).
- **UUID stored as CHAR(36)** → triples storage, wrecks comparisons, bloats every secondary index.
- **Sequential PK leaks counts** (competitors enumerate your transaction volume) and complicates sharding.
- **Embedded timestamp in ULID/UUIDv7 leaks creation time** (minor info disclosure).

**💰 Fintech lens.** The ledger is your highest-volume, fastest-growing, append-mostly table. A random PK there is a self-inflicted performance collapse; a compact monotonic or time-ordered key keeps inserts sequential and indexes healthy for years. Unguessable *public* IDs prevent leaking transaction counts/relationships.

**🎯 Interview / SD angle.** "BIGINT vs UUID PK?" — answer the **clustered-index physics** (random keys split pages and thrash cache in InnoDB), then the spectrum: auto-inc (local, leaks, hard to shard) → UUIDv7/ULID/Snowflake (distributed, time-ordered, unguessable). Mention BINARY(16) storage and the public/internal ID split. This is a frequent senior MySQL question.

**✅ Self-check.**
1. Why is a random UUID a bad *clustered* primary key in InnoDB specifically?
2. How do ULID/UUIDv7/Snowflake get "distributed but ~monotonic"?
3. Why store a UUID as BINARY(16) instead of CHAR(36)?

---

## 1.16 · Temporal & bitemporal modeling

**🔧 Code-specifics.**
```sql
-- Bitemporal FX rate: append-on-change, four time columns, never UPDATE in place.
CREATE TABLE fx_rate (
  pair          CHAR(7) NOT NULL,              -- 'USD/EUR'
  rate          DECIMAL(18,8) NOT NULL,
  valid_from    DATETIME(6) NOT NULL,          -- real-world validity (valid time)
  valid_to      DATETIME(6) NOT NULL,
  recorded_from DATETIME(6) NOT NULL,          -- when WE knew it (transaction time)
  recorded_to   DATETIME(6) NOT NULL DEFAULT '9999-12-31',
  PRIMARY KEY (pair, valid_from, recorded_from)
) ENGINE=InnoDB;
-- "what did we think on Fri the Tue rate was?":
SELECT rate FROM fx_rate
WHERE pair='USD/EUR' AND '2025-03-04' BETWEEN valid_from AND valid_to     -- Tue (valid)
  AND '2025-03-07' BETWEEN recorded_from AND recorded_to;                 -- Fri (known)
-- MySQL has NO native system-versioning (MariaDB does) → maintain ranges yourself.
```

**⚠️ Failure modes & gotchas.**
- **Overwriting instead of versioning** → can't reconstruct what was known when (compliance failure).
- **"No overlapping valid periods"** usually can't be a simple UNIQUE → app enforcement.
- **Time-zone/precision mistakes** (M03) corrupt range boundaries; use DATETIME(6), store UTC.
- **Making everything bitemporal** → needless complexity; apply it only to facts needing restatement.

**💰 Fintech lens.** Rates, prices, fee schedules, entitlements, and balances-as-of often *must* be reconstructable for audits and restatements — sometimes legally. Bitemporal lets you answer "what was true" and "what we believed" independently, which is exactly what regulators and disputes demand.

**🎯 Interview / SD angle.** Distinguish **valid time vs transaction time** crisply (the FX-correction example is gold). Note MySQL has no native support (model by hand; MariaDB/SQL:2011 do) and that uni-temporal often suffices. Connect to audit trails / event sourcing (M16).

**✅ Self-check.**
1. Valid time vs transaction time — what's the difference?
2. What question can bitemporal answer that overwriting destroys?
3. Why isn't "no overlapping valid periods" a simple UNIQUE constraint?

---

## 1.17 · Modeling history: append-only vs mutable state

**🔧 Code-specifics.**
```sql
-- Append-only log is the source of truth (INSERT only; revoke UPDATE/DELETE on it):
-- balance is a derived cache updated IN THE SAME TRANSACTION as the entry:
START TRANSACTION;
  INSERT INTO ledger_entry (account_id, amount, transaction_id)
    VALUES (42, -100.00, 700);
  UPDATE account_balance SET balance = balance - 100.00 WHERE account_id = 42;
COMMIT;            -- atomic: entry + cache move together, can't diverge (M07)
-- Rebuild/verify the cache from the log at any time (reconciliation, M16):
SELECT account_id, SUM(amount) FROM ledger_entry GROUP BY account_id;
```

**⚠️ Failure modes & gotchas.**
- **Updating balance outside the entry's transaction** → drift between cache and log (a *money-never-lies* violation).
- **Concurrent in-place balance updates** without locking → lost-update race (M07/M08).
- **Unbounded log growth** → needs partitioning/archival + snapshots (M11) so current-state reads stay fast.
- **Allowing UPDATE/DELETE on the "immutable" log** (no permission/trigger guard) defeats the audit story.

**💰 Fintech lens.** This *is* the ledger pattern: immutable append-only entries (legal truth + replay), derived balance for speed, continuous reconciliation. The whole *money-never-lies* thread rests on "the log is primary, state is derived and rebuildable."

**🎯 Interview / SD angle.** "Store events or store state?" — answer **both, with the log as source of truth and state as a transactionally-maintained projection.** Name the mirror: InnoDB's redo log is itself an append-only WAL (M09); Kafka/Git work the same way. Mention event sourcing (M16) as the maximalist form.

**✅ Self-check.**
1. Why must the balance update share the entry's transaction?
2. What do you gain from an append-only log that mutable state loses?
3. How do you keep current-state reads fast as the log grows forever?

---

## 1.18 · Data-modeling anti-patterns ★

**🔧 Code-specifics.**
```sql
-- ❌ EAV: untyped, no FK, monster pivots
--   custom_field(entity_id, attr_name VARCHAR, value VARCHAR)
-- ✅ real columns, or JSON + generated column you can index:
ALTER TABLE account ADD COLUMN attrs JSON,
  ADD COLUMN tier VARCHAR(16) AS (attrs->>'$.tier') STORED,
  ADD KEY ix_tier (tier);

-- ❌ polymorphic FK: DB can't enforce integrity
--   txn(source_type ENUM, source_id BIGINT)   -- source_id points "somewhere"
-- ✅ one real FK per source type + "exactly one set" CHECK:
ALTER TABLE txn
  ADD COLUMN card_account_id BIGINT NULL,
  ADD COLUMN bank_account_id BIGINT NULL,
  ADD CONSTRAINT fk_txn_card FOREIGN KEY (card_account_id) REFERENCES card_account(id),
  ADD CONSTRAINT fk_txn_bank FOREIGN KEY (bank_account_id) REFERENCES bank_account(id),
  ADD CONSTRAINT ck_one_source CHECK ((card_account_id IS NOT NULL) + (bank_account_id IS NOT NULL) = 1);
```

**⚠️ Failure modes & gotchas.**
- **EAV** → no typing/constraints/FK, query plans collapse (M06).
- **God-table** of 80 nullable columns → bloated hot row, ambiguous meaning, wasted buffer pool (M09).
- **CSV-in-a-column** → no index, no integrity, `WHERE id=456` can't seek (M05).
- **Polymorphic FK** → silent dangling references; the DB can't help (1.5).

**💰 Fintech lens (★).** A polymorphic FK on `transaction` means the database can't guarantee every transaction points at a real funding source → untraceable money (the Pass C example). Anti-patterns in money tables convert "the engine guards integrity" into "hope the app does," which is exactly what *money-never-lies* forbids.

**🎯 Interview / SD angle.** Naming these by name (EAV, god-table, polymorphic FK) and giving the *fix* signals seniority. The throughline to state: **"flexibility bought by hiding structure from the database is integrity the database can no longer keep."** Mention MySQL's sanctioned escape hatch: JSON + generated columns for *genuinely* dynamic attributes.

**✅ Self-check.**
1. Why can't a polymorphic FK enforce referential integrity?
2. What's the modern MySQL alternative to EAV for dynamic attributes?
3. Why does a CSV-of-IDs column defeat indexing?

---

## 1.19 · Fintech capstone — modeling a money system ★

**🔧 Code-specifics (the canonical skeleton, condensed).**
```sql
CREATE TABLE transaction_ (
  transaction_id  BIGINT NOT NULL AUTO_INCREMENT,
  idempotency_key CHAR(36) NOT NULL,
  created_at      DATETIME(6) NOT NULL,
  PRIMARY KEY (transaction_id),
  UNIQUE KEY uq_idem (idempotency_key)        -- retries can't double-post (M16)
) ENGINE=InnoDB;

CREATE TABLE ledger_entry (
  transaction_id BIGINT NOT NULL,
  line_no        INT    NOT NULL,
  account_id     BIGINT NOT NULL,
  amount         DECIMAL(18,2) NOT NULL,      -- DECIMAL or integer minor units — NEVER FLOAT
  created_at     DATETIME(6) NOT NULL,
  PRIMARY KEY (account_id, created_at, transaction_id, line_no),  -- clustered for statements (1.14)
  CONSTRAINT fk_e_txn  FOREIGN KEY (transaction_id) REFERENCES transaction_(transaction_id) ON DELETE RESTRICT,
  CONSTRAINT fk_e_acct FOREIGN KEY (account_id)     REFERENCES account(account_id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- Post a balanced transfer atomically; SUM(amount) over a transaction MUST be 0 (double-entry):
START TRANSACTION;
  INSERT INTO ledger_entry VALUES (700,1,/*Alice*/1,-100.00,NOW(6)), (700,2,/*Bob*/2,+100.00,NOW(6));
  UPDATE account_balance SET balance = balance - 100 WHERE account_id = 1;
  UPDATE account_balance SET balance = balance + 100 WHERE account_id = 2;
COMMIT;
```

**⚠️ Failure modes & gotchas.**
- **`account.balance` as the only record** (no entries) → no history, races, money can vanish/appear.
- **Single-entry (no double-entry)** → no conservation guarantee; the books can be unbalanced.
- **FLOAT for money** → silent rounding loss of cents (M03).
- **Hard-deletable transactions / CASCADE** → audit destroyed (1.6).
- **Hot-account contention** — many entries racing on one popular account's balance row (M08/M16).

**💰 Fintech lens (★).** This is the thread's home base: parties + accounts + immutable balanced entries + derived balances = money conserved by construction, fully auditable, reconcilable. Every later module specializes this (M07 atomicity, M08 contention, M11 sharding debit+credit onto one shard, M16 the full platform).

**🎯 Interview / SD angle.** Asked to "design a wallet/payments ledger," produce *this*: double-entry immutable entries, idempotency key, atomic multi-entry transaction, derived balance + reconciliation, never-delete + RESTRICT, DECIMAL money, query-shaped clustered key. Naming the **`SUM over a transaction = 0` invariant** and **idempotency** are the two highest-signal moves. This skeleton *is* the M16 starting point.

**✅ Self-check.**
1. What invariant makes double-entry "money can't be created or destroyed"?
2. Why is `account.balance` alone (no entry log) dangerous?
3. Which M01 concepts does posting one transfer exercise?
4. Why DECIMAL/minor-units instead of FLOAT for `amount`?

---

*Enrichment for 1.15–1.19 complete. **M01 Pass D is fully drafted (all 19 concepts) — M01 is now content-complete across Passes A–D.***
