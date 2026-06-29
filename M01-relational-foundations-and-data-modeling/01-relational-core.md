# M01 · Pass B — Concepts 1.1–1.8 · Relational Core, Keys, Integrity, NULL, Constraints

> **Pass B scope:** content-contract items **#1 Mental model · #2 How it works · #3 Why it exists · #4 Tradeoffs · #5 Generics · #6 MySQL reality** for each concept. Items #7–#12 (code-specifics, worked example, failure modes, fintech lens, interview angle, diagrams) come in Passes C/D.
>
> Running domain throughout: a **payments/wallet** system — `customer`/`party`, `account`, `transaction`, immutable `ledger_entry`.

---

## 1.1 · The relational model

**Mental model.** Stop picturing tables as files you read top-to-bottom or as boxes wired together with pointers. Picture *sets*. A relation is a set of facts of the same shape — "these are all the accounts" — and the database's whole job is to answer questions about sets: combine them, filter them, group them. You describe *what* set you want; the engine figures out *how* to produce it. The relational model is the move from "I walk the data" to "I declare the data I want."

**How it actually works.** The model (Codd, 1970) defines data as **relations**: a relation has a *heading* (a set of attribute-name/domain pairs) and a *body* (a set of tuples, each tuple a value drawn from those domains). Operations come from **relational algebra** — selection (filter rows), projection (pick columns), join (combine relations on matching values), union/intersection/difference, and so on. These operations are *closed*: every operation on relations returns a relation, which is why you can nest and compose queries without limit. SQL is a (loose, imperfect) surface syntax over this algebra; the optimizer translates your declarative SQL into a chosen sequence of physical algebra operators.

**Why it exists / what it solves.** Before the relational model, data was navigated through hierarchical and network databases (IMS, CODASYL) where the application chased pointers along access paths baked into the storage. Change the questions you asked, and you often had to restructure the data or rewrite traversal code. Codd's insight was **data independence**: separate the *logical* shape of data from its *physical* storage and access paths, so applications ask set-based questions and are insulated from how the data is laid out or indexed. That decoupling is the entire reason you can add an index, change storage engines, or reorganize files without rewriting queries.

**Tradeoffs & alternatives.** The relational model buys generality, integrity, and ad-hoc queryability at the cost of an *impedance mismatch* with object/graph-shaped data and of join cost for highly connected traversals. Alternatives optimize a different axis: document stores (keep an aggregate together, lose cross-aggregate joins), key-value (raw speed, no query language), graph databases (cheap multi-hop traversal, the thing relational joins do expensively), column stores (analytics over few columns × many rows). None of these *replace* the relational model; they trade its generality for a narrower, faster shape.

**Generics / first-principles.** The transferable idea is **declarative set processing with physical data independence**. "Describe the result, not the procedure" and "logical schema ⟂ physical storage" show up far beyond SQL — in query planners generally, in Spark/dataframe engines, in the way distributed systems separate a logical key space from physical shards.

**MySQL-specific reality.** MySQL implements the relational model through a SQL frontend plus pluggable **storage engines** (InnoDB by default). It is pragmatic, not a pure relational system: SQL tables are bags, not sets (duplicate rows are possible without a key — see 1.2), and MySQL historically tolerated relational-integrity sins (silent truncation, lax `GROUP BY`, late/weak `CHECK` enforcement) that strict mode and modern versions have tightened. Keep the model as your north star and treat MySQL's deviations as things to defend against, not as the definition of "relational."

---

## 1.2 · Relations vs tables (theory vs SQL)

**Mental model.** A *relation* is the clean mathematical object: an unordered set with no duplicate tuples and no concept of "row 1 vs row 2." A *SQL table* is the messy real-world cousin: an ordered-ish **bag** that will happily store the same row twice and exposes things the theory forbids (NULLs, duplicate rows, row position via `LIMIT`/`OFFSET`). The gap between the two is exactly where a class of bugs lives.

