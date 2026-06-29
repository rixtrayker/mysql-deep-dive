# M03 · Pass B — Concepts 3.7–3.11 · Text, Charset/Collation, Temporal, ENUM/SET, JSON

> Pass B scope: contract items **#1–#6.** Running domain: payments/wallet.

---

## 3.7 · CHAR vs VARCHAR vs TEXT/BLOB

**Mental model.** Three ways to store strings, distinguished by *how length is handled* and *where the bytes live*. **CHAR(n)** is fixed-length — always n characters, padded — best for values that really are a fixed size (a 3-letter currency code). **VARCHAR(n)** is variable-length with a small length prefix — best for genuinely varying text up to a bound (names, descriptions). **TEXT/BLOB** are for large values that may be stored **off the main row** on overflow pages — best for big notes/documents you don't filter on. The choice affects row size, padding waste, and whether the value sits inline in the hot row or off-page.

**How it actually works.**
- **CHAR(n):** reserves a fixed width; shorter values are right-padded with spaces (and trailing spaces are stripped on read, a subtle gotcha). No length prefix. Predictable size; can waste space if values vary.
- **VARCHAR(n):** stores actual length + a 1–2 byte length prefix; only the real bytes are stored. Flexible, compact for varying data, but rows become variable-length (affecting row format, 3.14).
- **TEXT/BLOB:** large-object types. In InnoDB, depending on row format (3.14), large values are stored on **overflow pages** with only a small pointer (often 20 bytes) inline — so a big note doesn't bloat the hot row, but accessing it costs an extra page read. BLOB is the binary sibling of TEXT (no charset).

The dividing line is roughly: fixed tiny → CHAR; variable bounded → VARCHAR; large/unbounded-ish → TEXT/BLOB.

**Why it exists / what it solves.** Different string shapes have different optimal storage. Fixed codes want predictability (CHAR); variable text wants compactness (VARCHAR); large blobs want to *not* inflate every row (TEXT off-page). Matching the type to the shape keeps the **hot row small** (3.2 — more rows per page, better cache) while still storing big data when needed. It's footprint optimization specialized to strings.

**Tradeoffs & alternatives.** CHAR wastes bytes on varying data but is predictable and avoids length-prefix overhead and fragmentation; VARCHAR is compact for varying data but makes rows variable and has the length prefix; TEXT keeps the row lean but costs an extra read and can't be fully indexed (only a prefix, M05). The classic anti-pattern: **VARCHAR(255) for everything** regardless of real length — it doesn't waste storage (VARCHAR only stores actual bytes) but it *can* hurt in other ways (in-memory temp tables and some operations allocate the *max* length, and over-long declared lengths can bloat index key sizes and memory buffers). Right-size the declared length to reality.

**Generics / first-principles.** "Match the container to the value's shape and access pattern: fixed/small inline, large/cold out-of-line." This inline-vs-out-of-line distinction is universal — it's the same idea as small-string optimization, storing large objects in blob stores with a reference, or keeping hot fields together and cold fields apart. The goal everywhere: keep the frequently-accessed data compact and contiguous.

**MySQL-specific reality.** MySQL specifics: CHAR pads and strips trailing spaces (can affect comparisons); VARCHAR's length prefix is 1 byte if max < 256 else 2; **TEXT/BLOB can only be indexed by prefix** (you must specify a length, M05) and can't have a default value; in-memory temp tables historically couldn't hold TEXT/BLOB (forcing on-disk temp tables, a performance cliff). The byte length depends on charset (3.8) — a `VARCHAR(100)` in utf8mb4 can be up to 400 bytes. Practical guidance: CHAR(3) for currency codes, right-sized VARCHAR for names/identifiers, TEXT only for genuinely large free-text you won't filter on — and keep large columns out of the hot row (3.14, or vertical-partition them, M02).

---

## 3.8 · Character sets & collations

**Mental model.** Two separate concepts people constantly conflate. A **character set (charset)** is *how text is encoded into bytes* — which characters are representable and how many bytes each takes. A **collation** is *how text is compared and sorted* — case sensitivity, accent sensitivity, locale ordering. Charset affects correctness (can you even store this emoji?) and storage size; collation affects comparison results (does `'A' = 'a'`? does a UNIQUE constraint treat them as duplicates?) and index/sort behavior. Both silently shape correctness, and one specific charset mistake is a MySQL rite of passage.

