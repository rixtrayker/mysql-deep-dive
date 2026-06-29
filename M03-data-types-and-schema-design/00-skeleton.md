# M03 · MySQL Data Types & Schema Design — Pass A (Skeleton)

> **Pass A goal:** lock the ordered concept list, a one-line mental model per concept, and the planned diagram + worked example per concept. No prose yet — that's Pass B.
>
> **Module mental model:** *A data type is a promise about a value's meaning, its range, its storage cost, and how it compares and sorts. In M01 you decided* what *attributes exist; in M02 you decided* where *they live; here you decide* what they physically are *— and that choice silently sets your correctness (does money stay exact?), your footprint (bytes per row → rows per page → cache efficiency), and your performance (can it be indexed, compared, sorted cheaply?). The wrong type is a bug you bake into every row.*
>
> **Threads carried in this module:**
> - **Durability** — types are where "what is actually stored, to what precision, and what survives a round-trip" gets decided. FLOAT *loses* data on purpose; DECIMAL doesn't. This is the first module where bytes-on-disk is the subject.
> - **Money-never-lies** — the single most consequential type decision in fintech (DECIMAL/integer minor units vs FLOAT) lives here ★; rounding, currency exponents, and exact comparison are type problems.
> - **Generics-first** — "a type is a set of values + operations + a storage encoding" is universal; MySQL's specific types are one realization.
> - **Tradeoff** — every type trades range vs bytes vs flexibility; nothing is free (a bigger int is safer but heavier; VARCHAR is flexible but variable; ENUM is compact but rigid).
>
> **Prereqs:** M01 (attributes, keys, PK clustering), M02 (normalized columns now need physical types; generated columns from the denormalization discussion). **Leads into:** M05/M09 (type size drives index size, page fit, fragmentation — the physical performance link is *made* here), M16 (money representation is the foundation of the ledger).

---

## Concept list (ordered)

| # | Concept | One-line mental model | Diagram | Worked example |
|---|---------|----------------------|---------|----------------|
| 3.1 | **What a data type really is** | A type is a *set of legal values + operations + a storage encoding* — it sets meaning, range, bytes, and how values compare/sort, all at once. | Type = {values} × {ops} × {encoding} triad | One value (an amount) under three candidate types and how each stores/compares it |
| 3.2 | **Storage footprint → performance (the core link)** | Bytes per row decide rows per page, which decide how much of your data fits in the buffer pool — type size *is* a performance knob. ★ | Row → 16KB page → buffer pool fit | A fat row (wrong/oversized types) halving rows-per-page and doubling IO |
| 3.3 | **Integer types & signedness (TINYINT…BIGINT, UNSIGNED)** | Pick the smallest integer that safely holds your max, and decide signed vs unsigned deliberately — width is a range/bytes tradeoff. | Integer-width ladder with ranges | Choosing the type for an auto-increment PK that must never overflow |
| 3.4 | **DECIMAL vs FLOAT/DOUBLE — exactness vs approximation** | FLOAT stores *approximations* in binary and silently loses cents; DECIMAL stores exact base-10 digits. For money, this is non-negotiable. ★ | Binary-float rounding vs exact decimal lanes | 0.1 + 0.2 ≠ 0.3 in FLOAT; a balance that drifts by a cent per thousand transactions |
| 3.5 | **Representing money: DECIMAL vs integer minor units** | Two correct ways to store money exactly — DECIMAL(precision, scale) or integer count of the smallest unit (cents/satoshi) — each with tradeoffs. ★ | Two money encodings side by side | Store $100.00 as DECIMAL(18,2) vs BIGINT 10000 minor units; multi-exponent currencies |
| 3.6 | **Currency, scale & rounding** | Different currencies have different decimal exponents (USD=2, JPY=0, BHD=3, crypto=8–18); the type must carry enough scale and a defined rounding rule. | Currency → exponent → required scale table | JPY (no minor unit) vs BHD (3 places) vs BTC (8) in one schema; banker's rounding |
| 3.7 | **CHAR vs VARCHAR vs TEXT/BLOB** | Fixed vs variable vs out-of-row storage — a tradeoff of padding, length overhead, and whether the value lives inline or on overflow pages. | Storage layout: CHAR pad / VARCHAR len-prefix / TEXT off-page | Fixed currency code CHAR(3) vs variable name VARCHAR vs a TEXT note pushed off-row |
| 3.8 | **Character sets & collations (utf8mb4, comparison & sorting)** | A charset is how text is *encoded*; a collation is how it's *compared/sorted* — and both silently affect correctness, index size, and key length. | charset (bytes) × collation (compare/sort) grid | utf8 vs utf8mb4 (the "emoji/3-byte" trap); case/accent-insensitive collation changing UNIQUE behavior |
| 3.9 | **Temporal types: DATE, DATETIME, TIMESTAMP, time zones** | DATETIME stores a wall-clock value as-is; TIMESTAMP stores a UTC instant and converts by session zone — confusing them corrupts time. ★ | DATETIME (wall clock) vs TIMESTAMP (UTC instant) timeline | A settlement timestamp read in two time zones; the 2038 epoch limit; DATETIME(6) precision |
| 3.10 | **ENUM & SET — compact domains with sharp edges** | ENUM stores a small fixed value-set as a tiny int internally — compact and self-documenting, but rigid and full of ordering/empty-string traps. | ENUM internal int mapping + gotcha list | Account `status` ENUM vs lookup table; the silent-empty-string-on-invalid trap |
| 3.11 | **JSON & generated columns — structure inside a value** | JSON stores semi-structured data the engine can parse; generated columns project specific paths back into indexable, typed columns — the sanctioned escape from 1NF. | JSON doc → generated column → index flow | Flexible `metadata` JSON + a STORED generated `tier` column you can index (ties to M02/2.5) |
| 3.12 | **Keys as types: AUTO_INCREMENT vs UUID vs ULID storage** | The *type* you store an identifier in (BIGINT vs BINARY(16) vs CHAR(36)) decides index size and locality as much as the generation strategy did. ★ | Same id under BIGINT / BINARY(16) / CHAR(36) byte-cost | UUIDv7 as BINARY(16) vs CHAR(36); UUID_TO_BIN byte-swap; revisits M01/1.15 physically |
| 3.13 | **NULL storage, defaults & the cost of nullable columns** | NULL is cheap to store but expensive in meaning (M01/1.7); defaults and NOT NULL shape both correctness and a little storage/index behavior. | Null bitmap in the row + default-value flow | NOT NULL DEFAULT 0 on money vs nullable; how NULLs sit in the row format |
| 3.14 | **Row formats & on-page storage (DYNAMIC, COMPACT, off-page overflow)** | InnoDB packs a row in a row format that decides how big columns (TEXT/BLOB/large VARCHAR) are stored inline vs on overflow pages — affecting row size and IO. ★ | InnoDB row format: inline cols + 20-byte off-page pointers | A wide row with a big TEXT: DYNAMIC pushes it off-page, keeping the hot row small |
| 3.15 | **Schema evolution: changing a type later (the migration cost)** | Every type choice is a future migration risk — widening an int, changing a charset, or altering a column on a huge table is an online-DDL problem, not a free edit. | ALTER cost spectrum: instant / inplace / copy | Widening a near-overflow INT PK on a billion-row table; charset change rewriting every row (forward-ref M13) |
| 3.16 | **Type-driven schema design principles & anti-patterns** | A set of rules of thumb: smallest-safe type, NOT NULL by default, exact money, UTC time, BINARY ids, no stringly-typed data — plus the common type anti-patterns. | Principles checklist + anti-pattern catalog | Strings storing numbers/dates/booleans; oversized VARCHAR(255)-for-everything; the cost each imposes |
| 3.17 | **Fintech capstone: the physically-typed money schema** | The canonical payments tables fully typed — exact money, UTC instants, BINARY ids, tight integers, indexed JSON metadata — turning M01/M02's logical model into a correct, compact physical one. ★ | Fully-typed ER of the money model (types annotated) | End-to-end: assign every column in the ledger/account/transaction model its correct physical type, justified (sets up M05/M16) |

