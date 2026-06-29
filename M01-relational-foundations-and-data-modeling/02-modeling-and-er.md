# M01 · Pass B — Concepts 1.9–1.14 · Modeling Altitudes, ER, Cardinality, Junctions, Weak Entities, Design-for-Queries

> Pass B scope: contract items **#1–#6** per concept. Running domain: payments/wallet. ER notation standard: **crow's-foot**.

---

## 1.9 · Conceptual → logical → physical modeling

**Mental model.** Modeling happens at **three altitudes**, and confusing them is the most common modeling mistake. *Conceptual* = what exists in the business (customers hold accounts; accounts have transactions) — no tables, no types, drawable on a whiteboard for a non-engineer. *Logical* = how that structures into relations (tables, keys, foreign keys, normal forms) — vendor-neutral. *Physical* = how MySQL actually stores it (column types, indexes, storage engine, partitioning) — vendor-specific and performance-driven. You descend the altitudes; you don't skip them.

**How it actually works.** Each altitude is a refinement of the one above:
- **Conceptual:** entities, their relationships, and high-level attributes. Output: an ER sketch that a domain expert can validate. Ignores keys, types, performance.
- **Logical:** turn entities into tables, choose primary/foreign keys, resolve many-to-many into junction tables (1.12), apply normalization (M02). Still no data types or indexes — it's about *correct structure*. Output: a normalized relational schema.
- **Physical:** assign MySQL data types (M03), choose the primary-key shape and clustered-index implications (M05), add secondary indexes for the access patterns (1.14), pick the engine, decide partitioning/sharding (M11). Output: the actual `CREATE TABLE` reality, tuned for *this* engine and *this* workload.

**Why it exists / what it solves.** Separating altitudes lets different people reason at the right level and lets decisions change independently: a domain expert validates the conceptual model without caring about `BIGINT`; you re-tune the physical model (add an index, change a type, shard) without changing what the data *means*. It's the practical expression of data independence (1.1).

**Tradeoffs & alternatives.** Going through all three is slower up front and can feel like ceremony for a small app — many teams jump straight to physical `CREATE TABLE`s, which is fine until the domain is complex enough that an un-validated conceptual model bakes in a wrong assumption that's expensive to undo later. The risk isn't "too much modeling," it's *skipping the conceptual step and discovering the business was misunderstood after the data's already shaped wrong.*

**Generics / first-principles.** "Separate *what* from *how*, then separate *how-logically* from *how-physically*." This is the same layering as requirements → architecture → implementation, or domain model → API → storage. Each layer is stable against changes below it.

**MySQL-specific reality.** The physical altitude is where MySQL/InnoDB specifics dominate and where this whole resource lives after M01: the clustered-index-is-the-PK rule (M05), type storage footprints (M03), index design for access patterns (M05/M06), engine choice (InnoDB), and scale-out shape (M11). The logical model is portable across SQL databases; the physical model is where "Postgres vs MySQL" actually diverges. Keep the logical model clean and let the physical model absorb the engine's quirks.

---

## 1.10 · Entities, attributes & relationships (ER modeling)

