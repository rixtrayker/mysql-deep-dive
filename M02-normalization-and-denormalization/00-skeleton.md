# M02 · Normalization & Denormalization — Pass A (Skeleton)

> **Pass A goal:** lock the ordered concept list, a one-line mental model per concept, and the planned diagram + worked example per concept. No prose yet — that's Pass B.
>
> **Module mental model:** *Normalization is the discipline of storing each fact exactly once, so the database can't contradict itself. Denormalization is the deliberate, accounted-for decision to break that rule for speed — keeping a copy you promise to keep in sync. One protects truth; the other buys performance. A staff engineer knows both, and knows exactly which they're doing and why.*
>
> **Threads carried in this module:**
> - **Generics-first** — normal forms are vendor-neutral consequences of functional dependencies; they apply to any relational store.
> - **Tradeoff** — this is *the* module where the normalize-vs-denormalize tradeoff is named explicitly; nothing here is free.
> - **Money-never-lies** — an update anomaly in a financial schema is a row that disagrees with another row about money. Normalization is how you make that impossible; controlled denormalization (the derived balance) is how you stay fast *without* letting the copy lie.
>
> **Prereqs:** M01 (keys, FKs, functional thinking about attributes). **Leads into:** M03 (types make the normalized columns physical), M05/M06 (denormalization decisions are validated against query plans), M16 (the ledger-normalized / balance-denormalized split is the canonical fintech instance).

---

## Concept list (ordered)

| # | Concept | One-line mental model | Diagram | Worked example |
|---|---------|----------------------|---------|----------------|
| 2.1 | **Why normalize? The cost of redundancy** | Redundant data is data that can disagree with itself; normalization removes the *possibility* of contradiction, not just the contradiction. | Before/after: one redundant table → split tables | A customer's address stored on every transaction row, then changed in only some |
| 2.2 | **The three update anomalies** | Redundancy breaks writes in exactly three ways — insert, update, delete anomalies — each a way the schema forces or loses a fact wrongly. | Triptych: insert / update / delete anomaly | Can't add an account type until someone uses it (insert); rename a currency in 4 of 5 rows (update); delete last transaction loses the account (delete) |
| 2.3 | **Functional dependencies (FDs)** | "X determines Y": given X, Y is fixed. FDs are the *facts about your facts* — the entire theory of normalization is built on them. | FD arrows over an attribute set | account_id → currency, customer_id; (txn_id, line_no) → amount |
| 2.4 | **Keys, revisited through FDs** | A key is just an attribute set that functionally determines *every* other attribute — normalization re-derives keys from dependencies. | FD closure → candidate key | Derive the candidate key of a wide "everything" table from its FDs |
| 2.5 | **First Normal Form (1NF): atomic values** | One value per cell, no repeating groups, no hidden lists — the precondition for the relational model to even apply. | Repeating-group table → 1NF child table | A `phone_numbers` CSV column / `item1,item2,item3` columns → rows |
| 2.6 | **Second Normal Form (2NF): no partial dependencies** | On a composite key, every non-key attribute must depend on the *whole* key, not just part of it. | Composite-key table with a partial-dep attribute pulled out | A junction row carrying the account's currency (depends on account_id alone, not the pair) |
| 2.7 | **Third Normal Form (3NF): no transitive dependencies** | Non-key attributes must depend on the key directly, not through another non-key attribute. | Transitive chain key → A → B, B pulled to its own table | `account` carrying `bank_name` because it carries `bank_code` (bank_code → bank_name) |
| 2.8 | **Boyce-Codd Normal Form (BCNF): every determinant is a key** | The strict form of 3NF — *every* left side of an FD must be a candidate key; closes 3NF's loophole with overlapping candidate keys. | 3NF-but-not-BCNF table → decomposition | A table with two overlapping candidate keys where a non-key determines part of a key |
| 2.9 | **Higher normal forms (4NF, 5NF): multivalued & join dependencies** | When a single row independently relates one thing to *two* others, you get spurious combinations — 4NF/5NF remove them. | MVD fan-out → two clean tables | An account independently linked to several currencies *and* several signatories in one table |
| 2.10 | **The normalization ladder, end to end** | 1NF→2NF→3NF→BCNF→4NF→5NF is one continuous process: each step removes a more subtle kind of redundant dependency. | Ladder diagram with the rule each rung enforces | Take a deliberately-messy `payment_record` table all the way up the ladder ★ |
| 2.11 | **"3NF is usually enough" — the practical target** | Most OLTP schemas aim for 3NF/BCNF; beyond that is rare and situational. Knowing where to *stop* is part of the skill. | Decision note: how far to normalize | Why a payments OLTP core targets 3NF/BCNF and stops |
| 2.12 | **Denormalization: the deliberate reversal** | Intentionally storing a fact more than once to make reads fast — a *cache inside your schema* that you now own the consistency of. | Normalized → denormalized with a "sync obligation" tag | Storing `account.balance` instead of always `SUM`-ing entries |
| 2.13 | **Read vs write tradeoffs** | Normalization optimizes writes & integrity; denormalization optimizes reads & latency — you're choosing which side pays. | Seesaw: read cost ↔ write cost / integrity risk | Statement screen needs balance in O(1) (read win) vs every entry now does extra writes |
| 2.14 | **Derived & materialized data** | Some columns/tables are *computed* from others — balances, counts, rollups; they're denormalization with a clear source of truth and a rebuild path. | Source-of-truth → derived projection flow | Daily `settlement_totals` rollup derived from `ledger_entry` |
| 2.15 | **Keeping copies consistent: the sync problem** | Every denormalized copy needs a maintenance mechanism — same-transaction update, trigger, async job, or CDC — each with a different staleness/coupling cost. | Matrix: sync mechanism × freshness × risk | Four ways to keep `account.balance` in sync, and what each costs ★ |
| 2.16 | **Normalization vs denormalization in distributed/scaled systems** | At scale the calculus shifts: joins across shards are expensive/impossible, so denormalization stops being optional — but the integrity bill comes due elsewhere. | Single-node joins vs cross-shard denormalized reads | Why sharding (M11) forces denormalized read models and how the ledger stays correct anyway |
| 2.17 | **Fintech capstone: the normalized ledger + denormalized balance** | The canonical fintech shape — an immutable, fully-normalized ledger as source of truth, with denormalized balances/rollups as reconciled caches. ★ | ER + flow: normalized ledger → derived balance/rollups → reconciliation | End-to-end: which parts of the money system are normalized, which are denormalized, and how they're kept honest (sets up M16) |

