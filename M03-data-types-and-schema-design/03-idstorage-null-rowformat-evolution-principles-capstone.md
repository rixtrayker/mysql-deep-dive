# M03 · Pass B — Concepts 3.12–3.17 · ID Storage, NULL, Row Formats, Evolution, Principles, Capstone

> Pass B scope: contract items **#1–#6.** Running domain: payments/wallet. These close out M03's core notes and hand off to M05 (indexing) and M16 (the money platform).

---

## 3.12 · Keys as types: AUTO_INCREMENT vs UUID vs ULID storage ★

**Mental model.** M01/1.15 chose an id *generation strategy* (auto-inc vs UUID vs ULID/Snowflake); this concept is the **physical companion**: the *type you store that id in* — `BIGINT` (8 bytes) vs `BINARY(16)` (16 bytes) vs `CHAR(36)` (36+ bytes) — and it matters as much as the generation choice, because the id type is embedded in the PK and therefore in **every secondary index** (M01/1.3, 3.2). Storing a UUID as a 36-character string instead of 16 binary bytes more than doubles the cost of every index in the table — a pure, avoidable tax.

**How it actually works.** An identifier's logical value (a number, a 128-bit UUID) can be stored in different physical types:
- **BIGINT (8 bytes):** the natural type for auto-increment ids — compact, fast integer comparison, perfect clustered-index locality (monotonic).
- **BINARY(16):** the right type for a 128-bit UUID/ULID — stores the raw 16 bytes. Compact (for a 128-bit value), exact binary comparison.
- **CHAR(36) / VARCHAR(36):** a UUID as its human-readable hex-with-dashes string — **36 bytes**, plus charset overhead, plus slower string comparison. This is the common mistake.
Because the PK is embedded in every secondary index (M01/1.3), the per-index cost difference is 8 vs 16 vs 36+ bytes *multiplied across every secondary index and every row*. On a wide-indexed table this is a large, permanent storage and cache penalty (3.2). For time-ordered ids (UUIDv7/ULID), BINARY(16) also preserves the **locality** benefit (M01/1.15) — sequential-ish inserts — that a random-order representation would waste.

**Why it exists / what it solves.** It separates "what id values do I generate" from "how do I physically store them," and shows that a correct generation choice can still be ruined by a wrong storage type. Storing ids as compact binary keeps indexes small (3.2 → cache fit → speed) and, for time-ordered ids, preserves insert locality. It's the bridge that makes M01/1.15's theory physically real and feeds directly into M05 (index size) and M09 (page fit/fragmentation).

**Tradeoffs & alternatives.** BIGINT auto-inc: smallest and fastest, but centralized sequence and guessable/enumerable (M01/1.15). BINARY(16) UUID/ULID: distributed, unguessable, 2× a BIGINT but still compact — the right call when you need those properties. CHAR(36): the *only* reason to use it is human-readability in raw queries/logs, which rarely justifies doubling every index; if you need readability, expose a converted form at the edge, not in storage. The tradeoff is ergonomics (readable string) vs footprint (binary) — and footprint almost always wins for an indexed id.

**Generics / first-principles.** "Store an identifier in its most compact correct binary form; render the human-readable form at the boundary." Logical value ≠ storage representation — the same 128-bit UUID is 16 bytes binary or 36 bytes as hex text, and you choose the representation by cost, not by what's readable in a console. This separation (compact internal representation, pretty external rendering) is universal across serialization, networking, and storage.

**MySQL-specific reality.** Concrete MySQL tooling: **BIGINT (UNSIGNED) AUTO_INCREMENT** for sequential PKs; **BINARY(16)** for UUIDs/ULIDs, with **`UUID_TO_BIN(uuid, swap_flag)` / `BIN_TO_UUID()`** (MySQL 8) to convert — and the `swap_flag=1` variant **byte-swaps the time fields** of a UUIDv1 so the binary sorts in time order (better clustered-index locality, mimicking what ULID/UUIDv7 do natively). Never store UUIDs as CHAR(36) for an indexed id (36 vs 16 bytes × every index, plus slower comparison and worse locality). This is one of the most common, highest-impact MySQL schema mistakes — and a frequent interview probe. It directly sets up M05's index-size discussion and M09's page/fragmentation behavior.

---

## 3.13 · NULL storage, defaults & the cost of nullable columns

