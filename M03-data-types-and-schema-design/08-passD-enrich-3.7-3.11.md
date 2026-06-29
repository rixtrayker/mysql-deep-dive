# M03 · Pass D — Enrichment · Concepts 3.7–3.11

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-text-charset-temporal-enum-json.md` + `05-passC-…`. Domain: payments/wallet.

---

## 3.7 · CHAR vs VARCHAR vs TEXT/BLOB

**🔧 Code-specifics.**
```sql
CREATE TABLE account (
  account_id  BIGINT NOT NULL,
  currency    CHAR(3)      NOT NULL,   -- fixed 3 chars (ISO 4217) → CHAR
  holder_name VARCHAR(100) NOT NULL,   -- varying, bounded → VARCHAR (real bytes + len prefix)
  note        TEXT             NULL,   -- large, rarely read → off-page (3.14); prefix-index only
  PRIMARY KEY (account_id)
) ENGINE=InnoDB;
-- TEXT needs a PREFIX length to be indexed:
ALTER TABLE account ADD KEY ix_note_prefix (note(50));
-- VARCHAR length prefix: 1 byte if max < 256, else 2. Byte length scales with charset (3.8).
```

**⚠️ Failure modes & gotchas.**
- **`VARCHAR(255)` for everything** → over-declared lengths bloat index keys + force max allocation in in-memory temp tables.
- **CHAR trailing-space stripping** on read can surprise comparisons.
- **TEXT/BLOB**: can't have defaults, only prefix-indexable, historically forced on-disk temp tables.

**💰 Fintech lens.** Keep hot rows lean (3.2): fixed `CHAR(3)` currency + right-sized name inline; push big free-text (compliance notes) off-page so balance/statement scans stay cache-resident.

**🎯 Interview / SD angle.** "CHAR vs VARCHAR vs TEXT?" → fixed-tiny/varying-bounded/large-cold, and the *why* (padding, length prefix, off-page). Note over-declared VARCHAR lengths hurt temp tables and index keys — right-size to reality.

**✅ Self-check.**
1. When is CHAR better than VARCHAR?
2. Why can TEXT only be indexed by prefix?
3. What's wrong with `VARCHAR(255)` for a 3-char code?

---

## 3.8 · Character sets & collations

**🔧 Code-specifics.**
```sql
-- Use utf8mb4 (real UTF-8); utf8 = utf8mb3 CANNOT store emoji/4-byte chars:
CREATE TABLE customer (
  legal_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL
) ENGINE=InnoDB;
-- Exact comparison for tokens/codes (case + accent sensitive):
ALTER TABLE account MODIFY currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
-- Collation drives UNIQUE behavior: under _ci, 'Alice' = 'alice' → UNIQUE collision.
SHOW VARIABLES LIKE 'character_set%';   -- verify server/db defaults are utf8mb4
```

**⚠️ Failure modes & gotchas.**
- **`utf8`/`utf8mb3`** → silent truncation/error on emoji & 4-byte chars (real data loss).
- **Case/accent-insensitive collation** → surprising UNIQUE collisions; locale-dependent ordering.
- **Mixed collations in a join** → "illegal mix of collations" error or silent conversion.
- **utf8mb4 index keys up to 4 bytes/char** → over-long VARCHAR indexes hit key-length limits (M05).

**💰 Fintech lens.** Names/descriptions need utf8mb4 (global customers, any script); currency codes/tokens use exact (`_bin`/ascii) collations so comparisons are precise. A truncated name is a KYC/compliance data-integrity issue.

**🎯 Interview / SD angle.** "Always utf8mb4, never utf8." Distinguish **charset (encoding/bytes)** from **collation (compare/sort/UNIQUE)** — both fail silently. Mention index-key-length impact (4×). A very common interview trap.

**✅ Self-check.**
1. Why use utf8mb4 instead of utf8?
2. How can a collation cause an unexpected UNIQUE violation?
3. How does charset affect index key length?

---

## 3.9 · Temporal types: DATE, DATETIME, TIMESTAMP, time zones ★

**🔧 Code-specifics.**
```sql
-- Best practice: store UTC instants in DATETIME(6); localize at display in the app:
CREATE TABLE ledger_entry (
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),   -- microsecond ordering
  settled_at DATETIME(6) NULL                                     -- NULL = not settled yet
) ENGINE=InnoDB;
-- TIMESTAMP converts by session zone (and overflows 2038):
SELECT @@session.time_zone;
-- SET time_zone='+09:00';  -- a TIMESTAMP column would now READ shifted; DATETIME would not.
```

**⚠️ Failure modes & gotchas.**
- **TIMESTAMP 2038 overflow** (Y2K38) on authoritative financial times.
- **Session-zone dependence** — same TIMESTAMP row reads as different strings per `time_zone`.
- **DATETIME without a UTC convention** → ambiguous (no stored zone).
- **Forgetting `(6)`** → no sub-second precision → non-deterministic ordering of same-second events.

**💰 Fintech lens.** Settlement/audit times must be unambiguous and ordered. Store **UTC in DATETIME(6)**, localize only at display — dodges 2038 and session-zone ambiguity, and gives deterministic ledger ordering (M01/1.15).

**🎯 Interview / SD angle.** "An instant and a wall-clock time are different types." DATETIME = literal/zone-less; TIMESTAMP = UTC-instant converted by session zone (+ 2038). Best practice: UTC-in-DATETIME, localize at the edges. Naming 2038 is a strong signal.

**✅ Self-check.**
1. How do DATETIME and TIMESTAMP differ on time zones?
2. What is the 2038 problem and which type has it?
3. Why store UTC and convert only at display?

---

## 3.10 · ENUM & SET — compact domains with sharp edges

**🔧 Code-specifics.**
```sql
-- ENUM: compact but rigid; ⚠ invalid value → '' in non-strict mode; ORDER BY = declaration order
status ENUM('active','closed','frozen') NOT NULL    -- adding a value = ALTER TABLE
-- Preferred for evolving sets: lookup table + FK (extensible, queryable, carries metadata)
CREATE TABLE account_status (
  code  TINYINT UNSIGNED PRIMARY KEY,
  label VARCHAR(32) NOT NULL, sort_order INT NOT NULL, is_active TINYINT(1) NOT NULL
) ENGINE=InnoDB;
ALTER TABLE account ADD COLUMN status_code TINYINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_status FOREIGN KEY (status_code) REFERENCES account_status(code);
```

**⚠️ Failure modes & gotchas.**
- **Invalid ENUM value in non-strict mode → silent empty string** (index 0) — invisible corruption.
- **ORDER BY sorts by internal int** (declaration order), not alphabetical.
- **Adding/reordering values = ALTER TABLE** (migration, 3.15).
- **SET bitmask semantics** are error-prone — avoid almost always.

**💰 Fintech lens.** Statuses evolve with product/regulation (`pending_kyc`, `frozen`, `dormant`); a lookup table + FK adds them via INSERT (no DDL), rejects invalid codes, and is auditable/queryable — safer for money workflows than ENUM.

**🎯 Interview / SD angle.** ENUM only for **tiny, truly stable** sets (+ strict mode to kill the empty-string trap); otherwise **lookup table + FK**. Knowing the empty-string and ordering gotchas is a strong "knows the traps" signal. Avoid SET.

**✅ Self-check.**
1. What happens to an invalid ENUM value in non-strict mode?
2. How does ENUM sort in ORDER BY?
3. When is a lookup table the better choice?

---

## 3.11 · JSON & generated columns — structure inside a value

**🔧 Code-specifics.**
```sql
-- Flexible tail in JSON; promote a queried path to an indexed typed column:
ALTER TABLE payment
  ADD COLUMN metadata JSON,
  ADD COLUMN tier VARCHAR(16) AS (metadata->>'$.tier') STORED,   -- materialized, indexable
  ADD KEY ix_tier (tier);
