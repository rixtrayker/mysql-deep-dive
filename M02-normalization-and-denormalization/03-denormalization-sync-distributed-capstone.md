# M02 · Pass B — Concepts 2.12–2.17 · Denormalization, Tradeoffs, Derived Data, Sync, Distributed, Fintech Capstone

> Pass B scope: contract items **#1–#6**, framed **decision-first** (per the Pass-A decision): when to do it, how, and at what cost — not just taxonomy. Running domain: payments/wallet. This half is where the module's **Tradeoff** and **money-never-lies** threads do their heaviest work.

---

## 2.12 · Denormalization: the deliberate reversal

**Mental model.** Denormalization is **intentionally storing a fact more than once to make reads fast** — building a *cache inside your schema*. The word "deliberate" is the whole point: you are knowingly re-creating the redundancy that normalization removed (2.1), re-accepting the update-anomaly *shape* (2.2), and signing up to **own the consistency** of every copy. Done with eyes open and a sync mechanism, it's a legitimate performance tool. Done by accident or without a sync plan, it's just data corruption waiting to happen.

**How it actually works (decision-first).** The decision has a clear order:
1. **Start normalized** (3NF/BCNF) — always the default source of truth.
2. **Identify a specific, measured read problem** — a hot query whose joins/aggregations are genuinely too slow (proven via EXPLAIN/profiling, M06), not assumed.
3. **Try cheaper fixes first** — covering indexes (M05) often eliminate a join's cost without copying any data; a summary index; query rewrite.
4. **Only then denormalize that path** — pre-join an attribute, pre-aggregate a value, or duplicate a column — and immediately pair it with a **sync mechanism** (2.15) and ideally a **reconciliation check** (2.14/2.17).
The normalized form remains authoritative; the denormalized copy is *derived and rebuildable* from it.

**Why it exists / what it solves.** Some read patterns are fundamentally expensive in a normalized schema (deep joins, aggregations over large/growing tables) and no index fully fixes them. Denormalization trades write-time work and a consistency obligation for read-time speed. It exists because, past a point, *integrity-optimal* and *read-optimal* schemas genuinely diverge, and real systems have hard read-latency requirements.

**Tradeoffs & alternatives.** The trade is explicit (2.13): faster reads vs slower/more-complex writes plus consistency risk. Alternatives that often beat denormalization: covering/summary indexes, caching layers (outside the DB), materialized/summary tables (2.14, a *structured* form of denormalization with a clear rebuild path), or read replicas (M10). The senior instinct: **denormalize last, not first**, and prefer forms where the copy is *derived* (rebuildable from the source) over forms where it's *independently writable* (which can drift with no recovery).

**Generics / first-principles.** "A cache is a copy you've promised to keep correct." Denormalization is caching with the cache *inside* your database, so it inherits every caching hard problem — invalidation, staleness, and the two-writers race. Phil Karlton's "there are only two hard things: cache invalidation and naming" is literally a statement about denormalization. Every copy is a debt.

**MySQL-specific reality.** MySQL gives you the tools but no safety net: you can add a duplicated column trivially, but nothing keeps it in sync unless you build that (transaction, trigger, app logic, CDC — 2.15). MySQL's **generated columns** (M03) are the *safe* denormalization where applicable — the value is computed from other columns in the same row, so it literally cannot drift (there's no separate copy to update). For cross-row/cross-table denormalization (a balance summed from many entry rows), there's no built-in materialized view in MySQL (unlike Postgres), so you implement summary tables + sync yourself — which is exactly why the sync problem (2.15) gets its own concept.

---

## 2.13 · Read vs write tradeoffs

**Mental model.** Normalization and denormalization sit on opposite ends of a seesaw. **Normalization optimizes writes and integrity**: each fact lives once, so writes are small, atomic, and can't create contradictions — but reads pay with joins/aggregations. **Denormalization optimizes reads and latency**: facts are pre-joined/pre-aggregated so reads are cheap — but writes pay by maintaining every copy, and integrity is now your responsibility. You're not eliminating cost; you're **choosing which side of the seesaw pays.**