**Mental model.** NULL's *semantic* cost was the subject of M01/1.7 (three-valued logic, silent row drops); here the angle is **physical and design**: how NULL is actually stored (cheaply, via a per-row null bitmap), how **defaults** and **NOT NULL** shape both correctness and a little storage/index behavior, and why "NOT NULL by default" is a sound design rule even though NULL itself is storage-cheap. The cost of nullable columns is mostly in *meaning and query correctness*, with minor physical effects.

**How it actually works.** InnoDB records which columns are NULL in a small **null bitmap** at the start of the row (one bit per nullable column); a NULL value itself then takes essentially no value-bytes (the column's space isn't stored). So NULL is *storage-cheap* — making a column nullable costs about one bit per row. **Defaults** define what's stored when no value is supplied (`DEFAULT 0`, `DEFAULT CURRENT_TIMESTAMP`); **NOT NULL** forbids NULL entirely. The design consequences: NOT NULL columns are simpler to reason about (no 3VL, M01/1.7), can be slightly more index-efficient in some cases, and force you to decide a meaningful default or require the value — which is usually what you want for money and status columns. Nullable columns invite the 3VL hazards (M01/1.7) and ambiguous "is this missing or zero?" semantics.

**Why it exists / what it solves.** Defaults and NOT NULL are how you push "every row has a sensible, present value" into the schema (M01/1.8 — the fence). For money, `balance DECIMAL(18,2) NOT NULL DEFAULT 0` makes "no balance" impossible and money math unambiguous; for timestamps, `created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)` guarantees every row is stamped. The rule "NOT NULL by default, nullable only when 'unknown/absent' is a real, distinct state" prevents a class of correctness bugs at near-zero storage cost.