-- VIRTUAL (computed on read, no storage) vs STORED (materialized, indexable like normal):
-- ALTER TABLE ledger_entry ADD COLUMN amount_minor BIGINT AS (amount*100) VIRTUAL;
-- 8.0: validate JSON shape with CHECK + JSON_SCHEMA_VALID(...)
```

**⚠️ Failure modes & gotchas.**
- **Core money fields in JSON** → can't sum exactly, constrain, or reconcile → money-never-lies violation.
- **Over-using JSON** → recreates EAV (M01/1.18): everything dynamic, nothing typed.
- **VIRTUAL vs STORED confusion** — only STORED is materialized (indexable the way you may expect).
- **No per-path FK/NOT NULL** on JSON contents (only CHECK/validation).

**💰 Fintech lens.** Provider/method-specific metadata → JSON; **amounts, account ids, status stay typed columns** so they're exactly summable, constrainable, and reconcilable (M02/2.17). Never bury the financial core in JSON.

**🎯 Interview / SD angle.** JSON + generated columns = the *sanctioned* 1NF escape (M02/2.5): flexible tail, structured/indexed where you query. Contrast with EAV. "Could this be a real column?" — if core/always-present, yes.

**✅ Self-check.**
1. How do generated columns make a JSON path queryable/indexable?
2. VIRTUAL vs STORED — difference?
3. Why must core money fields stay typed columns, not JSON?

---

*Enrichment for 3.7–3.11 complete. Next Pass D file: 3.12–3.17.*