**How it actually works (decision-first).** Decide by profiling the *actual* read/write ratio and latency requirements of the specific access pattern:
- **Write-heavy or integrity-critical** (the ledger itself: every transaction is a write, correctness is non-negotiable) → stay normalized; let reads do the work or use derived caches with strong reconciliation.
- **Read-heavy, read-latency-critical** (a balance shown on every screen; a dashboard) → denormalize/derive the read path, accept extra write work to maintain it.
- **Mixed** → keep the authoritative core normalized and build *targeted* denormalized read-models for the hot reads, not a wholesale denormalized schema.
The ratio and the latency SLO, not aesthetics, drive the choice.

**Why it exists / what it solves.** It reframes the whole module as a *resource-allocation* decision rather than a right/wrong one. There is no universally correct point on the seesaw — only the right point *for a given workload*. Naming it as a tradeoff prevents both dogmas ("always normalize," "joins are evil, denormalize everything").

**Tradeoffs & alternatives.** Beyond the binary, you can move the cost *off the primary path* entirely: read replicas (M10) shift read load to other nodes without denormalizing the schema; caching tiers absorb reads outside the DB; CQRS (M16) formalizes "normalized write model + denormalized read model" as separate stores. These let writes stay integrity-optimal while reads get a purpose-built shape — at the cost of more moving parts and eventual-consistency between them.

**Generics / first-principles.** "Every optimization moves cost; it rarely deletes it." Read-vs-write is one instance of the universal space/time, latency/throughput, simplicity/performance tradeoffs. The discipline is to know *which* resource you're spending and *whether that's the scarce one* for this workload. Optimizing the abundant resource at the expense of the scarce one is the classic mistake.

**MySQL-specific reality.** MySQL's architecture gives concrete levers on both ends: for writes, normalized tables keep InnoDB rows small and indexes lean (M09); for reads, covering indexes (M05) often capture much of denormalization's benefit *without* the copy. MySQL's lack of native materialized views means the read-optimized end usually costs you hand-built summary tables + sync, raising the price of leaning "read-optimized" relative to engines that automate it. And read replicas (M10) are the common MySQL way to shed read load before resorting to schema denormalization. The MySQL-savvy ordering: indexes → replicas → targeted denormalization, in that escalation.

---

## 2.14 · Derived & materialized data

**Mental model.** Some data is **computed from other data**, not independently authored — a balance is `SUM(entries)`, a daily total is a rollup of transactions, a count is `COUNT(*)`. Storing such a value is denormalization with an unusually clean property: there's an **unambiguous source of truth and a deterministic rebuild path**. Derived data is the *best-behaved* kind of denormalization because, unlike a duplicated independent column, a derived value can always be recomputed and reconciled against its source — drift is detectable and fixable.