---

## Diagram inventory for M02 (Pass C targets)

- **Notation standard:** crow's-foot for ER; FD arrows for dependency diagrams; before/after split diagrams for each normal-form step; seesaw/matrix for tradeoffs.
- **Standard:** 2.1–2.9, 2.11–2.16 (before/after splits, FD-arrow diagrams, anomaly triptych, seesaw, sync matrix).
- **★ Bespoke / capstone visuals:** 2.10 (full ladder taking one messy table 1NF→5NF), 2.15 (sync-mechanism matrix), 2.17 (normalized-ledger / denormalized-balance money model with reconciliation — reused in M16).

## Worked-example domain

Single running **payments/wallet** domain (continues M01): `customer`/`party`, `account`, `transaction`, immutable `ledger_entry`, plus derived `account.balance` and rollup tables. The deliberately-messy `payment_record` table in 2.10 is the teaching vehicle for the full ladder.

## "Go deeper" additions (matching M01 house style)

Beyond a basic 1NF→3NF treatment, this skeleton deliberately includes: **BCNF with the overlapping-candidate-key loophole (2.8)**, **4NF/5NF with multivalued/join dependencies (2.9)**, **knowing where to stop (2.11)**, **the sync-mechanism taxonomy (2.15)**, and **the distributed-systems shift where denormalization becomes mandatory (2.16)** — the staff-level material most treatments skip.

## Open questions surfaced during Pass A (not blocking)

1. **Depth of 4NF/5NF (2.9):** full formal treatment (MVDs, join dependencies, 5NF decomposition) vs intuition-level "here's the anomaly, here's the fix"? (Proposing: intuition-first with a formal box — these are rarely hand-applied but high-signal in interviews.)
2. **Group 2.12–2.16 (the denormalization half)** is the module's most opinionated material — want it framed primarily as *decision guidance* (when/how/at-what-cost) rather than taxonomy? (Proposing: yes, decision-first.)
3. **Concept count (17).** Comfortable, or trim (e.g., fold 2.4 keys-via-FDs into 2.3, merge 2.11 into 2.10)?

## Pass A status: ✅ drafted — awaiting your sign-off before Pass B (core notes).
