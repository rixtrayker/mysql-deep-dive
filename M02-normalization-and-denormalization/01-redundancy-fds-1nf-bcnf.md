# M02 · Pass B — Concepts 2.1–2.8 · Redundancy, Anomalies, FDs, Keys, 1NF→BCNF

> **Pass B scope:** content-contract items **#1 Mental model · #2 How it works · #3 Why it exists · #4 Tradeoffs · #5 Generics · #6 MySQL reality.** Items #7–#12 (code-specifics, worked example, failure modes, fintech lens, interview angle, diagrams) come in Passes C/D.
>
> Running domain: payments/wallet. Teaching vehicle for the ladder: a deliberately-messy `payment_record` table.

---

## 2.1 · Why normalize? The cost of redundancy

**Mental model.** Redundancy isn't just wasted space — it's **data that can disagree with itself**. If the same fact (a customer's address, a currency's name) is stored in five places, nothing stops four of them from being updated and one from being missed, and now your database holds two contradictory truths with no way to know which is right. Normalization's real product isn't compactness; it's **removing the *possibility* of contradiction** by storing each fact exactly once.

**How it actually works.** You identify facts that are duplicated across rows and **decompose** the table — split it into multiple tables connected by keys — so each fact lives in exactly one place and is *referenced* (via a foreign key) everywhere else instead of *copied*. "Customer address on every transaction row" becomes "address stored once on the customer row; transactions reference the customer." The duplication is replaced by a join. Normalization is a *lossless* decomposition: you can always reconstruct the original wide table by joining the pieces back, but you've eliminated the redundant copies.

**Why it exists / what it solves.** Redundancy causes three concrete failures (the update anomalies, 2.2) plus silent drift over time. The deeper purpose is **a single source of truth per fact**: when there's exactly one place a fact lives, "update the fact" is one write that can't be partially applied, and the database literally cannot represent a contradiction. This is the structural foundation under the *money-never-lies* thread — a normalized financial schema can't hold two rows that disagree about the same money fact.

**Tradeoffs & alternatives.** Normalization trades **read convenience for write integrity**: the wide redundant table answers some queries with no joins, while the normalized version needs joins to reassemble. It also adds tables and FKs (more schema to understand). The deliberate counter-move is *denormalization* (2.12) — reintroducing controlled redundancy for read speed, but only with an owned mechanism to keep copies in sync. The skill is knowing redundancy is the default enemy and denormalization the deliberate, accounted-for exception.

**Generics / first-principles.** "Don't store the same fact twice; store it once and reference it." This is **DRY for data**, the single-source-of-truth principle, the normalize-then-cache pattern. It's vendor-neutral and even storage-neutral — it governs config files, document schemas, and API payloads as much as SQL tables. Every copy you make is a consistency obligation you take on.

**MySQL-specific reality.** MySQL doesn't enforce normalization — it's a *design* discipline, not a feature; the engine will happily store a fully-redundant single table. MySQL's tools for the *normalized* result are foreign keys (M01/1.5, InnoDB only) and joins; the cost it imposes is join performance, which is exactly why MySQL practitioners care so much about indexing (M05) and sometimes denormalize (2.12). A MySQL-specific nuance: because InnoDB clusters on the PK and joins chase secondary indexes back to the clustered index, a well-normalized schema with good indexes usually joins efficiently — the "joins are slow, so denormalize everything" instinct is often premature on a properly-indexed InnoDB schema.

---

## 2.2 · The three update anomalies

**Mental model.** Redundancy breaks your *writes* in exactly three named ways. An **insert anomaly**: you can't record fact A without also having fact B (you can't add a new account type until some account uses it). An **update anomaly**: changing one fact requires updating many rows, and missing one creates a contradiction (renaming a currency in 4 of 5 rows). A **delete anomaly**: removing one fact accidentally destroys another (deleting the last transaction for an account erases the only record that the account exists). These three are the *symptoms* that normalization cures.

**How it actually works.** All three arise from one root cause: **a table mixing facts about different things** (storing account facts and currency facts and customer facts in one row). Because the facts are entangled:
- *Insert* — to add one entity you're forced to supply (or invent) unrelated attributes, or you simply can't insert it at all until a "host" row exists.
- *Update* — a fact stored in N rows must be changed in all N atomically; any partial update yields disagreement.
- *Delete* — removing the last row that happened to carry an independent fact deletes that fact with it.
Decomposing so each table is about *one* kind of thing (each non-key attribute depends on the key, the whole key, and nothing but the key — 2.6/2.7) dissolves all three.

