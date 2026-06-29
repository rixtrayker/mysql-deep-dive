# M02 · Pass B — Concepts 2.9–2.11 · Higher Normal Forms, the Full Ladder, Where to Stop

> Pass B scope: contract items **#1–#6**. Per the Pass-A decision, 4NF/5NF are treated **intuition-first** (the anomaly and its fix) with the formal definitions in a clearly-bounded box. Running domain: payments/wallet.

---

## 2.9 · Higher normal forms (4NF, 5NF): multivalued & join dependencies

**Mental model (intuition-first).** Even a BCNF table can hold a subtle redundancy: when **one row independently relates one thing to *two* different sets of things**, you get a combinatorial explosion of meaningless rows. If an account independently has *several currencies* and *several signatories*, and you jam both into one table, you're forced to store every (currency × signatory) *combination* — even though currency and signatory have nothing to do with each other. 4NF says: when two facts are independent, **don't entangle them in one table** — give each its own table. 5NF handles the even rarer case where a table can only be reconstructed by joining *three or more* pieces back together.

**How it actually works (intuition).** The smell of a 4NF violation: a table whose key is "everything," where you notice you're storing a **cross-product** of two independent multivalued attributes, and adding one value to one attribute forces you to add several rows to keep the cross-product complete. The fix is decomposition into two tables — one per independent relationship — each a clean many-to-many (junction, M01/1.12). 5NF (a.k.a. PJ/NF) is for the pathological case where even pairwise decomposition loses information and you need a three-way (or higher) split to avoid generating *spurious* rows on rejoin; it's genuinely rare in practice.

> **📦 Formal box (for completeness / interviews).**
> - A **multivalued dependency (MVD)** `X ↠ Y` holds when, for a given X, the set of Y values is independent of the other attributes. **4NF**: a table is in 4NF if for every nontrivial MVD `X ↠ Y`, X is a superkey. (BCNF is about FDs; 4NF is the same idea lifted to MVDs.)
> - A **join dependency (JD)** says a relation equals the join of several of its projections. **5NF (PJ/NF)**: every nontrivial join dependency is implied by the candidate keys — i.e., the table can't be losslessly split further without already being splittable along a key. 5NF eliminates redundancy that no binary decomposition can.

**Why it exists / what it solves.** MVDs cause a real redundancy and update anomaly (adding a currency forces inserting it paired with *every* signatory), and BCNF doesn't catch it because it's not an FD. 4NF is the right fix whenever you discover two independent "many" facts sharing a table. 5NF exists for completeness — to guarantee *no* join-based redundancy remains — but you'll almost never hand-derive it.

**Tradeoffs & alternatives.** These forms are **rarely the operational concern** that 1NF–BCNF are — most 4NF violations are caught earlier just by modeling each many-to-many as its own junction table (M01/1.12), which *is* 4NF by construction. So the practical takeaway: if you model independent M:N relationships as separate junction tables from the start, you get 4NF for free and never think about MVDs. The reason to *know* 4NF/5NF is (a) diagnosing a legacy table that mashed two M:N relationships together, and (b) interviews, where naming MVDs is a strong signal.

**Generics / first-principles.** "Independent facts must not share a structure, or you'll be forced to enumerate their cross-product." This is the orthogonality principle: things that vary independently should be represented independently. The combinatorial-explosion smell — "adding one X forces me to add N rows" — is a portable warning that you've coupled independent dimensions.

**MySQL-specific reality.** Nothing in MySQL references 4NF/5NF; they're modeling outcomes. The MySQL-relevant practice is simply: **model each independent many-to-many as its own junction table** (separate `account_currency` and `account_signatory` tables, each with its own composite PK and FKs) rather than one combined table — which gives 4NF automatically and keeps each junction independently indexable (M05). If you ever *see* a combined table in a MySQL schema, the cross-product row count (and the pain of inserting) is the operational signal to split it.

---

## 2.10 · The normalization ladder, end to end ★