**How it actually works.**
- **Charset:** maps characters ↔ bytes. `latin1` is 1 byte/char (limited). `utf8mb4` is variable 1–4 bytes/char and covers *all* Unicode (including emoji and supplementary characters). The infamous trap: MySQL's old **`utf8` is actually `utf8mb3`** — a broken 3-byte-max subset that *cannot* store 4-byte characters (emoji, some CJK), silently truncating or erroring. The correct "real UTF-8" in MySQL is **`utf8mb4`**.
- **Collation:** a set of rules over a charset for comparison/sorting. A collation can be case-insensitive (`utf8mb4_..._ci`), case-sensitive (`_cs`), accent-insensitive (`_ai`), or binary (`_bin`, compare raw bytes). The collation determines whether two strings are "equal" — which directly affects `WHERE name = 'x'`, `ORDER BY`, `GROUP BY`, and **UNIQUE constraints** (a case-insensitive collation makes `'Alice'` and `'alice'` collide in a UNIQUE index).

**Why it exists / what it solves.** The world's text needs a universal encoding (utf8mb4) so you can store any name, symbol, or emoji without corruption. And different applications need different comparison semantics (case-insensitive search vs exact binary match), which collations provide. Separating "encoding" from "comparison rules" lets you store text correctly *and* compare it the way your domain needs.

**Tradeoffs & alternatives.** utf8mb4 is the correct default but costs more bytes per character than latin1 (affecting storage and **index key length** — 3.2/M05, where a utf8mb4 VARCHAR index key can be 4× the bytes). Collation choice trades intuitiveness vs precision: case-insensitive is user-friendly for search but can cause surprising UNIQUE collisions and locale-dependent ordering; binary collation is exact and fast but case/accent-sensitive (`'Café' ≠ 'cafe'`). The practical default is utf8mb4 with an appropriate `_ci` collation, overriding to binary/`_cs` for columns where exactness matters (e.g., case-sensitive tokens).

**Generics / first-principles.** "Encoding and comparison are independent concerns; conflating them causes silent corruption or wrong results." The encoding/comparison split exists everywhere text is handled — Unicode normalization forms, locale-aware sorting (the Turkish-i problem), case-folding rules. The principle: storing text correctly (encoding) and comparing it correctly (collation/normalization) are two decisions, and both must be made deliberately because both fail *silently* (mojibake, or `=` not matching what a human calls equal).

**MySQL-specific reality.** The headline MySQL facts: **use `utf8mb4`, never `utf8`/`utf8mb3`** (the latter can't store emoji/4-byte chars — a real data-loss bug); MySQL 8 defaults to `utf8mb4` with `utf8mb4_0900_ai_ci` collation (Unicode 9.0, accent- and case-insensitive). Index implications: a utf8mb4 column's index key reserves up to 4 bytes/char, so over-long VARCHAR indexes can hit key-length limits (M05). Mixed collations in a join/comparison cause "illegal mix of collations" errors or silent conversions. For fintech: currency codes and similar tokens often use an exact (`_bin` or ASCII) collation; user-facing text uses utf8mb4 `_ci`. Set charset/collation deliberately at the column level for anything where comparison semantics matter.

---

## 3.9 · Temporal types: DATE, DATETIME, TIMESTAMP, time zones ★

**Mental model.** The decision that matters: **DATETIME stores a wall-clock value exactly as given, with no time-zone awareness** — "2025-03-04 14:00:00" means those literal numbers, period. **TIMESTAMP stores a specific instant in UTC and converts to/from the session's time zone** on write and read — so the *same stored row* shows different wall-clock strings to clients in different zones. Confusing the two corrupts time: store a UTC instant in a DATETIME and you've lost the zone; store a wall-clock in a TIMESTAMP and it gets shifted. Plus TIMESTAMP has a looming expiry date (the year 2038).

**How it actually works.**
- **DATE:** just a calendar date (no time), 3 bytes.
- **DATETIME:** date + time, stored as the literal value, **no time-zone conversion**, range 1000–9999, 5 bytes (+ fractional). What you put in is what you get out, regardless of session zone.
- **TIMESTAMP:** date + time stored internally as **UTC** (seconds since epoch), **converted using the session `time_zone`** on insert and select. So a TIMESTAMP represents an *instant*; two clients in different zones see different local strings for the same instant. 4 bytes, but the epoch-based storage means it **overflows on 2038-01-19** (the "Year 2038 problem" / Y2K38) unless using a wider representation.
- **Fractional seconds:** both DATETIME and TIMESTAMP support `(6)` for microsecond precision (`DATETIME(6)`), important for ordering high-frequency events (M01/1.15, ledger entries).

**Why it exists / what it solves.** The two types answer two genuinely different questions: "what wall-clock time was written on this form?" (DATETIME — a local, zone-less value, e.g., a scheduled 9am that should be 9am everywhere) vs "what exact instant did this happen?" (TIMESTAMP — an absolute point in time, e.g., when a payment settled, which is the same instant globally). Choosing correctly is choosing whether the value is *absolute* or *local*.

**Tradeoffs & alternatives.** TIMESTAMP's auto-UTC-conversion is convenient for "instants" but introduces session-zone dependence (the same query returns different strings depending on `time_zone`) and the 2038 ceiling. DATETIME is zone-agnostic and 9999-safe but stores no zone, so *you* must enforce a convention (the near-universal best practice: **store UTC in DATETIME and convert in the application**, getting absolute-instant semantics without TIMESTAMP's 2038 limit or session-zone surprises). A common pattern is DATETIME-in-UTC for event times + a separate explicit zone column if local wall-clock matters.

