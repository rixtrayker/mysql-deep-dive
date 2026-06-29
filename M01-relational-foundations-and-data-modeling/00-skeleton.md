# M01 · Relational Foundations & Data Modeling — Pass A (Skeleton)

> **Pass A goal:** lock the ordered concept list, a one-line mental model for each concept, and the planned diagram + worked example per concept. No prose yet — that's Pass B.
>
> **Module mental model:** *A data model is a set of promises about the shape of your data. The relational model is the discipline that lets the database keep those promises for you — instead of every application re-implementing them and getting them subtly wrong.*
>
> **Threads carried in this module:** Generics-first (the relational model is vendor-agnostic theory; MySQL is one implementation) · Money-never-lies (a wrong data model is the *root* cause of most money bugs — they're designed in before a single query runs).

---

## Concept list (ordered)

| # | Concept | One-line mental model | Diagram | Worked example |
|---|---------|----------------------|---------|----------------|
| 1.1 | **The relational model** | Data as mathematical *relations* (sets of tuples), not files or pointers — the DB reasons about sets, you stop walking pointers. | Concept map: relation → tuple → attribute → domain | Show one "accounts" relation as a set of rows; contrast with a linked-list/file mental picture |
| 1.2 | **Relations vs tables (theory vs SQL)** | A relation is an unordered *set* with no duplicates; a SQL table is a *bag* with order and duplicates allowed — the gap is where bugs hide. | Side-by-side: pure relation vs real SQL table | Duplicate-row anomaly that "can't happen" in theory but does in SQL without a key |
| 1.3 | **Keys: candidate, primary, alternate** | A key is a *promise of uniqueness*; the primary key is the promise you build the table around. | Venn/flow: superkey → candidate key → primary key | Pick a PK for `accounts`: account_id vs (bank_code,number) |
| 1.4 | **Natural vs surrogate keys** | Natural = a real-world identifier you trust; surrogate = an internal ID you mint so the real world can't break your key. | Decision tree: natural vs surrogate | IBAN as natural key vs internal `account_id` surrogate — what happens when an IBAN is reassigned |
| 1.5 | **Foreign keys & referential integrity** | A foreign key is a *pointer the database refuses to let dangle* — it enforces "this child must have a real parent." | ER fragment: `ledger_entry → account` with FK | Orphaned ledger entry (entry pointing at a deleted account) and how the FK blocks it |
| 1.6 | **Referential actions (CASCADE / RESTRICT / SET NULL)** | What the DB does to children when a parent moves or dies — your declared cleanup policy. | Matrix: action × ON DELETE / ON UPDATE | Why a ledger should `RESTRICT`, never `CASCADE`, on account delete ★ money-never-lies |
| 1.7 | **NULL and three-valued logic** | NULL means "unknown," not "zero" or "empty" — and unknown poisons comparisons (TRUE/FALSE/UNKNOWN). | Truth table: AND/OR/NOT with UNKNOWN | A `WHERE balance <> 0` query silently dropping NULL-balance rows |
| 1.8 | **Domains, constraints & the closed-world assumption** | The schema is a *fence*: anything it doesn't permit shouldn't exist; constraints are the fence posts (CHECK, UNIQUE, NOT NULL). | Flow: value → domain → constraint → accept/reject | A CHECK constraint forbidding negative `amount` on a credit-only column |
| 1.9 | **Conceptual → logical → physical modeling** | Three altitudes: *what exists* (entities) → *how it's structured* (tables/keys) → *how it's stored* (types/indexes/engine). | 3-layer pipeline diagram | The same "customer holds accounts" idea at all three altitudes |
| 1.10 | **Entities, attributes & relationships (ER modeling)** | The vocabulary of modeling: nouns (entities), their properties (attributes), and the verbs that connect them (relationships). | ER diagram primer (crow's-foot legend) | Sketch `Customer`, `Account`, `Transaction` as entities + relationships |
| 1.11 | **Cardinality & optionality** | *How many* on each side (1:1, 1:N, M:N) and *whether zero is allowed* — the math that decides where keys go. | Crow's-foot cardinality cheat sheet | "A customer has ≥1 account; an account has exactly 1 owner" — read it off the diagram |
| 1.12 | **Associative (junction) tables & M:N** | Many-to-many can't be drawn directly — you *manufacture* an entity in the middle to hold the pairing. | ER: `account ↔ account_holder ↔ customer` | Joint accounts: two customers, one account, modeled via a junction table |
| 1.13 | **Weak entities & identifying relationships** | Some rows can't exist or be identified without their parent — their key *borrows* the parent's key. | ER: strong vs weak entity notation | A `ledger_entry` line that only makes sense inside its parent `transaction` |
| 1.14 | **Designing for the queries you'll run** | A model isn't "correct" in a vacuum — it's correct *for an access pattern*; model the reads/writes, not just the nouns. | Access-pattern → model flow | Same domain modeled two ways for "balance lookup" vs "statement history" |
| 1.15 | **Surrogate-key generation strategies** | *How* you mint an internal ID has real consequences — monotonic vs random keys trade index locality against hotspots and guessability. | Comparison matrix: auto-inc / UUIDv4 / UUIDv7 / ULID / Snowflake | Why sequential `account_id` makes a hot last-page insert point, and what random keys cost in B-tree fragmentation (forward-refs M05/M09) |
| 1.16 | **Temporal & bitemporal modeling** | Real systems need *history*, not just current state — track when a fact was true (valid time) and when we recorded it (transaction time). | Timeline: valid-time vs transaction-time axes | An FX rate that "was 1.10 last Tuesday" but was *corrected* yesterday — bitemporal captures both truths |
| 1.17 | **Modeling history: append-only vs mutable state** | You can store the *current balance* (mutable) or the *stream of events that produced it* (append-only) — and the choice defines your audit story. | Flow: event log → projected state | Wallet balance as a mutable column vs as a fold over an immutable entry log (seeds event-sourcing in M16) |
| 1.18 | **Data-modeling anti-patterns** | The shapes that look flexible but rot: EAV, the god-table, comma-lists-in-a-column, polymorphic FKs — flexibility you pay for forever. ★ | Catalog: anti-pattern → why it hurts → fix | A "transactions" god-table with 80 nullable columns vs a properly typed split; EAV "custom fields" killing query plans |
| 1.19 | **Fintech capstone: modeling a money system** | Accounts, parties, and a *ledger of immutable entries* — the canonical shapes every payments system converges on. ★ | ER: full mini money-model (party / account / transaction / entry) | End-to-end: model a wallet with double-entry-ready structure (sets up M16) |

---

## Diagram inventory for M01 (Pass C targets)

- **Notation standard:** all ER diagrams use **crow's-foot** notation (Mermaid-native; best interview/industry transfer).
- **Standard (ER / crow's-foot / matrices / truth tables / timelines):** 1.1–1.17.
- **★ Bespoke / capstone visuals:** 1.18 (anti-pattern catalog), 1.19 (the full mini money-model ER, drawn once and reused in M16).

## Worked-example domain

✅ **Decided:** all modules use a single running **payments/wallet domain** (customers/parties, accounts, transactions, immutable ledger entries). Examples compound across modules into the M16 fintech capstone.

## Prerequisites & sequencing

- **Prereqs:** none (this is the entry module).
- **Leads into:** M02 (Normalization) refines *these* tables into normal forms; M03 (Data Types) makes the attributes physical. Forward-references planted here: 1.15 surrogate keys → M05 (index locality) / M09 (B-tree fragmentation); 1.16–1.17 history/temporal → M16 (audit trails, event sourcing); 1.18 anti-patterns → M06 (query plans); 1.19 money-model → M16 capstone.

## Decisions locked (Pass A Q&A)

1. ✅ **Running domain:** single payments/wallet domain across all modules — examples compound.
2. ✅ **ER notation:** crow's-foot for every ER diagram.
3. ✅ **Granularity:** go deeper — added 1.15 (surrogate-key generation), 1.16 (temporal/bitemporal), 1.17 (append-only vs mutable history), 1.18 (anti-patterns). M01 is now **19 concepts**.

## Pass A status: ✅ drafted — awaiting your sign-off before Pass B (core notes).