**Why it exists / what it solves.** The anomalies are *why* normalization matters in operational terms — they're not abstract; they're the bugs and data-corruption incidents redundancy produces. Naming them gives you a diagnostic vocabulary: when you see a schema, you can predict which anomaly it will suffer and which normal form fixes it.

**Tradeoffs & alternatives.** There's no upside to keeping the anomalies — but the "fix" (decomposition) costs joins (2.1) and, occasionally, you *accept* a controlled version of the update anomaly on purpose: a denormalized copy (2.12) is literally "the same fact in two places," so you've reintroduced the update anomaly's *shape* and must now own the sync (2.15). The difference is that denormalization is deliberate and mechanized; an accidental anomaly is a latent bug.

**Generics / first-principles.** "Entangling independent facts in one structure makes every write a chance to corrupt." This generalizes to any data model — a JSON document that embeds a copy of a shared sub-object has update anomalies too; a cache without invalidation has the update anomaly by another name. The three-anomaly lens is a portable code-smell detector for *any* redundant data, not just SQL.

**MySQL-specific reality.** MySQL gives you no automatic protection from anomalies — a denormalized table with all three is perfectly valid DDL. The partial-update anomaly is especially dangerous under concurrency (M07/M08): two sessions each updating "some of the copies" can interleave into a state no single session intended. MySQL features that *mitigate* (not prevent) anomalies in denormalized designs: transactions (update all copies atomically, M07), triggers (propagate a change to copies — with caveats, 2.15), and generated columns (derive instead of copy, so there's nothing to get out of sync — M03). The clean fix remains decomposition; these only make controlled redundancy survivable.

---

## 2.3 · Functional dependencies (FDs)

**Mental model.** A functional dependency **X → Y** says "if you know X, then Y is completely determined." `account_id → currency` means: given an account, its currency is fixed — there's no account that's both USD and EUR. FDs are the **facts about your facts** — the structural truths of your domain — and *all* of normalization is just the mechanical consequence of taking your FDs seriously. Normal forms are theorems about FDs; you don't memorize them so much as *derive* them once you can read the dependencies.

**How it actually works.** An FD X → Y holds when every pair of rows agreeing on X also agrees on Y. X is the **determinant**. FDs have a small algebra (Armstrong's axioms): reflexivity, augmentation, transitivity — from a set of FDs you can compute *implied* FDs and, crucially, the **closure** X⁺ (everything X determines), which is how you find candidate keys (2.4). Normalization is then: "for each FD, is its determinant a key? If not, that FD is a source of redundancy — decompose to fix it." 2NF, 3NF, and BCNF are each just "no FD of *this specific bad shape* may exist."

**Why it exists / what it solves.** FDs are the **formal bridge between your domain's real-world rules and the schema's structure.** Without them, normalization is hand-wavy ("this feels redundant"); with them, it's mechanical and defensible. They let you *prove* a schema is in a normal form rather than guess, and they make the source of every anomaly explicit: an anomaly exists exactly because some attribute depends on something that isn't a key.

**Tradeoffs & alternatives.** FDs capture *single-valued* determination only; they can't express multivalued facts (one account → many signatories) — that needs multivalued dependencies (2.9). Identifying the *true* FDs requires real domain knowledge: the costly mistake is assuming an FD that doesn't actually hold (e.g., "ZIP → city," which has exceptions) and normalizing around a false rule. FDs are a model of the domain; a wrong model gives a wrong (if "correctly normalized") schema.

**Generics / first-principles.** "Structure follows dependency." The idea that the *shape* of your data should be derived from *what determines what* is universal — it underlies normalization, but also dataflow analysis, spreadsheet dependency graphs, build systems, and reactive UIs. "X determines Y, so Y should live with X" is a pattern far beyond databases.

**MySQL-specific reality.** MySQL has no FD declaration syntax — you can't tell the engine "account_id → currency" directly; you *encode* FDs structurally (put `currency` in the `account` table keyed by `account_id`, not on every transaction) and enforce the ones you can with keys/UNIQUE/FK/CHECK (M01). One concrete MySQL connection: the SQL standard and MySQL's `ONLY_FULL_GROUP_BY` mode are literally about FDs — a column in the SELECT must be functionally determined by the GROUP BY columns, and MySQL 8 actually reasons about FDs to decide whether a non-aggregated column is allowed. So FDs aren't purely theoretical in MySQL; the optimizer and `GROUP BY` checker use them.

---

## 2.4 · Keys, revisited through FDs

**Mental model.** Now that you have FDs, a **key falls out for free**: a candidate key is just **an attribute set whose closure is the entire relation** — a set that functionally determines *every* other attribute. Normalization re-derives keys from dependencies rather than assuming them. This reframing is powerful: "is this a key?" becomes a computation (compute the closure, see if it covers everything), and "which attributes are problematic?" becomes "which non-key attributes are determined by something that isn't a key?"

**How it actually works.** Given the FDs, compute the **closure** of a candidate attribute set X (X⁺ = all attributes X determines, via repeatedly applying FDs). If X⁺ = all attributes, X is a **superkey**; if no proper subset of X is also a superkey, X is a **candidate key** (minimal — M01/1.3, now derived rather than asserted). **Prime attributes** are those appearing in *some* candidate key; **non-prime** attributes are the rest. This prime/non-prime distinction is exactly what 2NF and 3NF are stated in terms of. So the FD → closure → candidate-key pipeline is the machinery the whole normal-form ladder runs on.

**Why it exists / what it solves.** It makes key-finding **rigorous and discoverable** instead of intuitive. On a wide "everything" table you may not *know* the key; deriving it from FDs reveals it (and reveals when there are multiple, overlapping candidate keys — the situation BCNF cares about, 2.8). It also gives precise language for normal forms: 2NF/3NF/BCNF are all rules about how non-key (or prime/non-prime) attributes may depend on keys.

**Tradeoffs & alternatives.** This is theory you rarely execute by hand in day-to-day work (most schemas' keys are obvious) — but it's exactly the skill tested in interviews and exactly what you need when *untangling a legacy mess* where the "key" isn't clear. The alternative (eyeballing keys) works for simple tables and fails on the wide, ambiguous tables where it matters most.

**Generics / first-principles.** "Identity is whatever determines everything else." A key is the minimal information from which the whole record is reconstructible — the same idea as a primary identifier in any model, or the minimal seed of a deterministic computation. Closure (what you can reach from a starting set by following rules) is a fully general concept — graph reachability, type inference, transitive closure all share it.

**MySQL-specific reality.** MySQL doesn't compute candidate keys for you — you declare PRIMARY KEY / UNIQUE based on the keys *you* derived. But the consequences are very physical (M01/1.3): the PK you choose becomes the clustered index, and InnoDB embeds it in every secondary index, so picking the *right minimal* candidate key (and not a bloated superkey) has real storage/performance impact. When a table has multiple overlapping candidate keys (2.8's BCNF scenario), MySQL lets you enforce them all (one PK + several UNIQUE), which is how you keep BCNF's guarantees even though MySQL has no notion of "normal form."

---

## 2.5 · First Normal Form (1NF): atomic values

**Mental model.** 1NF is the **price of admission to the relational model**: one value per cell, no repeating groups, no hidden lists. A cell holding `"USD,EUR,GBP"` or columns named `phone1, phone2, phone3` means you're smuggling a *collection* into a place meant for a single value — and the relational operators (filter, join, index) can't see inside it. 1NF says: make every cell atomic, turn collections into rows.

**How it actually works.** Two violations and their fixes:
1. **Multi-valued cell** (a CSV list in one column) → move each value to its own **row in a child table** (the multi-valued attribute → child table rule from M01/1.10). `customer.phone_numbers = "555-1,555-2"` becomes a `customer_phone` table, one row per number.
2. **Repeating groups** (`item1, item2, item3` columns, or `line1_amount, line2_amount`) → same fix: one row per repetition in a child table, keyed by the parent + a discriminator (often a weak entity, M01/1.13).
"Atomic" is judged *relative to how you query*: a full name is atomic if you never need its parts, but composite if you filter/sort by last name — atomicity is about whether the database needs to see inside the value, not about some absolute indivisibility.

**Why it exists / what it solves.** Non-atomic values break everything the relational model offers: you can't index individual elements (a CSV column can't answer `WHERE id = 456` with an index — leading-wildcard `LIKE` at best, M05), can't join on them, can't constrain them (no FK on a list), can't aggregate cleanly, and can't enforce uniqueness per element. 1NF restores all of that. It's also the precondition for *any* higher normal form — 2NF/3NF presuppose 1NF.

**Tradeoffs & alternatives.** 1NF replaces one wide row with a parent + child rows and a join — more tables, more rows. The modern, *sanctioned* exception is a **JSON column** (M03) for genuinely document-shaped, queried-as-a-whole data — that's a deliberate, indexable (via generated columns) escape from 1NF, not a CSV-in-a-column anti-pattern (M01/1.18). The line: structured data you query *into* must be 1NF (rows); opaque blobs you query *as a unit* may be JSON.

**Generics / first-principles.** "Make the structure visible to the tool that must operate on it." A collection hidden in a string is invisible to the query engine, just as data hidden in an opaque blob is invisible to a type system. The general rule: if something needs to be searched, joined, or constrained, it must be a first-class element, not buried inside an opaque value.

**MySQL-specific reality.** MySQL has no automatic 1NF enforcement — a `VARCHAR` holding a CSV is legal and common (and an anti-pattern, M01/1.18). MySQL's relevant tools: child tables + FKs for the proper fix; the **JSON type** (since 5.7) + **generated columns** + functional indexes (8.0) as the controlled exception for document data; and `FIND_IN_SET`/string functions which *can* query a CSV column but only via full scans (no index) — their existence tempts the anti-pattern. The MySQL-savvy stance: never store a queried list as a delimited string; use rows, or use JSON with indexed generated columns if it's truly document-shaped.

---

## 2.6 · Second Normal Form (2NF): no partial dependencies

**Mental model.** 2NF only has teeth when the key is **composite** (more than one column). It says: every non-key attribute must depend on the **whole** key, not just **part** of it. If a column is determined by only *half* the composite key, it's in the wrong table — it belongs with the part that determines it. The classic tell: a junction/line table that's carrying an attribute of just one of its parents.

**How it actually works.** Precondition: 1NF, and a composite candidate key. A **partial dependency** is an FD where a *non-prime* attribute depends on a *proper subset* of a candidate key. Fix by decomposition: pull the partially-dependent attribute (and the part of the key it depends on) out into its own table. Example: a `ledger_entry(transaction_id, line_no, …)` weak-entity row that also stores `account_currency` — but `account_currency` depends on `account_id` (hence on the account), not on `(transaction_id, line_no)`. It's a partial dependency; `account_currency` belongs in the `account` table, referenced by FK, not copied onto every line.

**Why it exists / what it solves.** Partial dependencies are a redundancy source with the full anomaly set (2.2): the half-key-dependent fact repeats across every row sharing that key-part, so updating it means touching many rows (update anomaly), etc. 2NF removes that specific redundancy. It's the first "interesting" normal form — 1NF is structural hygiene, 2NF is the first to actually relocate facts based on dependencies.

**Tradeoffs & alternatives.** Same general tradeoff (a join replaces a copy). 2NF is rarely the *stopping* point — it's a step toward 3NF/BCNF, and in practice 2NF violations are often caught at the same time as 3NF ones. It matters most on tables with **composite keys** (junction tables, weak entities, line-item tables) — exactly the fintech shapes (transaction lines), which is why it's worth its own concept here rather than glossing it.

**Generics / first-principles.** "A fact should live with *exactly* what determines it — no more, no less." Storing an attribute against a key larger than its true determinant is over-coupling; the fix is to find the *minimal* determinant and house the fact there. This "attach data at the right granularity" idea recurs in caching keys, memoization, and partitioning.

**MySQL-specific reality.** Nothing MySQL-specific *enforces* 2NF, but composite-key tables are common in MySQL precisely because of weak entities and junctions (M01/1.12–1.13) whose PKs are composite — so 2NF violations cluster exactly where InnoDB's composite clustered keys live. The practical MySQL upside of fixing them: removing a partially-dependent column from a high-volume line table shrinks the clustered row (less I/O, more rows per page, M09) and removes it from every secondary index that included it. So 2NF normalization often directly improves InnoDB storage efficiency on your hottest tables.

---

## 2.7 · Third Normal Form (3NF): no transitive dependencies

**Mental model.** 3NF closes the next leak: a non-key attribute must depend on the key **directly**, not **through another non-key attribute**. If key → A and A → B, then B depends on the key only *transitively* (via A), and B is in the wrong place — it belongs with A in A's own table. The tell: a table carrying a "lookup" attribute that's really determined by another non-key column it also carries.

**How it actually works.** Precondition: 2NF. A **transitive dependency** is key → A → B where A is non-prime and B is non-prime (B doesn't depend on the key directly). Fix: move {A, B} to their own table keyed by A, and keep A as a FK in the original. Example: `account(account_id, bank_code, bank_name, …)` — `account_id → bank_code` (fine, account determines its bank) but also `bank_code → bank_name` (the bank's name is determined by the bank, not the account). So `bank_name` depends on `account_id` only *through* `bank_code` — transitive. Decompose: a `bank(bank_code, bank_name)` table; `account` keeps `bank_code` as a FK. Now a bank rename is one row, not one-per-account.

**Why it exists / what it solves.** Transitive dependencies cause the update anomaly at scale: a fact about a *referenced* entity (the bank's name) is copied onto every row of the *referencing* entity (every account at that bank). 3NF relocates such facts to the entity they actually describe. **3NF is the practical target** for most OLTP schemas (2.11) — it removes essentially all redundancy you encounter day-to-day while keeping the schema intuitive.

**Tradeoffs & alternatives.** The familiar join-for-copy trade, plus a judgment call: sometimes a transitively-dependent attribute is *intentionally* denormalized (2.12) — e.g., storing `currency_name` alongside `currency_code` to avoid a tiny lookup join on a hot read path. That's fine *if deliberate and sync-managed*; 3NF tells you it's a copy so you know you've taken on the obligation. The danger is a transitive dependency you didn't *notice* — an accidental copy with no sync plan.

**Generics / first-principles.** "Attributes belong to the entity they describe, reached directly — not parked on a neighbor that happens to reference that entity." This is normalization's clearest expression of *cohesion*: each table is about one thing, and facts about *other* things live with those things. The transitive-dependency smell ("why does the account row know the bank's name?") is a portable design instinct.

**MySQL-specific reality.** 3NF in MySQL is the sweet spot where well-indexed InnoDB joins are cheap enough that the integrity win clearly beats the join cost. The MySQL-specific tension shows up on read-hot paths: the optimizer must do a join to fetch the looked-up attribute, and *if* that join is genuinely hot and measured-slow, **covering indexes** (M05) often eliminate the cost without denormalizing — fetch `bank_name` from an index without touching the row. So in MySQL, "should I denormalize this 3NF lookup?" is usually answered by "first try a covering index; denormalize only if that's still not enough" (validated via EXPLAIN, M06).

---

## 2.8 · Boyce-Codd Normal Form (BCNF): every determinant is a key

**Mental model.** BCNF is 3NF with the loophole closed: **every determinant must be a candidate key.** 3NF allows a sneaky case — an attribute that's part of *some* candidate key can be determined by a non-key — and BCNF forbids it. The one-line test is beautifully simple: for *every* FD X → Y in the table, X must be a superkey. If any FD has a left side that isn't a key, the table isn't in BCNF. BCNF is "3NF, but we really mean it."

**How it actually works.** The difference between 3NF and BCNF only appears when a table has **multiple overlapping candidate keys** (candidate keys that share attributes). 3NF's definition has an exception clause that permits a dependency on a *prime* attribute; BCNF removes that exception. Classic shape: a relation with candidate keys (A, B) and (A, C) where C → B holds — C is a determinant but not a candidate key, so it violates BCNF even though the table can be in 3NF. Fix: decompose so that C → B lives in its own table where C *is* the key. The cost: decomposing for BCNF can occasionally lose the ability to enforce some FD with a simple key (a "non-dependency-preserving" decomposition) — the rare case where you might *stay* at 3NF deliberately.

**Why it exists / what it solves.** It eliminates the last FD-based redundancy that 3NF can miss. In practice BCNF violations are uncommon (they need overlapping candidate keys, which most schemas don't have), but when they occur they cause genuine update anomalies that 3NF "passed." BCNF is the clean, memorable rule — *every determinant is a key* — that's easier to apply than 3NF's exception-laden definition, which is why many practitioners just aim for BCNF directly.

**Tradeoffs & alternatives.** BCNF vs 3NF is a real (if rare) tradeoff: BCNF guarantees no FD redundancy but its decomposition isn't always **dependency-preserving** (you might not be able to check a constraint without a join); 3NF is always dependency-preserving but can retain a sliver of redundancy. The standard guidance: aim for BCNF; fall back to 3NF only in the specific case where BCNF would cost you cheap enforcement of an important FD.

**Generics / first-principles.** "Anything that determines other data is an identity — treat it as one." BCNF's rule is conceptually clean: if X determines stuff, X *is* a key for that stuff, so put X's dependents in a table where X is the key. This "promote every determinant to a key in its own table" is the logical endpoint of "structure follows dependency" (2.3).

**MySQL-specific reality.** MySQL has no concept of normal forms, so BCNF is purely a design outcome — but MySQL *does* let you enforce overlapping candidate keys (one PRIMARY KEY plus multiple UNIQUE constraints), which is how you preserve BCNF's guarantees physically. The dependency-preservation tradeoff has a concrete MySQL flavor: if a BCNF decomposition makes an FD only checkable via a join, you may need an application-level or trigger-based check (or a multi-column UNIQUE that approximates it) to enforce it — a reason a pragmatic MySQL schema occasionally stops at 3NF for a specific table. As always in this module: normalize to BCNF by default, denormalize/relax only with eyes open.

---

*Concepts 2.1–2.8 — Pass B core notes complete. Next: 2.9–2.11 (4NF/5NF, the full ladder end-to-end, and "3NF is usually enough").*
