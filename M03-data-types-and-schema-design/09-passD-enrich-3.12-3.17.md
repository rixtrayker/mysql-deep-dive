# M03 · Pass D — Enrichment · Concepts 3.12–3.17

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-idstorage-null-rowformat-evolution-principles-capstone.md` + `06-passC-…`. Domain: payments/wallet. These close out M03.

---

## 3.12 · Keys as types: AUTO_INCREMENT vs UUID vs ULID storage ★

**🔧 Code-specifics.**
```sql
-- Compact monotonic PK:
account_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
-- Distributed/unguessable: store UUID as BINARY(16), NOT CHAR(36):
public_id BINARY(16) NOT NULL
-- MySQL 8: convert + byte-swap time fields for locality (swap_flag = 1):
INSERT INTO account (public_id) VALUES (UUID_TO_BIN(UUID(), 1));
SELECT BIN_TO_UUID(public_id, 1) FROM account;     -- render readable form at the edge
-- ❌ public_id CHAR(36)  -- 36 vs 16 bytes × every index, slower compare, worse locality
```

**⚠️ Failure modes & gotchas.**
- **CHAR(36) UUID** → doubles every secondary index, slower string compare, random-order page splits (M09).
- **Random UUIDv4 as clustered PK** → fragmentation/thrash (M01/1.15); use time-ordered + byte-swap.
- **Forgetting `swap_flag`** → no locality benefit from `UUID_TO_BIN`.

**💰 Fintech lens.** The ever-growing ledger's id type is embedded in every index; BINARY(16) (vs CHAR(36)) keeps indexes cache-resident for years. Use unguessable public ids so transaction counts don't leak.

**🎯 Interview / SD angle.** "BIGINT vs UUID PK?" → answer *generation* (M01/1.15) **and** *storage type*: BINARY(16) not CHAR(36), `UUID_TO_BIN(...,1)` for locality. The storage type matters as much as the strategy — high-signal, commonly missed.

**✅ Self-check.**
1. Why store a UUID as BINARY(16) not CHAR(36)?
2. What does `UUID_TO_BIN(uuid, 1)` do and why?
3. How does id storage type affect every secondary index?

---

## 3.13 · NULL storage, defaults & the cost of nullable columns

**🔧 Code-specifics.**
```sql
-- NOT NULL by default + sensible default; nullable only for real "absent" states:
CREATE TABLE account (
  balance    DECIMAL(18,2) NOT NULL DEFAULT 0,                    -- no ambiguous money
  created_at DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  closed_at  DATETIME(6)       NULL                               -- NULL = still open (real state)
) ENGINE=InnoDB;
-- ⚠ UNIQUE allows MULTIPLE NULLs (M01/1.7) — a nullable UNIQUE col isn't single-occupancy for NULL.
```

**⚠️ Failure modes & gotchas.**
- **Nullable money** → 3VL hazards (`WHERE balance <> 0` drops NULLs, M01/1.7); ambiguous zero-vs-unknown.
- **Multiple NULLs allowed in UNIQUE** — surprising for "unique optional" columns.
- **Loose mode** silently supplies implicit defaults for missing NOT NULL values (strict mode errors).

**💰 Fintech lens.** Money and status are NOT NULL with defaults (unambiguous math); "hasn't-happened-yet" timestamps (`settled_at`, `closed_at`) are the legitimate nullable cases where NULL *means* something.

**🎯 Interview / SD angle.** "NOT NULL by default; NULL only when absence is a real, distinct state." NULL is storage-cheap (null bitmap) but meaning-expensive (3VL). Mention the multiple-NULLs-in-UNIQUE gotcha.

**✅ Self-check.**
1. When does NULL earn its place vs NOT NULL + default?
2. Why is nullable money a bad idea?
3. What's surprising about NULL in a UNIQUE index?

---

## 3.14 · Row formats & on-page storage (inline vs off-page overflow) ★

**🔧 Code-specifics.**
```sql
-- DYNAMIC (8.0 default) stores large cols off-page with a small pointer:
CREATE TABLE account (
  account_id BIGINT NOT NULL,
  balance    DECIMAL(18,2) NOT NULL,        -- hot, inline
  note       TEXT NULL,                      -- large, pushed off-page
  PRIMARY KEY (account_id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;
-- Inspect:
SELECT row_format FROM information_schema.tables
WHERE table_schema=DATABASE() AND table_name='account';
-- Or isolate cold/large columns entirely via vertical partitioning (1:1 side table, M02).
```

**⚠️ Failure modes & gotchas.**
- **Big TEXT/BLOB in a hot, frequently-scanned table** → wasted page space/cache (push off-page or vertically partition).
- **COMPACT format's 768-byte inline prefix** bloats rows vs DYNAMIC's full off-page.
- **Extra read** to fetch off-page values when you *do* need them with the row.

**💰 Fintech lens.** Keep the hot `account`/`ledger_entry` rows lean so balance/statement scans stay cache-resident (3.2); large compliance notes live off-page and are read only on review.

**🎯 Interview / SD angle.** Intuition level (deep bytes → M09): DYNAMIC pushes large columns off-page with a ~20-byte pointer, keeping hot rows dense. Same goal as vertical partitioning — hot/cold separation. Connects types (3.7) to page behavior (M09).

**✅ Self-check.**
1. What does DYNAMIC do with a large TEXT column?
2. Why keep large/cold columns out of the hot row?
3. Automatic (row format) vs deliberate (vertical partitioning) — same goal?

---

## 3.15 · Schema evolution: changing a type later (the migration cost)

**🔧 Code-specifics.**
```sql
-- Request/assert the cheap algorithm; COPY is the expensive default for type changes:
ALTER TABLE big_table ADD COLUMN flag TINYINT, ALGORITHM=INSTANT;        -- metadata-only
ALTER TABLE big_table ADD KEY ix_x (x), ALGORITHM=INPLACE, LOCK=NONE;    -- non-blocking
-- Type change is usually COPY (rebuilds whole table) — assert to catch surprises:
-- ALTER TABLE big_table MODIFY id BIGINT, ALGORITHM=INPLACE;  -- ERROR if it can't avoid COPY
-- For big COPY ops online: gh-ost / pt-online-schema-change (M13) — shadow table + swap.
```

**⚠️ Failure modes & gotchas.**
- **Type change = COPY** on a large table → hours, IO, locks, replication lag (M10).
- **INT PK approaching overflow** → emergency widen (avoidable with BIGINT upfront, 3.3).
- **Charset change to utf8mb4 later** → rewrites every row (avoidable by starting there, 3.8).
- **Online tools + FKs** have caveats (M01/1.5, M13).

**💰 Fintech lens.** A forced type migration on the billion-row ledger is a high-risk, planned operation. Design choices (BIGINT PK, utf8mb4, generous DECIMAL scale) are how you avoid ever needing it.

**🎯 Interview / SD angle.** Know the **INSTANT / INPLACE / COPY** spectrum and that **most type changes are COPY** (expensive at scale). "The best migration is the one you designed your way out of." Mention gh-ost/pt-osc for unavoidable big ones.

**✅ Self-check.**
1. Which ALTER class do most type changes fall into?
2. Name two type choices that avoid a future forced migration.
3. How do online schema-change tools make a COPY manageable?

---

## 3.16 · Type-driven schema design principles & anti-patterns

**🔧 Code-specifics.**
```sql
-- The principles, as a CREATE TABLE that follows all of them:
CREATE TABLE payment (
  payment_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,            -- smallest-safe / compact id
  amount      DECIMAL(18,2)   NOT NULL,                           -- exact money, NOT NULL
  currency    CHAR(3)         NOT NULL,                           -- fixed code
  status_code TINYINT UNSIGNED NOT NULL,                          -- FK to lookup, not ENUM
  created_at  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6), -- UTC instant
  metadata    JSON            NULL,                               -- variable tail only
  PRIMARY KEY (payment_id)
) ENGINE=InnoDB;
SET SESSION sql_mode='STRICT_ALL_TABLES';                          -- reject bad data
-- Anti-patterns to reject in review: DOUBLE money · CHAR(36) id · TIMESTAMP authoritative time ·
--   VARCHAR(255)-for-all · ENUM for volatile sets · nullable-everything · money-in-JSON · utf8(mb3)
```

**⚠️ Failure modes & gotchas.**
- Each anti-pattern = a principle violated (FLOAT money, CHAR(36) id, utf8mb3, etc.).
- **Applying rules without understanding** → missing the rare legitimate override.
- **No strict mode** → the whole "schema as fence" weakens (silent coercion).

**💰 Fintech lens.** The checklist is the money-correctness contract at the type layer: exact money, unambiguous time, compact ids, NOT NULL discipline — the structural floor of money-never-lies.

**🎯 Interview / SD angle.** Be able to **review a schema and name the type smells** with fixes — high-signal. Each principle is a *default with a reason* (the concept behind it), so you can justify it and recognize valid overrides. This is the M14 cheat-sheet in seed form.

**✅ Self-check.**
1. Name five type anti-patterns and their fixes.
2. Why is each principle a "default," not a law?
3. Why is strict mode foundational to all of them?

---

## 3.17 · Fintech capstone — the physically-typed money schema ★

**🔧 Code-specifics.**
```sql
-- The logical model (M01) + normalized (M02), now fully typed (M03):
CREATE TABLE ledger_entry (
  transaction_id BIGINT UNSIGNED NOT NULL,                        -- 3.3 headroom
  line_no        INT UNSIGNED   NOT NULL,
  account_id     BIGINT UNSIGNED NOT NULL,                        -- 3.12 compact id
  amount         DECIMAL(18,2)  NOT NULL,                         -- 3.4/3.5 exact money, NEVER FLOAT
  currency       CHAR(3)        NOT NULL,                         -- 3.6/3.8 ISO code, exact collation
  created_at     DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),  -- 3.9 UTC instant
  metadata       JSON               NULL,                         -- 3.11 tail only; money stays typed
  PRIMARY KEY (account_id, created_at, transaction_id, line_no),  -- M01/1.14 query-shaped clustering
  CONSTRAINT fk_e_acct FOREIGN KEY (account_id) REFERENCES account(account_id) ON DELETE RESTRICT
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;
```

**⚠️ Failure modes & gotchas.**
- Any single wrong type undermines the whole: FLOAT amount, CHAR(36) id, TIMESTAMP time, nullable balance, money-in-JSON.
- **Mismatched currency/scale** across tables → reconciliation drift (M02/2.17).
- **Wrong PK clustering type/order** → scattered statement scans (M05).

**💰 Fintech lens (★).** This typed schema is the structural realization of all four threads: durability (exact bytes survive), money-never-lies (exact money/time), generics-first (each type honors its value), tradeoff (each choice costed). It's the seed M16 grows into a platform.

**🎯 Interview / SD angle.** Asked to design the physical money schema: produce *this* — BIGINT/BINARY(16) ids, DECIMAL/minor-units money, CHAR(3) currency, DATETIME(6) UTC, lookup-table status, JSON tail, query-shaped clustered PK, FK RESTRICT, strict mode. Every choice justified by a concept — that justification *is* the signal.

**✅ Self-check.**
1. Justify the physical type of each column in `ledger_entry`.
2. Which single type mistakes would break money correctness?
3. How does this schema feed M05 (indexing) and M16 (platform)?

---

*Enrichment for 3.12–3.17 complete. **M03 Pass D is fully drafted (all 17 concepts) — M03 is now content-complete across Passes A–D.***