**How it actually works.** Two sub-cases:
- **Derived column** (same-row): computed from other columns of the same row — e.g., `amount_minor = amount * 100`. In MySQL this is a **generated column** (M03), which *cannot* drift because it's not stored as an independent fact (or, if STORED, is maintained by the engine).
- **Materialized aggregate** (cross-row/table): a value summarizing many rows — `account.balance` (fold over entries, M01/1.17), `settlement_totals(date)` (rollup of the day's `ledger_entry`). MySQL has no native materialized views, so you maintain these as **summary tables** updated by transaction/trigger/job (2.15), and you periodically **reconcile** them against a fresh recomputation from the source.
The defining discipline: the source (the normalized base table) is authoritative; the materialized value is a **projection** you can always rebuild.

**Why it exists / what it solves.** It makes expensive aggregations cheap to read (O(1) balance instead of summing a growing log) while keeping a clear correctness story: because the value is *derived*, you can always answer "is it right?" by recomputing from the source and comparing. This is the foundation of the fintech pattern (2.17) — fast balances that are nonetheless provably reconcilable with the immutable ledger.

**Tradeoffs & alternatives.** Materialized aggregates trade read speed for write-time maintenance and a staleness window (depending on sync mechanism, 2.15). The alternative — always recompute on read — is always correct but can be too slow on hot paths or large logs. The middle ground (snapshot + delta: store a periodic snapshot, sum only entries since) bounds the recompute cost without maintaining a per-write running total. Choice depends on read frequency vs write frequency vs acceptable staleness.

**Generics / first-principles.** "Prefer derivable over duplicated; a value you can recompute is a value you can verify." Derived data is the principled subset of denormalization because it preserves a single source of truth *conceptually* even while caching it physically. This is the same idea as a pure function's memoized result, or a build artifact reproducible from source — the cache is legitimate because it's a function of an authoritative input.

**MySQL-specific reality.** Key MySQL facts: **generated columns** (VIRTUAL or STORED, since 5.7) are the native, drift-proof way to derive same-row values, and STORED ones can be indexed (enabling the JSON/1NF escape hatch, 2.5/M03). **No native materialized views** — cross-row materialization is DIY summary tables, which is *why* MySQL fintech systems lean on transactional maintenance + scheduled reconciliation jobs. The reconciliation query itself is trivial (`SELECT account_id, SUM(amount) FROM ledger_entry GROUP BY account_id` vs the stored balance), and running it on a replica (M10) avoids loading the primary — a common MySQL pattern for verifying derived money data.

---

## 2.15 · Keeping copies consistent: the sync problem ★

**Mental model.** Every denormalized copy is a **standing promise to keep it in sync**, and there are exactly a few ways to keep that promise — each trading **freshness against coupling and complexity**. Pick the wrong mechanism and your copy is either stale (wrong answers) or your writes are slow/brittle. The sync mechanism is *the* decision that makes denormalization safe or dangerous; choosing it deliberately is the difference between "a cache" and "a corruption source."

**How it actually works — the mechanism taxonomy (decision-first).**
1. **Same-transaction update** — update the copy in the *same* DB transaction as the source (post the entry and update the balance together, M07). **Freshness:** perfectly consistent (atomic). **Cost:** every write touches more rows (contention on hot copies, M08), and source+copy must be in the same DB (no good across shards). *Default for money where correctness > throughput.*
2. **Trigger** — the DB auto-updates the copy on source changes. **Freshness:** synchronous/consistent. **Cost:** hidden logic, harder to test/debug, can't span databases, and **InnoDB cascades bypass triggers** (M01/1.6) so they can silently miss cascaded changes; performance overhead per row.
3. **Asynchronous job** — a background process recomputes/updates the copy on a schedule or queue. **Freshness:** eventually consistent (a staleness window). **Cost:** decoupled and scalable, but reads can see stale data; needs idempotency and failure handling.
4. **CDC (change data capture)** — stream source changes (from the binlog, M10/M12) to update copies/read-models, possibly in other systems. **Freshness:** eventual, low-latency. **Cost:** infrastructure (Kafka/Debezium), eventual consistency, but cleanly decouples and scales across services (the basis of CQRS/outbox, M16).
Plus, orthogonal to all four: **periodic reconciliation** — recompute from source and compare/repair — which catches drift no matter which mechanism you chose.

**Why it exists / what it solves.** Without a chosen mechanism, a denormalized copy *will* drift (a missed update, a race, a failed write), and in a money system that's a balance that lies. Naming the four mechanisms + reconciliation turns "keep it in sync" from a vague hope into a specific, costed engineering choice with known freshness and failure properties.

**Tradeoffs & alternatives.** The core axis is **consistency vs decoupling/scale**: same-transaction is most consistent but tightly coupled and contention-prone; CDC/async is loosely coupled and scalable but eventually consistent. There's no free option — even same-transaction trades throughput and cross-DB reach. Reconciliation is the safety net that lets you *safely* choose a weaker-but-faster mechanism, because drift becomes detectable and repairable rather than silent and permanent.

**Generics / first-principles.** "Cache invalidation, restated: every copy needs a chosen update mechanism, and you trade freshness for decoupling." This is the universal consistency-vs-availability/latency tension (CAP/PACELC, M12) in miniature, inside one schema. The four mechanisms map to general patterns: synchronous write-through (same-txn/trigger), write-behind/async, and event-streaming (CDC) — the same menu appears in every caching and replication system.

**MySQL-specific reality.** Concretely in MySQL: same-transaction is plain InnoDB transactions (M07); triggers exist but carry the cascade-bypass gotcha (M01/1.6) and per-row overhead and can't reach other systems; async jobs are app-side; **CDC reads InnoDB's binlog** (M10) via Debezium/Maxwell to feed Kafka/read-models — the standard MySQL way to propagate changes to other services and the foundation of the **outbox pattern** (M12/M16) that avoids dual-write inconsistency. The reconciliation safety net is especially idiomatic in MySQL fintech because there's no native materialized view to guarantee the copy: you *must* be able to recompute `SUM(entries)` and repair the stored balance, ideally on a replica (M10).

---

## 2.16 · Normalization vs denormalization in distributed/scaled systems

**Mental model.** On a single node, normalization is nearly free to *read back* (joins are local and fast), so it's the easy default. **At scale, the calculus inverts**: once data is sharded across nodes (M11), a join that crosses shards is slow or impossible, so the normalized "join it back together" strategy breaks down — and **denormalization stops being optional and becomes structural.** But the integrity bill normalization was paying doesn't vanish; it just **moves out of the database and into your application/pipeline**, where you now pay it with idempotency, reconciliation, and eventual-consistency handling.

**How it actually works.** Sharding partitions tables across nodes by a shard key (M11). Within a shard, normalized joins still work; *across* shards they require scatter-gather or are disallowed, and cross-shard *transactions/FKs* are impossible without distributed-transaction machinery (2PC/Saga, M12). So distributed designs:
- **Denormalize read-models** so a read hits one shard/one row (pre-joined, pre-aggregated) instead of joining across nodes.
- **Co-locate** data that must be transactionally consistent on the *same* shard (e.g., both legs of a transfer, M11) so the core invariant stays enforceable locally.
- **Replace DB-enforced integrity** (cross-shard FKs, which can't exist) with application checks + **reconciliation** + **CDC/outbox** propagation (2.15/M12).
The normalized source of truth may still exist *within* a shard; what changes is that cross-entity consistency is now an application/pipeline responsibility, not a single-node transaction.

**Why it exists / what it solves.** This concept stops the module's advice from being naive. "Always normalize, denormalize only when measured" is right on one node; at scale, *physics* (network, partitioning) forces denormalization regardless of measurement, and the real question becomes "how do I keep it correct without single-node transactions?" Naming this prevents the trap of carrying single-node instincts into a sharded design.

**Tradeoffs & alternatives.** The trade is **single-node integrity vs horizontal scale**. Staying on one (big) node keeps normalization and ACID joins but caps you at one machine's limits; sharding scales writes but forces denormalized reads and app-level integrity. Middle paths: read replicas (scale reads without sharding writes, M10), functional/vertical partitioning (split by table/service before splitting by row), and keeping the *ledger* on a co-located shard so its invariants stay locally enforceable while *derived* read-models go wide.

**Generics / first-principles.** "Locality changes the cost model; a decision that's free locally can be prohibitive distributed." Joins, transactions, and consistency are all cheap within a boundary and expensive across one — the same truth governs microservice decomposition, distributed caches, and data-mesh designs. The deeper principle: **denormalization at scale isn't a performance hack, it's a consequence of the CAP/locality reality** (M12), and the integrity you stop getting for free must be re-bought explicitly.

**MySQL-specific reality.** MySQL scales reads with replicas (M10) and writes with application sharding or **Vitess** (M11), which explicitly embraces denormalized, shard-local access and provides routing instead of cross-shard joins. Cross-shard FKs simply don't exist, so sharded MySQL fintech systems drop DB-enforced cross-entity integrity and rely on **co-locating transactionally-coupled rows on one shard** (keep a transfer's debit and credit together, M11), **outbox/CDC off the binlog** for propagation (M12), and **reconciliation jobs** for drift. The single most important MySQL fintech sharding rule that falls out of this: **shard so that each money-conserving transaction stays within one shard**, preserving the double-entry invariant under a single local InnoDB transaction even in a distributed system.

---

## 2.17 · Fintech capstone — the normalized ledger + denormalized balance ★

**Mental model.** The canonical fintech data shape is this module in one sentence: **a fully-normalized, immutable ledger as the authoritative source of truth, with denormalized balances and rollups as reconciled, rebuildable caches.** The ledger is normalized to the hilt because *truth must not be able to contradict itself*; the balances are denormalized because *reads must be fast*; and reconciliation is the mechanism that lets the fast copy be trusted because it's continuously proven equal to the slow truth. It's the normalize-for-integrity / denormalize-for-speed seesaw resolved correctly for money.

**How it actually works.** The pieces and *why each sits where it does on the ladder*:
- **`ledger_entry` — fully normalized, immutable, append-only** (M01/1.17). Each entry is one atomic fact (1NF), depends only on its key (2NF/3NF/BCNF), and is never updated or deleted. This is the *source of truth*; normalization here guarantees no two entries can disagree about money.
- **Double-entry invariant** — `SUM(amount)` over a transaction = 0 (M01/1.19). A normalized, structural conservation law.
- **`account.balance` — denormalized derived aggregate** (2.14): a fold over that account's entries, kept as a summary value because every screen needs it in O(1) (2.13 read-optimized path).
- **Rollups** (`settlement_totals` etc.) — further denormalized materializations for reporting/analytics (2.14), often maintained async/CDC (2.15) since reports tolerate slight staleness.
- **Sync + reconciliation** (2.15): balance is updated **in the same transaction** as the entry (strong consistency where money correctness demands it); a scheduled job recomputes `SUM(entries)` and **reconciles** against stored balances to catch and repair any drift — the safety net that makes the denormalization trustworthy.

**Why it exists / what it solves.** It delivers all three of fast reads, perfect auditability, and provable correctness *simultaneously* — which neither pure normalization (too slow to read balances) nor naive denormalization (a `balance` column with no immutable backing — can silently lie) achieves alone. It's the *money-never-lies* thread's structural answer: the truth is normalized and immutable; the fast path is derived and continuously reconciled; drift is detectable and repairable rather than silent and permanent.

**Tradeoffs & alternatives.** The accepted costs: each entry write also updates the balance (extra write + hot-account contention, M08), and rollups carry a staleness window. The naive alternatives are the failure cases this design exists to avoid: `account.balance` as the *only* record (no audit, races, money can vanish — M01/1.19), or recomputing balances from scratch on every read (correct but too slow at scale). CQRS/event-sourcing (M16) is the maximalist extension — the normalized event log as sole truth, multiple denormalized read-models projected from it via CDC.

**Generics / first-principles.** "Keep the truth normalized and immutable; serve speed from derived, reconciled projections." This is the durable pattern behind event sourcing, CQRS, data warehousing (normalized OLTP → denormalized OLAP), and even InnoDB's own design (the redo log is the normalized append-only truth; the pages are the materialized current state, M09). Source-of-truth + rebuildable projections + reconciliation is the general recipe for "fast *and* correct."

**MySQL-specific reality.** Concretely on MySQL/InnoDB: the ledger is normalized InnoDB tables with FKs (RESTRICT, never CASCADE — M01/1.6) and a query-shaped clustered PK for statements (M01/1.14, M05); the balance is a summary table updated in the **same InnoDB transaction** as the entry (M07) for atomicity; **no native materialized view** means rollups are hand-built summary tables maintained by job/CDC off the binlog (2.15/M10/M12); reconciliation runs `SUM`-vs-stored comparisons, ideally on a **replica** to spare the primary (M10). Money is **DECIMAL or integer minor units, never FLOAT** (M03), so the derived sums are exact. This is the precise schema M16 grows into a full payments platform — M02's normalize/denormalize discipline is what keeps that platform both fast and honest.

---

*Concepts 2.12–2.17 — Pass B core notes complete. **M02 Pass B is fully drafted (all 17 concepts).** Next, pending sign-off: Pass C (diagrams + worked examples) then Pass D (code-specifics, failure modes, fintech lens, interview angle, self-check).*