**Mental model.** 1NF → 2NF → 3NF → BCNF → 4NF → 5NF isn't six unrelated rules — it's **one continuous process of removing progressively subtler redundant dependencies.** Each rung fixes a more refined version of the same disease (a fact depending on something that isn't a key): 1NF (make cells atomic so dependencies are even definable) → 2NF (no dependence on *part* of a key) → 3NF (no *transitive* dependence) → BCNF (every determinant *is* a key) → 4NF (the same, for *multivalued* facts) → 5NF (no residual *join* redundancy). Climbing the ladder is just repeatedly asking "does every fact depend on the whole key and nothing but a key?" at finer and finer resolution.

**How it actually works.** The ladder is cumulative — each form *includes* all lower ones. The mechanical process on a messy table: (1) eliminate repeating groups/lists → 1NF; (2) find the candidate key(s) via FD closure (2.4); (3) remove partial dependencies → 2NF; (4) remove transitive dependencies → 3NF; (5) check every determinant is a key, decompose the exceptions → BCNF; (6) split entangled independent multivalued facts → 4NF; (7) (rarely) resolve join dependencies → 5NF. Each decomposition is **lossless** (you can rejoin to recover the original) and ideally **dependency-preserving** (you can still enforce every FD without a join) — BCNF is where those two goals can occasionally conflict (2.8).

**Why it exists / what it solves.** Seeing it as one ladder turns normalization from "memorize six definitions" into "apply one principle at increasing resolution," which is both easier to remember and easier to *defend* in a design discussion. It also makes the stopping decision (2.11) legible: you climb until the remaining redundancy is either gone or *deliberately accepted*.

**Tradeoffs & alternatives.** Higher rungs cost more joins and more tables for diminishing redundancy-removal — the marginal benefit drops steeply after 3NF/BCNF (2.11). The ladder is the *integrity-maximizing* direction; denormalization (2.12) is the *deliberate descent* back down a rung for read performance, taken with a sync mechanism (2.15). Knowing the ladder in both directions — how to climb for integrity, how to step down for speed — is the whole module in one image.

**Generics / first-principles.** "One principle, applied at increasing resolution, beats a pile of special-case rules." The ladder is a model for how to *learn and teach* any layered discipline: find the single underlying idea (here, "every fact depends only on keys"), then show each level as a finer application of it. Lossless-and-dependency-preserving decomposition is also a general data-refactoring invariant: never lose information, ideally never lose enforceability.

**MySQL-specific reality.** In MySQL the ladder is a pre-`CREATE TABLE` design activity; the engine sees only the final tables, keys, and FKs. The MySQL-flavored end state: after climbing to 3NF/BCNF you make the *physical* choices (M01/1.9) — clustered PK per table, secondary indexes for the joins the decomposition introduced, FKs (InnoDB) to enforce the relationships the decomposition created. The teaching vehicle (Pass C): take a deliberately-messy `payment_record` table — CSV line items, a partially-dependent currency, a transitive bank name, entangled signatories/currencies — and climb it rung by rung into the clean payments schema, watching each anomaly disappear and each new table/FK appear.

---

## 2.11 · "3NF is usually enough" — the practical target

**Mental model.** Knowing *where to stop* is as much a skill as knowing how to climb. For the vast majority of OLTP schemas the right target is **3NF (or BCNF)** — it removes essentially all the redundancy you'll meet in practice while keeping the schema intuitive and the joins reasonable. Going higher (4NF/5NF) is occasionally necessary and usually automatic if you modeled relationships well; going *lower* (denormalizing) is a deliberate, measured exception (2.12), not a default. The staff move is matching the target to the workload, not maximizing normal-form number for its own sake.

**How it actually works.** The reasoning: 1NF–3NF/BCNF address FD-based redundancy, which is *the* common case; 4NF/5NF address MVD/JD redundancy, which is rare and typically pre-empted by good M:N modeling (2.9). So you normalize to 3NF/BCNF as the baseline, verify there are no entangled independent multivalued facts (which would need 4NF), and stop. Then — and only then — you consider *targeted* denormalization on specific hot read paths where measurement (EXPLAIN, M06; profiling) shows the join cost actually hurts, keeping the normalized form as the source of truth.

**Why it exists / what it solves.** It prevents two opposite mistakes: **under-normalizing** (shipping a redundant schema riddled with anomalies because "joins are slow") and **over-normalizing** (decomposing into so many tables that every query is a six-way join, for redundancy that didn't exist). 3NF/BCNF-as-default + measured exceptions is the calibrated middle that experienced engineers land on.

**Tradeoffs & alternatives.** The whole module is this tradeoff; 2.11 is where it's stated as *guidance*. Alternatives at the extremes: fully denormalized (analytics/OLAP, wide read-optimized tables — different workload, M16 reporting) vs maximally normalized (academic purity, rarely justified operationally). The guidance is workload-dependent: OLTP → 3NF/BCNF + targeted denorm; OLAP/reporting → heavier denormalization (star schemas, rollups) because writes are bulk and reads dominate.

**Generics / first-principles.** "Optimize to the point of diminishing returns, then stop — and make further moves deliberate and measured." Normal-form choice is an instance of right-sizing: don't gold-plate (over-normalize), don't cut corners (under-normalize), and treat exceptions as explicit decisions with owners. "Know where to stop" is a general engineering maturity marker.

**MySQL-specific reality.** MySQL's practical default of 3NF/BCNF is reinforced by InnoDB's efficient indexed joins and covering indexes (M05) — on a well-indexed InnoDB schema, 3NF joins are usually fast enough that denormalization is premature. The MySQL workflow for the stopping decision is concrete: design to 3NF/BCNF → write the hot queries → `EXPLAIN`/measure → add covering indexes first → denormalize a specific path *only* if indexes can't close the gap, and then with an explicit sync mechanism (2.15). This "measure before you denormalize" discipline is what separates a principled MySQL schema from a prematurely-denormalized one that's now carrying consistency risk it didn't need.

---

*Concepts 2.9–2.11 — Pass B core notes complete. Next: 2.12–2.17 (denormalization, read/write tradeoffs, derived/materialized data, the sync problem, the distributed shift, and the fintech ledger+balance capstone).*