**Tradeoffs & alternatives.** Nullable vs NOT-NULL-with-default is a *semantic* tradeoff: a nullable column can distinguish "genuinely unknown" from "zero/empty" (sometimes you need that — a `settled_at` that's NULL until settlement is meaningful), while NOT NULL + default removes ambiguity but can't express "we don't know yet" without a sentinel or a status column. The guidance: use NULL **only** when absence is a real, distinct, meaningful state; otherwise NOT NULL with a default. Overusing NULL spreads 3VL hazards; banning it entirely forces awkward sentinels. Calibrate per column.

**Generics / first-principles.** "Absence should be a deliberate, modeled state — not a default that leaks three-valued logic everywhere." This echoes M01/1.7's "absence is not a value" from the design side: make nullability a conscious choice, because every nullable column is a place where queries must handle UNKNOWN and where "missing vs zero" can be confused. The principle (prefer total over partial functions / non-null over null) is the database analog of `Option`-only-where-meaningful in well-typed code.

**MySQL-specific reality.** MySQL specifics: the per-row null bitmap (cheap NULLs); `DEFAULT` supports literals and certain expressions (and `CURRENT_TIMESTAMP` for temporal columns, including `ON UPDATE`); strict mode affects what happens when a NOT NULL column gets no value (error vs implicit default in loose modes — another strict-mode reason). A subtlety from M01/1.7 worth re-noting physically: **UNIQUE indexes allow multiple NULLs** in MySQL, so a nullable UNIQUE column doesn't enforce single-occupancy for the NULL case. Fintech guidance: money and status columns are **NOT NULL with sensible defaults** (no ambiguous balances), timestamps NOT NULL with `CURRENT_TIMESTAMP(6)`, and nullable reserved for genuinely-optional facts (`settled_at`, `closed_at`) where NULL *means* "hasn't happened yet."

---

## 3.14 · Row formats & on-page storage (inline vs off-page overflow) ★

**Mental model.** InnoDB packs each row into a **row format** that decides, among other things, *which columns live inline in the main row and which large columns get pushed to separate **overflow pages** with just a pointer left behind.* The practical upshot you need at this level: **big columns (large VARCHAR, TEXT, BLOB) can be stored off-page so the hot row stays small** (3.2 — more rows per page, better cache), at the cost of an extra page read when you actually fetch the big value. (The full byte-level COMPACT/DYNAMIC/REDUNDANT/COMPRESSED comparison is deferred to M09 — here it's the intuition and the design consequence.)

**How it actually works.** A row's columns are stored together in a clustered-index leaf page (M01/1.3, M09). Small columns sit inline. For large variable-length columns, InnoDB (in the modern **DYNAMIC** row format, the 8.0 default) stores them on **overflow pages** and keeps only a ~20-byte pointer in the main row — so a 5 KB note doesn't consume 5 KB of the hot row and crowd out other rows. The older **COMPACT** format stored a 768-byte prefix inline before overflowing, which bloats the row more. The design consequence: a table with a big TEXT column, in DYNAMIC format, keeps its frequently-scanned columns dense (fast scans/index-range reads) while the big value is fetched only when selected. This is *why* "keep large/cold columns out of the hot path" (3.7, and vertical partitioning, M02) works mechanically.

**Why it exists / what it solves.** Off-page overflow lets a table hold large values without paying for them on every row access. Most queries touch the small hot columns (account id, amount, status, timestamps) and not the big note/document — so keeping the big value off-page means those common queries read dense pages full of useful rows instead of pages half-occupied by one giant value. It's the storage-engine mechanism that makes "small hot row" achievable even when the table also stores big blobs.

**Tradeoffs & alternatives.** Off-page storage trades **an extra read when you need the big value** for **denser hot rows when you don't** — almost always the right trade when the big column is rarely selected. If you *frequently* need the big value with the rest of the row, off-page hurts (two reads). The structural alternative is **vertical partitioning** (M02): move the big/cold column into a separate 1:1 table entirely, so the hot table has no overflow pointers at all and the big data is joined only when needed — cleaner separation, explicit. Row format is the automatic version; vertical partitioning is the deliberate version.

**Generics / first-principles.** "Keep hot, small, frequently-accessed data dense and contiguous; push cold, large data out of the hot path." This is the same locality principle as 3.2/3.7, applied at the row-storage level — and it's universal (hot/cold data separation, columnar storage for analytics, storing large blobs externally with a reference). The engine is automatically doing what good data layout does by hand: don't let rare big values pollute the cache lines (here, pages) of common small access.

**MySQL-specific reality.** Specifics (intuition level; full detail in M09): InnoDB row formats are **REDUNDANT, COMPACT, DYNAMIC, COMPRESSED**; **DYNAMIC is the 8.0 default** and handles large columns best (full off-page with a small pointer, vs COMPACT's 768-byte inline prefix); COMPRESSED additionally compresses pages (CPU vs IO tradeoff). The practical M03 takeaways: prefer DYNAMIC (default), don't stuff large TEXT/BLOB into hot tables you scan a lot (push them off-page or vertically partition), and remember a big VARCHAR's actual storage/overflow depends on charset (3.8) and row format. This connects type choices (3.7) to physical page behavior (M09) and the indexing performance story (M05).

---

## 3.15 · Schema evolution: changing a type later (the migration cost)

**Mental model.** Every type choice is also a **bet about the future**, because changing a column's type later is rarely free — it can range from an instant metadata-only change to a **full table rebuild that copies every row** (hours of work, locking risk, replication lag) on a large table. "I'll just widen it later" is sometimes trivial and sometimes a major operation. Knowing *which* changes are cheap and which are catastrophic is part of choosing types well *now* (e.g., picking BIGINT over INT for a PK precisely to avoid a future emergency widen, 3.3).

**How it actually works.** MySQL `ALTER TABLE` operations fall on a cost spectrum:
- **INSTANT** (8.0+): metadata-only, no data touched — e.g., adding a column (in many cases), some default changes. Effectively free.
- **INPLACE:** rebuilds indexes/data within the engine without a full external copy and often without blocking writes — e.g., adding a secondary index.
- **COPY:** rebuilds the *entire table* row by row into a new file — e.g., **changing a column's data type**, changing charset, some PK changes. On a large table this is slow, IO-heavy, can lock or block, and on a replicated setup propagates as a big operation causing replication lag (M10). 
Type changes (widening an INT to BIGINT, changing VARCHAR charset, altering DECIMAL precision) are typically COPY operations — exactly the expensive kind. The danger scales with table size: trivial on a small table, a carefully-planned migration on a billion-row one.

**Why it exists / what it solves.** Recognizing migration cost at *design* time changes your type choices: you size integers with headroom (3.3) so you never have to widen a PK under emergency; you pick utf8mb4 from the start (3.8) so you never rewrite every row for a charset change; you choose DECIMAL precision generously enough to avoid re-precision later. It reframes "pick the type" as "pick the type you won't have to change," because the change is the expensive part.

**Tradeoffs & alternatives.** There's a tension between right-sizing tightly (footprint, 3.2) and leaving headroom to avoid migrations (3.3/3.15) — e.g., BIGINT vs INT for a PK trades 4 extra bytes/row against never risking an emergency widen. For unavoidable big changes, the alternatives are **online schema-change tools** (gh-ost, pt-online-schema-change, M13) that rebuild the table in the background with minimal locking by copying into a shadow table and swapping — turning a blocking COPY into a manageable online operation. Native ONLINE DDL (INPLACE/INSTANT) covers many cases in 8.0; the tools cover the rest (including some the engine can't do online).

**Generics / first-principles.** "Schema is a commitment; design for the change you can't cheaply make." This is the database face of "make the easy changes easy and the hard changes rare" — choose representations whose likely future evolutions are cheap, and pay a little now (headroom, correct charset) to avoid an expensive forced migration later. It's the same instinct as designing APIs/data formats for forward compatibility.

**MySQL-specific reality.** MySQL specifics: the **INSTANT / INPLACE / COPY** algorithm classes (and the `ALGORITHM=`/`LOCK=` clauses to request/assert them), expanded INSTANT operations in 8.0+, and the reality that **most type changes are COPY** and thus expensive at scale. The big ones to avoid by good upfront choices: widening a near-overflow integer PK (3.3 — pick BIGINT early), charset migration to utf8mb4 (3.8 — start there), DECIMAL re-precision (3.5/3.6 — size for the finest currency upfront). Online tools (gh-ost, pt-osc) and their FK caveats (M01/1.5) are the operational escape, detailed in M13. The lesson loops back: **the best migration is the one you designed your way out of needing.**

---

## 3.16 · Type-driven schema design principles & anti-patterns

**Mental model.** M03 distills into a small set of **rules of thumb** that, applied consistently, yield correct, compact, evolvable schemas — plus a catalog of **type anti-patterns** to avoid. The principles aren't arbitrary; each follows from a concept in this module (footprint, exactness, time, ids, nullability). Internalizing them turns type selection from per-column deliberation into fast, sound defaults you override only with reason.

**How it actually works — the principles.**
- **Smallest type that safely fits** (3.2/3.3) — right-size for footprint, with deliberate headroom against overflow.
- **NOT NULL by default** (3.13) — nullable only when "absent" is a real, distinct state.
- **Exact money** (3.4/3.5) — DECIMAL or integer minor units, never FLOAT; store currency alongside.
- **UTC time, DATETIME(6)** (3.9) — absolute instants in UTC, localize at the edges.
- **Compact binary ids** (3.12) — BIGINT or BINARY(16), never CHAR(36) for indexed ids.
- **utf8mb4** (3.8) — real Unicode, with collation chosen for the column's comparison needs.
- **Domains as data when they change on a data cadence** (3.10) — lookup table over ENUM unless tiny/immutable.
- **Typed columns for what you query/constrain; JSON only for the variable tail** (3.11).
- **Strict SQL mode on** (3.1, throughout) — reject bad data instead of silently coercing.

**The anti-patterns (the catalog):** **stringly-typed data** (numbers/dates/booleans stored as text — no validation, no ordering, bloat); **FLOAT money** (3.4); **`utf8` instead of utf8mb4** (3.8 — can't store emoji); **CHAR(36) UUID** (3.12); **VARCHAR(255) for everything** (3.7 — over-declared lengths); **ENUM for volatile sets / SET overuse** (3.10); **nullable everything** (3.13); **core fields buried in JSON** (3.11); **relying on TIMESTAMP for authoritative times** (2038/session-zone, 3.9). Each is a concept-from-this-module violated.

**Why it exists / what it solves.** A checklist of defaults + anti-patterns makes good schema design *fast and consistent* across a team and a large schema, and makes reviews effective ("this column is FLOAT money — fix it"). It converts the module's reasoning into actionable rules and a shared vocabulary for what "wrong type" means.

**Tradeoffs & alternatives.** Rules of thumb are *defaults*, not laws — each has a legitimate override (a deliberately wider int for headroom; a nullable column where absence is meaningful; JSON for a genuinely dynamic region; ENUM for a truly fixed tiny set). The skill is knowing *why* each default exists (the concept behind it) so you can recognize the rare case that justifies deviating. Blindly applying rules without understanding causes its own mistakes.

**Generics / first-principles.** "Encode each value in the type that honors its true semantics — meaning, range, exactness, and how it's compared — and make that the default." The anti-patterns all share one root: **using a more permissive type than the value's true nature**, trading away the database's help (validation, ordering, compact storage, exact arithmetic) for a hollow flexibility. The universal principle is "parse, don't validate / make illegal states unrepresentable," applied to storage.

**MySQL-specific reality.** This concept is the consolidated MySQL cheat-sheet (expanded in M14): the specific recommendations (BIGINT/BINARY(16) ids, DECIMAL/minor-units money, utf8mb4, UTC DATETIME(6), lookup-tables-over-ENUM, strict mode) and the specific MySQL traps (utf8mb3, FLOAT money, CHAR(36), ENUM empty-string, TIMESTAMP 2038, display-width INT(11)). It's both a design reference and a high-yield interview review list, and it sets the standards the capstone (3.17) applies.

---

## 3.17 · Fintech capstone — the physically-typed money schema ★

**Mental model.** The capstone makes M01's logical model and M02's normalized schema **physically real** by assigning every column its correct type — and in doing so it demonstrates the whole module: exact money, UTC microsecond instants, compact binary ids, tight integers, correct charsets, indexed-JSON metadata, NOT NULL discipline. The result is a payments schema that is simultaneously **correct** (money stays exact, time unambiguous), **compact** (small hot rows → good cache, 3.2), and **evolvable** (headroom and right charsets avoid forced migrations, 3.15). This typed schema is what M05 indexes and M16 builds the platform on.

**How it actually works — the typed money model (every choice justified by a concept).**
- **`account_id`, `transaction_id`, `customer_id`** → **BIGINT UNSIGNED** auto-inc (or **BINARY(16)** ULID/UUIDv7 if distributed/unguessable) — compact, locality-preserving ids (3.3/3.12), embedded efficiently in every index.
- **`amount`, `balance`** → **DECIMAL(18,2)** (fiat) or **BIGINT minor units** (crypto/high-precision) — exact money, never FLOAT (3.4/3.5); NOT NULL (3.13).
- **`currency`** → **CHAR(3)** with an exact/ASCII collation — fixed ISO-4217 code (3.7/3.8); carried alongside every amount so scale/rounding are unambiguous (3.6).
- **`created_at`, `settled_at`** → **DATETIME(6)** in UTC — microsecond-precise absolute instants for deterministic ordering (3.9, M01/1.15); `created_at` NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `settled_at` nullable (means "not yet settled," a real absent state, 3.13).
- **`status`** → **lookup table + FK** (or a tightly-scoped ENUM) — extensible, auditable domain (3.10).
- **`metadata`** → **JSON** for provider/method-specific tail fields, with a **STORED generated column + index** for any path you query (3.11); core money fields stay typed columns, never in JSON.
- **`idempotency_key`** → fixed-length, exact-collation string/binary, UNIQUE (M01/1.2, M16).

**Why it exists / what it solves.** It proves the module's thesis end to end: types are where logical correctness becomes *physical* correctness and performance. The same `ledger_entry` that M01 shaped and M02 normalized is now a table whose every column choice defends money exactness, time clarity, and cache efficiency — turning three modules of design into a real, sound `CREATE TABLE`. It's the foundation everything downstream (indexing M05, internals M09, the platform M16) assumes.

**Tradeoffs & alternatives.** The capstone embodies the module's tradeoffs: DECIMAL vs minor-units (3.5, both shown), BIGINT vs BINARY(16) ids (3.12, choose by distribution needs), ENUM vs lookup table for status (3.10), headroom vs footprint on integers (3.3/3.15), JSON flexibility vs typed-column rigor (3.11). Each is a conscious decision with a stated reason — which is exactly the point: a well-typed schema is a sequence of *justified* choices, not defaults stumbled into.

**Generics / first-principles.** "A correct physical schema is the logical model with every value encoded in the type that preserves its meaning, exactness, and access cost." The capstone is the synthesis of the whole thread set — durability (exact bytes survive), money-never-lies (exact money), generics-first (each type honoring its value's true nature), tradeoff (each choice costed). The transferable lesson: *design logically, then type physically with intent* — and the physical layer is where correctness and performance are won or lost.

**MySQL-specific reality.** The capstone is the concrete MySQL realization: InnoDB tables; BIGINT/BINARY(16) PKs sized and stored for index efficiency (3.2/3.12); DECIMAL(18,2)/minor-units money (3.4/3.5); CHAR(3) currency; DATETIME(6) UTC times (3.9); utf8mb4 text with chosen collations (3.8); JSON + indexed generated columns for metadata (3.11); NOT NULL discipline and strict mode (3.13/3.1); lookup-table statuses with FKs (3.10, M01/1.6 RESTRICT). This is the exact typed schema M05 will index for the access patterns (M01/1.14) and M16 will grow into a full payments platform — the physical foundation under the entire fintech capstone.

---

*Concepts 3.12–3.17 — Pass B core notes complete. **M03 Pass B is fully drafted (all 17 concepts).** Next, pending sign-off: Pass C (diagrams + worked examples) then Pass D (code-specifics, failure modes, fintech lens, interview angle, self-check).*