**Generics / first-principles.** "An instant and a wall-clock time are different types; store instants in UTC and localize at the edges." This is one of the most important and most-violated principles in all of software — time zones, DST, and the absolute-vs-local distinction cause endless bugs. The universal rule: keep time **absolute (UTC) internally**, convert to local **only for display**, and never store a local time without its zone. The 2038 problem is the same class as Y2K — a fixed-width epoch counter overflowing.

**MySQL-specific reality.** MySQL specifics: TIMESTAMP is UTC-internally + session-`time_zone`-converted and has special auto-update behavior (`DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`); DATETIME does no conversion. The **2038 limit** is real for TIMESTAMP. MySQL's time-zone conversion depends on the server's `time_zone` setting and loaded zone tables. For fintech the dominant pattern: **store event/settlement times as UTC, with `DATETIME(6)` for microsecond-precise ordering** (so ledger entries sort deterministically, M01/1.15), convert to user-local only for display, and avoid relying on TIMESTAMP's implicit conversion for authoritative financial timestamps (both to dodge 2038 and to avoid session-zone ambiguity in audit records).

---

## 3.10 · ENUM & SET — compact domains with sharp edges

**Mental model.** ENUM lets you declare a column whose value must be **one of a fixed small list** ("active", "closed", "frozen"), and MySQL stores it internally as a tiny integer index into that list — so it's **compact and self-documenting** but **rigid** (changing the list is a schema change) and riddled with subtle traps. SET is the multi-value sibling (a column holding any subset of a fixed list, stored as a bitmask). Both are tempting for status/flag columns; both have sharp edges that often make a **lookup table the better choice**.

**How it actually works.** ENUM('active','closed','frozen') stores 1, 2, or 3 internally (1–2 bytes) but displays the string. This is space-efficient and constrains the domain at the type level. The sharp edges: (1) **ordering** — comparisons and `ORDER BY` on an ENUM sort by the *internal integer*, i.e., declaration order, not alphabetical, which surprises people; (2) the **empty-string trap** — in non-strict mode, inserting an invalid ENUM value silently stores `''` (the special "error" element at index 0) instead of erroring; (3) **changing the list** (adding/reordering values) is an `ALTER TABLE` (a migration, 3.15) — you can't add a value without DDL; (4) numeric-looking ENUM values are ambiguous (`ENUM('1','2','3')` — is `2` the value or the index?). SET adds bitmask complexity and its own quirks.

**Why it exists / what it solves.** ENUM/SET give you a compact, in-row, self-documenting domain constraint without a join — for a truly stable, small, rarely-changing set (like a binary-ish status), it's efficient and readable. They solve "I want to constrain this column to a few values and not pay for a lookup-table join."

**Tradeoffs & alternatives.** ENUM vs **lookup table** is the real decision. ENUM: compact, no join, self-documenting, but rigid (DDL to change), order-surprising, empty-string-trap-prone, and the value list isn't queryable as data. A **lookup/reference table** (`account_status(code, label)` + FK): flexible (add a status with an INSERT, not DDL), the set is queryable/joinable, can carry metadata (labels, sort order, active flag), and integrates with FKs — at the cost of a join and a few bytes. The common guidance: ENUM only for **tiny, truly stable** sets (and some prefer to *always* use a lookup table or a CHECK-constrained string for consistency); avoid SET almost always (bitmask semantics are error-prone; a junction table is clearer).

**Generics / first-principles.** "Encode a domain as data (a referenced set) unless it's tiny and immutable, in which case an inline enum may be worth the rigidity." The "enum vs lookup table" tension — compact-but-rigid in-code/in-type enumeration vs flexible data-driven set — recurs in every system (language enums vs config-driven lists). The principle: if the set of values changes on a *data* cadence, model it as data; if it changes on a *code/schema* cadence and is small, an enum is acceptable.