---

## Diagram inventory for M03 (Pass C targets)

- **Notation standard:** crow's-foot for the typed ER (3.17); byte-layout/storage diagrams for footprint (3.2, 3.7, 3.14); comparison tables/grids for type families (3.3, 3.6, 3.8); timeline for temporal (3.9); flow for JSON→generated→index (3.11).
- **Standard:** 3.1, 3.3, 3.6, 3.7, 3.8, 3.10, 3.11, 3.13, 3.15, 3.16.
- **★ Bespoke / capstone visuals:** 3.2 (row→page→buffer-pool footprint), 3.4 (binary-float-rounding vs exact-decimal — the money ★), 3.5 (two money encodings), 3.9 (DATETIME-wall-clock vs TIMESTAMP-UTC-instant), 3.12 (id byte-cost under three types), 3.14 (InnoDB row format + off-page overflow), 3.17 (fully-typed money-model ER — reused in M05/M16).

## Worked-example domain

Single running **payments/wallet** domain (continues M01/M02): `customer`/`party`, `account`, `transaction`, immutable `ledger_entry`, derived `balance`, rollups, plus `bank`, `signatory`, `account_currency` from M02's normalized output. M03 assigns every column in that schema its physical type. Multi-currency examples (USD/JPY/BHD/BTC) recur for scale/rounding.

## "Go deeper" additions (matching house style)

Beyond a basic "here are the types" tour, this skeleton deliberately includes the staff-level material: **the storage-footprint→buffer-pool→performance link as a first-class concept (3.2)**, **integer minor units vs DECIMAL as two distinct correct money encodings (3.5)**, **currency exponents & rounding rules (3.6)**, **charset *vs* collation correctness traps including utf8-vs-utf8mb4 (3.8)**, **the TIMESTAMP-UTC vs DATETIME-wall-clock distinction + 2038 (3.9)**, **JSON+generated columns as the 1NF escape (3.11)**, **id storage type physics (3.12)**, **InnoDB row formats & off-page overflow (3.14)**, and **schema-evolution/migration cost as a design-time concern (3.15)** — the things that separate "knows the type names" from "designs correct, compact, evolvable schemas."

## Open questions surfaced during Pass A (not blocking)

1. **DECIMAL vs integer-minor-units (3.4/3.5):** present both as co-equal correct options with a decision guide (proposed), or take a house recommendation (e.g., "DECIMAL for fiat ledgers, integer minor units for crypto/high-precision")? Either way both are covered.
2. **Row-format depth (3.14):** keep at "inline vs off-page + why the hot row stays small" intuition level here and defer the full COMPACT/DYNAMIC/REDUNDANT/COMPRESSED byte-layout to M09 (InnoDB internals)? (Proposed: intuition here, deep bytes in M09 — avoids duplication.)
3. **Concept count (17).** Comfortable, or merge (e.g., fold 3.6 currency/rounding into 3.5 money representation, or 3.16 principles into the capstone 3.17)?

## Pass A status: ✅ drafted — awaiting your sign-off before Pass B (core notes).