**Mental model.** ER modeling gives you a **vocabulary**: *entities* are the nouns (things you keep data about — Customer, Account, Transaction), *attributes* are their properties (an account's currency, status, opening date), and *relationships* are the verbs that connect entities (a customer *holds* accounts; a transaction *posts* entries). Modeling a domain is mostly "find the nouns, find the verbs, decide what details each noun carries."

**How it actually works.** An **entity** becomes a table; each **entity instance** becomes a row. **Attributes** become columns and come in flavors worth distinguishing: *simple* vs *composite* (an address that's really street+city+zip), *single-valued* vs *multi-valued* (one birthdate vs many phone numbers — a multi-valued attribute is a signal you need a child table, foreshadowing 1NF in M02), *stored* vs *derived* (store balance, or derive it from entries — see 1.17). **Relationships** carry **cardinality** (1.11) and become either a foreign key (for 1:N) or a junction table (for M:N, 1.12). In **crow's-foot** notation, entities are boxes, relationships are lines, and the line *endings* encode cardinality/optionality (the "crow's foot" fan = "many," a bar = "one," a circle = "optional/zero").

**Why it exists / what it solves.** ER modeling is the bridge from a fuzzy domain conversation to a precise schema. It externalizes the model into a picture domain experts can critique *before* it's expensive to change, and it forces you to make implicit relationships explicit (the moment you draw "customer — account" you have to answer "one account, or many? can an account have two owners?").

**Tradeoffs & alternatives.** ER diagrams are great for structure but say little about behavior, process, or access patterns — they can look "right" while being wrong for your queries (1.14). They also tempt over-modeling (every conceivable entity drawn before you know if you need it). Alternatives/complements: domain-driven-design aggregates (which influence transaction and sharding boundaries — M11/M16), event models (1.17), and just-enough modeling for small domains.

**Generics / first-principles.** "Nouns become types, verbs become relationships, details become fields." This entity/attribute/relationship decomposition is the same shape as object modeling, knowledge graphs, and RDF triples — a universal way to factor a domain into things, their properties, and their connections.

**MySQL-specific reality.** MySQL itself is notation-agnostic — ER modeling is a design activity, not a MySQL feature — but tooling (MySQL Workbench's EER diagrams, dbdiagram, etc.) can forward-/reverse-engineer between crow's-foot diagrams and `CREATE TABLE` DDL. The translation rules are mechanical and matter later: a 1:N relationship → FK on the "many" side; an M:N → junction table; a multi-valued attribute → child table; a composite attribute → either multiple columns or a child table depending on how you'll query it (1.14, M02).

---

## 1.11 · Cardinality & optionality

**Mental model.** Two questions about every relationship: **cardinality** — *how many* on each side (one-to-one, one-to-many, many-to-many)? — and **optionality** — *is zero allowed* on each side (mandatory vs optional participation)? Together they're the arithmetic that decides where keys go and whether a column can be NULL.

**How it actually works.**
- **1:1** — each side relates to at most one of the other (an account and its single KYC record). Implemented by putting a UNIQUE FK on one side, or merging into one table if they always coexist.
- **1:N** — the common case (one customer, many accounts; one account, many transactions). Implemented by a **foreign key on the "many" side** pointing back to the "one." No junction needed.
- **M:N** — both sides can relate to many (a customer can hold several accounts *and* an account can have several holders — joint accounts). Cannot be a single FK; requires a **junction table** (1.12).
- **Optionality** maps to NULL-ability and minimum cardinality: "an account *must* have an owner" → FK NOT NULL; "a transaction *may* have a related dispute" → nullable/absent FK. Crow's-foot draws the outer symbol for max cardinality (one bar / many crow's-foot) and the inner symbol for min (circle = optional/zero, bar = mandatory/one).

**Why it exists / what it solves.** Cardinality/optionality is what turns a vague relationship line into concrete, enforceable schema. "A customer has accounts" is ambiguous until you say "one-to-many, and an account must have exactly one owner" — which directly produces `account.customer_id` FK NOT NULL. Get cardinality wrong and you either can't represent reality (modeled 1:N when it's truly M:N — can't add a joint owner) or you allow nonsense (optional where it should be mandatory — an orphan account).

**Tradeoffs & alternatives.** The risky judgments are (a) **1:1 vs merge** — splitting a 1:1 into two tables adds a join and a constraint but isolates rarely-used or sensitive columns (e.g., KYC/PII separate from the hot account row); merging is simpler but bloats the row. (b) **"is it really 1:N or secretly M:N?"** — the costliest mistake is modeling something 1:N that the business later reveals is M:N (joint accounts, a transaction touching two accounts), forcing a painful migration to a junction table. When unsure whether many is possible, leaning M:N is safer to evolve.

**Generics / first-principles.** "Multiplicity and optionality are independent axes, and both must be decided explicitly." This is identical to type-system reasoning: `Account` vs `Account[]` (cardinality) and `Account` vs `Account?` (optionality). Naming them separately prevents the classic conflation of "many" with "optional."

**MySQL-specific reality.** MySQL expresses these through FK placement + NULL-ability + UNIQUE: 1:N is a plain FK; 1:1 is a UNIQUE FK (or shared PK); mandatory participation is NOT NULL on the FK; M:N is a separate table with a composite PK (1.12). One MySQL nuance: enforcing a *minimum* cardinality greater than zero on the "one" side (e.g., "every customer must have at least one account") is **not** expressible with a simple FK — FKs enforce "child needs a parent," not "parent needs a child." That kind of rule needs application logic, a trigger, or a deferred check pattern — a recurring limitation worth flagging to interviewers.

---

## 1.12 · Associative (junction) tables & many-to-many

**Mental model.** A many-to-many relationship **can't be drawn as a direct line with a foreign key** — there's no single side to hang the FK on. So you *manufacture a new entity in the middle* whose entire job is to record one pairing per row. The junction table turns one M:N into two clean 1:N relationships.

**How it actually works.** Given M:N between `customer` and `account` (joint accounts: a customer can hold many accounts; an account can have many holders), you create an **associative/junction table** `account_holder(customer_id, account_id, …)`. Each row is one (customer, account) pair. It has two FKs (one to each parent) and typically a **composite primary key** of those two FKs (which also enforces "no duplicate pairing"). The junction table is also the natural home for **attributes of the relationship itself** — data that belongs to neither parent alone: when the holder was added, their role (primary vs secondary owner), their permission level. The presence of relationship attributes is often the clearest sign you genuinely have an entity, not just a link.

**Why it exists / what it solves.** It's the only correct relational way to represent M:N, and it's strictly more expressive: beyond enabling the many-to-many, it gives relationships their own attributes and history. Without it you'd resort to anti-patterns (comma-separated lists of IDs in a column, or duplicating rows) that destroy queryability and integrity (see 1.18).

**Tradeoffs & alternatives.** A junction adds a table and a join (M:N queries now traverse three tables). The PK choice is a real decision: **composite PK (customer_id, account_id)** is lean and enforces uniqueness directly, but means every table referencing the *relationship* must carry both columns, and in InnoDB that composite PK is embedded in secondary indexes (M05). A **surrogate PK on the junction** (its own `id`) is friendlier when other tables must reference a specific holding, at the cost of needing a separate UNIQUE on (customer_id, account_id) to still forbid duplicate pairings. Choose composite for pure link tables, surrogate when the relationship is itself referenced.

**Generics / first-principles.** "Reify the relationship." When a connection between two things has its own identity, attributes, or history, promote it from an edge to a node. This is the same move as an edge-with-properties in a graph database, or a `Membership`/`Enrollment` class instead of a bare collection — the relationship becomes a first-class thing.

**MySQL-specific reality.** Standard MySQL practice: junction table with two FK columns, **composite PK on the pair**, and InnoDB enforcing both FKs. Index-order matters — the composite PK `(customer_id, account_id)` efficiently answers "all accounts for this customer" (leftmost-prefix, M05) but *not* "all customers for this account"; the latter needs a second index `(account_id, customer_id)`. So a junction table that must be queried from both directions typically carries the composite PK plus one extra secondary index — a concrete instance of "model for your queries" (1.14) that's easy to forget.

---

## 1.13 · Weak entities & identifying relationships

**Mental model.** Some rows **can't exist, and can't even be identified, without their parent**. A ledger line item only means something *inside* its parent transaction; "line 2" is meaningless globally but precise as "line 2 *of transaction T*." A weak entity borrows part of its identity from the parent — its key is the parent's key *plus* a local discriminator.

**How it actually works.** A **weak (dependent) entity** has no key of its own that's unique globally; it depends on a **strong (owner) entity** through an **identifying relationship**. Its primary key is composite: **the parent's PK + a partial key** that distinguishes siblings within one parent. Example: `ledger_entry(transaction_id, line_no, …)` with PK `(transaction_id, line_no)` — `line_no` alone isn't unique, but `(transaction_id, line_no)` is. Contrast with a *non-identifying* relationship, where the child has its own independent key and merely references the parent (a plain 1:N FK, 1.11). Crow's-foot/EER notation draws weak entities and identifying relationships distinctly (often a doubled box/line) to flag the dependency.

**Why it exists / what it solves.** It models genuine existence-dependence honestly: line items, order details, address-lines-of-a-shipment, payment-legs-of-a-transfer. Forcing such children to have a standalone surrogate identity can obscure the fact that they're meaningless without their parent and that their natural identity is *positional within the parent*. The composite key also makes the integrity rule ("a line belongs to exactly one transaction, and line numbers are unique within a transaction") structural.

**Tradeoffs & alternatives.** The composite, parent-derived key is semantically pure but practically heavier: it's wider, it propagates into anything referencing the child, and in InnoDB it's embedded in the child's secondary indexes (M05). The common pragmatic alternative is to give the weak entity a **surrogate PK** anyway (`ledger_entry.id`) for convenience while keeping a UNIQUE constraint on `(transaction_id, line_no)` to preserve the real rule. So in practice many "weak entities" are modeled as ordinary tables with a surrogate PK + a uniqueness constraint that captures the dependence — you keep the *invariant* without paying the composite-key tax everywhere.

**Generics / first-principles.** "Identity can be relative." Not everything needs a globally unique handle; some things are best identified *relative to a container*. This is the database version of nested/scoped identity — a file's identity is its path within a directory, a comment's position within a thread. Recognizing relative identity prevents inventing meaningless global IDs for things that are inherently local.

**MySQL-specific reality.** MySQL has no special "weak entity" syntax — you express it with a **composite primary key** (parent FK columns + discriminator) and an `ON DELETE` policy (often CASCADE *is* defensible here, since a child genuinely can't outlive its parent — though for ledger/audit data the *money-never-lies* rule from 1.6 still pushes toward never deleting). The InnoDB consideration: a composite PK whose leading column is the parent key gives you good clustering (all of a transaction's lines stored together — great for "fetch the whole transaction"), which is often a *performance win*, not just a modeling nicety.

---

## 1.14 · Designing for the queries you'll run

**Mental model.** A schema is **not "correct" in the abstract — it's correct for an access pattern.** The same domain modeled for "look up one account's current balance" looks different from the same domain modeled for "produce a 12-month statement" or "sum all settlements per day." You model the **reads and writes you'll actually issue**, not just the nouns. Schema design is half ER modeling and half "what queries must be fast?"

**How it actually works.** You enumerate the real access patterns first — the handful of queries that dominate traffic and the ones with hard latency requirements — and let them drive physical (and sometimes logical) choices: which columns are indexed and in what order (M05), whether to **denormalize** a hot derived value (store `account.balance` vs recompute from entries — M02/1.17), whether to split a table (isolate cold/large columns from the hot row), how to choose the **primary key** so the most common range scans are sequential (all of a customer's transactions clustered together), and whether to pre-aggregate (a daily-totals table) instead of scanning raw entries every time. The model and the queries are co-designed: a normalization choice that's "purer" but makes the dominant query do five joins may be the wrong choice for that workload.

**Why it exists / what it solves.** Pure structural correctness (normalized, well-keyed) guarantees *integrity*, not *performance*. Two schemas can be equally normalized yet differ 100× on your hottest query because one clusters and indexes for it and the other doesn't. Designing for queries is how you avoid the classic outcome: a beautiful normalized model that requires a six-table join and a full scan to answer the single most common request.

**Tradeoffs & alternatives.** This is the central tension of the whole field: **normalization (integrity, no update anomalies) vs query-shaped design (read speed, fewer joins)** — the explicit subject of M02. Optimizing for today's queries can over-fit and make tomorrow's queries hard; denormalizing for reads creates write-time duplication you must keep consistent (and a fresh failure mode — *money-never-lies*: a cached balance that drifts from the ledger). The discipline is to keep the **system of record normalized and authoritative**, and treat query-shaped structures (denormalized columns, summary tables, read-models) as *derived* and rebuildable.

**Generics / first-principles.** "There is no schema without a workload." Data structures are chosen against access patterns everywhere — you don't pick a hash map vs a B-tree vs a list in the abstract, you pick against how it'll be read and written. The database is the same: the optimal shape is a function of the queries. Query-first / "API-first" / "read-model" design are all this principle.

**MySQL-specific reality.** In MySQL this principle is unusually load-bearing because of the **clustered primary key**: PK choice doesn't just identify rows, it *physically orders* them, so picking a PK that matches your dominant range scan (e.g., `(account_id, created_at)` for "this account's transactions over time") turns a scattered random-IO query into a sequential one (M05/M09). Covering indexes (answer the query from the index alone, no row lookups), composite-index column order (leftmost-prefix), and summary tables are the main MySQL levers. The recurring MySQL workflow is: write the query → `EXPLAIN` it (M06) → adjust indexes/schema → repeat. That tight loop *is* "designing for the queries you'll run" in practice.

---

*Concepts 1.9–1.14 — Pass B core notes complete. Next: 1.15–1.19 (surrogate-key generation, temporal/bitemporal, append-only vs mutable history, anti-patterns, fintech money-model capstone).*