**How it actually works.** Three concrete divergences:
1. **Duplicates.** A relation is a *set* — `{a, a}` is just `{a}`. A SQL table with no unique constraint can physically hold two byte-identical rows. The thing that drags a table back toward being a true relation is a **key** (1.3): declare uniqueness and duplicates become impossible.
2. **Order.** Relations have no row order. SQL tables have no *guaranteed* order either — but they *appear* to (insertion/clustered order) until a query plan changes, which is why relying on implicit order is a latent bug. Order only exists where you write `ORDER BY`.
3. **NULL.** The pure relational model (in Codd's later formulations) has no NULL or has carefully-defined markers; SQL bolts on NULL and three-valued logic (1.7), which breaks several tidy relational identities.

**Why it exists / what it solves.** SQL chose pragmatism over purity in the 1970s–80s: bags are cheaper to maintain than enforced sets (no dedup on every insert), and real data is genuinely missing/unknown sometimes (hence NULL). The cost is that the engine no longer *guarantees* the clean properties — you have to *opt back in* to them with constraints.

**Tradeoffs & alternatives.** Letting a table be a bag is faster to write to and more forgiving, but every property you don't enforce (uniqueness, non-null, domain limits) is a property your application now has to enforce — usually less reliably, across more code paths. The discipline is to push as much of the relation's purity into the schema (keys, NOT NULL, CHECK, UNIQUE) as the workload can afford.

**Generics / first-principles.** "The data structure your tool gives you is weaker than the abstraction you're reasoning in; the difference is your responsibility." A SQL table is a bag pretending to be a set; a JS array is a list pretending to be a set; etc. Knowing the gap tells you exactly which invariants you must enforce yourself.

**MySQL-specific reality.** InnoDB physically stores rows in a **clustered index ordered by primary key** (M05), so MySQL tables have a real on-disk order — but that's a storage detail, not a relational guarantee, and you must never read meaning into it without `ORDER BY`. Without an explicit `PRIMARY KEY`, InnoDB invents a hidden 6-byte `GEN_CLUST_INDEX` rowid — i.e., MySQL silently mints a surrogate so the "table" still has *some* key, even though duplicate user-visible rows remain possible. Lesson: always declare your own primary key; don't let InnoDB pick for you.

---

## 1.3 · Keys: candidate, primary, alternate

**Mental model.** A key is a **promise of uniqueness**: "no two rows ever agree on all of these columns." Among all the columns/combinations that *could* make that promise (candidate keys), you anoint one as the **primary key** — the official handle the rest of the system uses to point at a row — and the leftovers become **alternate keys** you still enforce as UNIQUE.

**How it actually works.** Build it up:
- A **superkey** is any set of columns whose values are unique per row (possibly with redundant extra columns).
- A **candidate key** is a *minimal* superkey — remove any column and it stops being unique. A table can have several.
- The **primary key** is the candidate key you designate as canonical. It implies NOT NULL + UNIQUE and becomes the row's identity for foreign keys to reference.
- **Alternate (secondary) keys** are the other candidate keys; you enforce them with UNIQUE constraints so their uniqueness promise still holds.

**Why it exists / what it solves.** Without a key, a table is a bag (1.2): you can't reliably address a single row, you can get duplicate facts, and foreign keys have nothing trustworthy to point at. Keys are what make rows *identifiable* and *referenceable* — the precondition for integrity, joins, and updates that hit exactly one row.

**Tradeoffs & alternatives.** Choosing the PK is a design decision with downstream cost: the PK's width and stability affect every secondary index and every foreign key (in InnoDB, the PK is *embedded* in every secondary index — M05). A wide or volatile PK is expensive forever. The main alternative axis (natural vs surrogate, 1.4) is really a debate about *which* candidate key to promote.

**Generics / first-principles.** "Identity must be declared, not assumed." Every entity in any system needs a stable, unique handle; databases just make you state it explicitly. The minimality requirement (candidate key) is the same instinct as "don't put redundant fields in your identity."

**MySQL-specific reality.** In InnoDB the primary key is special and physical: it *is* the clustered index — rows are stored in PK order, and **every secondary index stores the PK value as its row pointer**. So PK choice in MySQL isn't just logical identity; it directly sets your storage layout, your insert pattern, and the size of every other index. A long PK (e.g., a random UUID stored as CHAR) silently bloats every index in the table. This is why MySQL practitioners obsess over short, monotonic primary keys (foreshadows 1.15, M05, M09).

---

## 1.4 · Natural vs surrogate keys

**Mental model.** A **natural key** is an identifier the real world already gives you and you choose to trust (email, IBAN, ISO currency code). A **surrogate key** is a meaningless internal number/ID you mint yourself precisely *so that the real world can't break your identity*. Natural keys carry meaning and risk; surrogate keys carry neither.

**How it actually works.** A natural key uses business attributes as the PK. Its appeal: no extra column, and joins/lookups can use values humans already know. Its hazard: business identifiers *change* (people change email; a country changes its phone code; a vendor reassigns a SKU) and changing a PK ripples through every foreign key referencing it. A surrogate key (auto-increment, UUID, ULID, Snowflake — 1.15) sidesteps this: the internal ID never changes because it never meant anything. You then keep the natural identifier as a **UNIQUE alternate key** so you still enforce its real-world uniqueness without depending on it for identity.

**Why it exists / what it solves.** The surrogate-key pattern exists to **decouple identity from mutable meaning**. Money systems care intensely here: an account's external identifiers (IBAN, card PAN) can be reissued, masked, or rotated, but the ledger entries pointing at that account must never be orphaned or remapped. A stable surrogate `account_id` makes that guarantee trivial.

**Tradeoffs & alternatives.** Surrogate keys cost an extra column and an extra index, add a layer of indirection (you must join to see human-meaningful values), and don't prevent duplicate *business* rows unless you also add the natural UNIQUE constraint (a classic bug: surrogate PK with no natural uniqueness → two "same" customers). Natural keys save the column and self-document, but couple you to the stability and format of an external identifier. Common practical rule: **surrogate PK for identity + natural UNIQUE key for the business rule.**

**Generics / first-principles.** "Don't build identity on top of data you don't control." This is the same principle as using internal user IDs instead of usernames, or content-addressing vs name-addressing. The surrogate is a stable indirection layer over volatile external names.

**MySQL-specific reality.** Because InnoDB embeds the PK in every secondary index (1.3), the natural-vs-surrogate choice has a *physical* cost in MySQL that's bigger than in some other engines. A natural key that's long or non-monotonic (a textual IBAN, a random UUID) bloats and fragments every index. This pushes MySQL design strongly toward **compact, monotonic surrogate keys** (BIGINT auto-increment, or ULID/UUIDv7 when you need distributed/unguessable IDs) with the natural identifier kept as a separate UNIQUE column. The deeper "which surrogate generator" question is concept 1.15.

---

## 1.5 · Foreign keys & referential integrity

**Mental model.** A foreign key is **a pointer the database refuses to let dangle**. It encodes the rule "every `ledger_entry.account_id` must name an `account` that actually exists" and makes the engine reject any insert/update/delete that would violate it. Referential integrity is the guarantee that your relationships never point into the void.

**How it actually works.** A foreign key constraint links a *child* column (or set) to a *parent* key (usually the parent's PK or a UNIQUE key). The engine then enforces, on every mutation: you can't insert a child row whose FK value has no matching parent; you can't delete/update a parent in a way that would strand existing children — unless you've declared a **referential action** (1.6) telling it what to do instead. Enforcement requires the parent side to be indexed (it's a key), and the child side is typically indexed too so the checks and cascades are fast.

**Why it exists / what it solves.** Relationships are the half of a data model that isn't entities — and they're easy to corrupt: an application bug, a race, or a partial failure can leave a charge pointing at a deleted account. FKs move that guarantee from "every code path must remember to check" to "the database physically cannot store the broken state." In a money system, a dangling ledger entry is a lost or unattributable transaction — exactly the failure class this resource's *money-never-lies* thread is about.

**Tradeoffs & alternatives.** FKs cost write performance (every child insert checks the parent; every parent delete checks for children) and add lock interactions that can surprise you (parent updates can block on child indexes; cascades can lock wide). At extreme scale and under sharding (M11), FKs across shards are impossible, so large systems sometimes drop DB-enforced FKs and move the check into the application or an async reconciliation job (M16) — trading a hard guarantee for write throughput and horizontal scale. That trade should be *deliberate*, never accidental.

**Generics / first-principles.** "Make illegal states unrepresentable." A foreign key is the database expression of that principle for relationships, the same instinct as a non-nullable reference type or a parser that can't construct an invalid AST. The agnostic question is always: who owns this invariant — the storage layer, the type system, or hopeful application code?

**MySQL-specific reality.** FKs are an **InnoDB** feature — MyISAM parses and silently ignores them, a historic footgun. InnoDB enforces them immediately (not deferrable, unlike some databases), requires an index on the referenced columns, and auto-creates one on the child side if absent. There are real gotchas: FK checks add per-row overhead and lock contention on hot parents; some online-schema-change tools (gh-ost, pt-osc — M13) struggle with FKs; and very large cascading deletes can be slow and lock-heavy. These pragmatics are why some high-scale MySQL shops minimize FKs — but for correctness-critical fintech tables, the integrity guarantee usually wins.

---

## 1.6 · Referential actions (CASCADE / RESTRICT / SET NULL / NO ACTION)

**Mental model.** A referential action is your **declared policy for what happens to children when their parent moves or dies**. Delete a customer — should their accounts vanish too (CASCADE), should the delete be blocked (RESTRICT), or should the accounts be orphaned-but-kept (SET NULL)? You're pre-deciding the cleanup so the database does the right thing automatically.

**How it actually works.** Each FK can specify `ON DELETE` and `ON UPDATE` behavior:
- **CASCADE** — propagate: deleting the parent deletes matching children; updating the parent key updates the children's FK.
- **RESTRICT / NO ACTION** — refuse: block the parent operation if any child exists. (In InnoDB the two behave the same — both reject immediately; the SQL-standard distinction about *when* the check fires doesn't apply since InnoDB doesn't defer.)
- **SET NULL** — orphan deliberately: set the child's FK to NULL (only legal if the column is nullable).
- **SET DEFAULT** — set to a default value (parsed but not supported by InnoDB).

**Why it exists / what it solves.** Without declared actions, you'd hand-write cleanup logic everywhere a parent can be removed, and miss cases. Referential actions centralize the policy in the schema so it's consistent and atomic with the triggering operation.

**Tradeoffs & alternatives.** CASCADE is convenient and dangerous: a single innocuous-looking `DELETE` can silently remove huge subtrees, take wide locks, and destroy data you meant to keep. RESTRICT is safe but forces you to handle cleanup explicitly (often what you want for audit-critical data). SET NULL preserves children but introduces NULLs (and the three-valued-logic hazards of 1.7) and semantically "an entry belonging to no account." The alternative to all of these is **soft deletes** (mark `deleted_at`, never physically remove) — common in fintech precisely because hard deletes + cascade can erase audit history.

**Generics / first-principles.** "Lifecycle coupling must be explicit." Whenever one object's existence depends on another's, *someone* decides what happens on parent removal — the only question is whether that decision is declared and enforced, or implicit and inconsistent.

**MySQL-specific reality (★ money-never-lies).** In InnoDB, **RESTRICT/NO ACTION are immediate** (no deferred checks), and **SET DEFAULT is unsupported**. The load-bearing rule for fintech: a **ledger should `RESTRICT` (or be append-only/soft-delete), never `CASCADE`, on account/customer delete.** Cascading a customer delete into their ledger entries would erase the immutable financial record — the single worst thing a money system can do. The correct shape is: accounts and customers are never hard-deleted (closed/flagged instead), ledger entries are never deleted at all, and FKs `RESTRICT` so a stray `DELETE` fails loudly instead of quietly eating history. Also note: InnoDB cascades **bypass triggers**, so audit triggers won't fire on cascaded rows — another reason to avoid CASCADE on anything you must audit.

---

## 1.7 · NULL and three-valued logic

**Mental model.** NULL means **"unknown / not applicable,"** not zero and not empty string. And because it's unknown, comparing *anything* to it yields neither TRUE nor FALSE but a third value — **UNKNOWN**. NULL is a hole in your data that quietly poisons every comparison it touches.

**How it actually works.** SQL uses **three-valued logic (3VL)**: TRUE, FALSE, UNKNOWN. Any comparison involving NULL (`balance = NULL`, `balance > 100` when balance is NULL, even `NULL = NULL`) returns UNKNOWN. `WHERE` keeps only rows that evaluate to TRUE, so UNKNOWN rows are silently dropped. You must test for NULL with `IS NULL` / `IS NOT NULL`, never `=`. NULL also behaves specially in aggregates (most aggregates *skip* NULLs — `AVG` ignores them, `COUNT(col)` skips them while `COUNT(*)` counts the row), in `GROUP BY` (NULLs group together), and in UNIQUE constraints (typically multiple NULLs are allowed because two unknowns aren't "equal").

**Why it exists / what it solves.** Real data is genuinely missing or inapplicable — a pending transaction has no `settled_at` yet, a wallet might have no assigned `iban`. NULL gives a first-class way to represent "we don't know" instead of forcing a fake sentinel (0, '', 1900-01-01) that the database would treat as a real value and that would corrupt aggregates and comparisons.

**Tradeoffs & alternatives.** NULL is honest but treacherous: it breaks the intuition that `WHERE x <> 5` returns "all rows where x isn't 5" (it excludes NULLs), it complicates indexes and joins, and three-valued logic trips up nearly everyone at some point. Alternatives: forbid NULLs with NOT NULL and model "missing" explicitly (a status column, a separate table, or a documented sentinel) — cleaner reasoning at the cost of more schema. Many fintech schemas minimize nullable columns precisely to keep money math unambiguous.

**Generics / first-principles.** "Absence is not a value; pretending it is corrupts your logic." The same issue recurs everywhere — `null`/`None`/`nil`, `NaN` propagation in floats, `Option`/`Maybe` types. SQL's 3VL is just the database's particular (leaky) handling of the universal absence problem. The disciplined answer in any system is to make absence explicit and handle it deliberately.

**MySQL-specific reality.** MySQL follows SQL 3VL, with quirks worth knowing: it offers the **NULL-safe equality operator `<=>`** (`NULL <=> NULL` is TRUE) for when you *do* want to match unknowns; `COUNT(col)` vs `COUNT(*)` differ on NULLs; UNIQUE indexes allow multiple NULLs (so a UNIQUE column isn't a uniqueness guarantee for the NULL case); and in older/loose SQL modes MySQL would coerce NULLs in ways strict mode now rejects. For money columns the practical guidance is **NOT NULL + a sensible default (often 0 with a CHECK), or model the "no value yet" state as an explicit status** rather than letting balance/amount be NULL.

---

## 1.8 · Domains, constraints & the closed-world assumption

**Mental model.** Your schema is a **fence around the set of states your data is allowed to be in**. Anything the fence doesn't permit shouldn't be able to exist — that's the *closed-world assumption*. Constraints (NOT NULL, UNIQUE, CHECK, FK, data types) are the fence posts: each one removes a class of invalid rows from the realm of the possible.

**How it actually works.** A **domain** is the set of legal values for an attribute — conceptually "amounts are non-negative decimals with 2 places," realized in SQL through a column's **data type** plus **constraints**:
- **NOT NULL** — absence is illegal here.
- **UNIQUE** — no duplicates on this column/set (an alternate-key promise, 1.3).
- **CHECK** — an arbitrary boolean predicate every row must satisfy (`amount >= 0`, `currency IN (...)`).
- **FOREIGN KEY** — referential domain: values must exist in a parent (1.5).
- **Data type** — the coarse domain (INT, DECIMAL, DATE…), the first and cheapest fence.
Together they shrink the space of representable rows down toward only the *valid* ones, enforced by the engine on every write.

**Why it exists / what it solves.** Every invariant not enforced by the schema must be enforced by application code — in every path that writes, forever, without races. That's where data rot comes from. Constraints move invariants into one place the database guarantees, so "amount is never negative" or "currency is a known code" is true by construction rather than by hope. This is the structural prevention layer behind the *money-never-lies* thread.

**Tradeoffs & alternatives.** Constraints cost write performance (every insert/update is validated) and some flexibility (a CHECK that's too strict blocks legitimate edge cases; changing a constraint on a huge table is an expensive migration — M13). The alternative — enforce in the app — is more flexible and can express richer rules, but is less reliable (bugs, races, multiple writers, scripts/migrations that bypass it). Mature practice: **enforce hard invariants in the schema, richer/contextual rules in the app**, accepting that the schema is the last line that can't be bypassed.

**Generics / first-principles.** "Constrain the type, not the caller." Making invalid states unrepresentable at the data layer is the database analog of strong typing, validated value objects, and parse-don't-validate. The closed-world assumption — *if it's not provably allowed, it's disallowed* — is a design stance you can apply far beyond databases.

**MySQL-specific reality.** A crucial historical gotcha: MySQL **parsed `CHECK` constraints but silently ignored them until version 8.0.16** — so on older versions a `CHECK (amount >= 0)` gave a false sense of safety while enforcing nothing. From 8.0.16+ CHECK is actually enforced. Other MySQL realities: ENUM/SET offer a built-in value domain but with sharp edges (ordering, the empty-string-on-invalid behavior in loose modes); **strict SQL mode** is what turns "silently truncate/coerce bad data" into "reject bad data," and should be on for any system that cares about integrity; and UNIQUE indexes permit multiple NULLs (1.7). The throughline: on modern MySQL with strict mode + enforced CHECKs, the schema-as-fence model finally works the way the theory always promised — but you must verify the version and mode, not assume.

---

*Concepts 1.1–1.8 — Pass B core notes complete. Next: 1.9–1.14 (modeling altitudes, ER, cardinality, junction tables, weak entities, design-for-queries).*