**MySQL-specific reality.** All the gotchas above are MySQL-specific behaviors: internal-integer storage and ordering, the **silent empty-string on invalid value in non-strict mode** (strict mode makes it an error — another reason strict mode is mandatory), `ALTER TABLE` to modify the value list, and the numeric-ENUM ambiguity. For fintech, the cautious default is often a **lookup table + FK** for statuses (auditable, extensible, queryable) — or an ENUM only for genuinely fixed binary-ish states with strict mode on. Reserve SET-avoidance as a near-rule. This is a frequent "do you know the traps?" interview area.

---

## 3.11 · JSON & generated columns — structure inside a value

**Mental model.** JSON lets you store **semi-structured, schema-flexible data** in a single column that MySQL can still parse and query into — the sanctioned escape from 1NF (M02/2.5) for *genuinely* document-shaped or open-ended data. **Generated columns** then let you **project a specific JSON path (or any expression) back out into a real, typed, indexable column** — so you get flexibility for the long tail of attributes *and* indexed, constraint-able access to the few paths you query. Together they're the controlled middle ground between rigid columns and the EAV anti-pattern (M01/1.18).

**How it actually works.**
- **JSON type:** stores a validated JSON document in an efficient binary format (not just a text blob) — MySQL parses it, validates it on insert, and provides functions/operators to extract (`->`, `->>`), modify, and search. You can store an object with arbitrary keys without schema changes.
- **Generated columns:** a column whose value is *computed from an expression* over other columns, declared `AS (expr)`. Two kinds: **VIRTUAL** (computed on read, stored nowhere, no extra storage) and **STORED** (computed on write, materialized in the row, takes space but is indexable like a normal column). The killer combination: extract `metadata->>'$.tier'` into a STORED generated column and **add an index on it** — now a JSON path is as queryable and constrainable as a native column, while the rest of the JSON stays flexible. (MySQL 8 also allows functional indexes directly on expressions, a related capability.)

**Why it exists / what it solves.** Real schemas have a stable core plus a long tail of optional/varying attributes (per-payment-method metadata, feature flags, provider-specific fields). JSON handles the tail without a migration per new field and without the EAV anti-pattern's loss of typing/integrity (M01/1.18). Generated columns recover the structure you need: the specific paths you filter/sort/constrain on become first-class indexed columns. It's "flexible where you must, structured where you query."

**Tradeoffs & alternatives.** JSON trades schema enforcement and some efficiency for flexibility: the engine can't constrain arbitrary keys (no per-path NOT NULL/FK on JSON contents beyond CHECK), JSON values are larger and slower to process than native columns, and over-using JSON recreates the EAV problem (everything dynamic, nothing typed/queryable cleanly). The alternative is always "could this be a real column?" — if a field is *core and always present*, it should be a typed column, not a JSON path. JSON is for the genuinely variable tail. Generated columns add the structure back but cost write-time computation (STORED) or read-time (VIRTUAL).

**Generics / first-principles.** "Make the stable, queried parts structured; allow a bounded, parsed flexible region for the variable tail." This is the schema-on-write vs schema-on-read tension resolved pragmatically — keep a typed core (schema-on-write) and a parsed flexible extension (schema-on-read), with a bridge (generated columns) to promote tail fields to first-class when they stabilize. It's the same instinct as a typed struct with an `extra: map` field, or a protobuf with an `Any`/extensions field.

**MySQL-specific reality.** MySQL specifics: native **JSON type since 5.7** (binary-stored, validated), rich JSON functions, **generated columns (VIRTUAL/STORED) since 5.7**, **functional indexes since 8.0**, and `JSON_TABLE`/JSON schema validation (`CHECK` with `JSON_SCHEMA_VALID`) in 8.0. The canonical pattern (ties directly to M02/2.5's 1NF-exception discussion): `metadata JSON` + `tier VARCHAR AS (metadata->>'$.tier') STORED` + an index on `tier`. For fintech: provider/method-specific fields and flexible audit metadata live in JSON, while everything you reconcile, sum, or constrain (amounts, account ids, status) stays a typed column. Avoid the trap of JSON-ifying core money fields — the money-never-lies thread wants amounts as typed DECIMAL/integer columns (3.4/3.5), never buried in a JSON blob where they can't be exactly constrained or efficiently summed.

---

*Concepts 3.7–3.11 — Pass B core notes complete. Next: 3.12–3.17 (id storage types, NULL/defaults, InnoDB row formats, schema evolution cost, design principles/anti-patterns, fully-typed money capstone).*
