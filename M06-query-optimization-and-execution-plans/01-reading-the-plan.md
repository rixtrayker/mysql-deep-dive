# M06 · Pass B — Concepts 6.1–6.7 · Reading the Plan

> **Pass B scope:** content-contract items **#1 Mental model · #2 How it works · #3 Why it exists · #4 Tradeoffs · #5 Generics · #6 MySQL reality.** Items #7–#12 come in Passes C/D.
>
> Running domain: payments/wallet, M05-indexed ledger. Recurring queries: statement (`WHERE account_id=42 ORDER BY created_at`), balance read, reconciliation (`SUM` over the ledger), idempotency lookup.

---

## 6.1 · The tuning loop: write → EXPLAIN → fix → re-EXPLAIN ★

**Mental model.** Query optimization is **not guesswork or folklore** ("add an index and hope") — it's a tight, repeatable **diagnostic loop**: write the query, make its plan visible with `EXPLAIN`, identify the *specific* problem (a full scan, a filesort, a bad join order, a wrong row estimate), fix the *cause* (add/adjust an index, refresh statistics, rewrite the query, or — rarely — hint), then **re-`EXPLAIN` to confirm** the fix actually changed the plan. The whole module is this loop; every other concept is a tool used inside it. The discipline it instills: *don't theorize about why a query is slow — make the database show you.*

**How it actually works.** The loop, concretely:
1. **Write/identify the query** — often surfaced by the slow query log or performance_schema (M13), or a known hot access pattern (M01/1.14).
2. **EXPLAIN it** — see the optimizer's chosen plan (M04/4.15): access paths per table (`type`, 6.3), chosen indexes (`key`), row estimates (`rows`, 6.5), and the expensive extras (`Extra`, 6.4).
3. **Diagnose** — read the plan for the problem signal: `type: ALL` (full scan, 6.3), `Using filesort`/`Using temporary` (6.4), a huge `rows` estimate or estimate-vs-actual gap (6.5/6.6), a bad driving table (6.9).
4. **Fix the cause** — the right lever for the diagnosis: a missing/covering index (M05), `ANALYZE TABLE` for stale stats (M04/4.7), a query rewrite (6.10/6.13), or a hint as last resort (6.12).
5. **Re-EXPLAIN (and measure)** — confirm the plan changed as intended (`ALL`→`range`, filesort gone), and verify with `EXPLAIN ANALYZE` / timing (6.6) that it's actually faster.
6. **Iterate** — one fix can reveal the next bottleneck.

**Why it exists / what it solves.** It replaces the two failure modes of ad-hoc tuning: **guessing** (adding indexes that don't help, or "optimizing" a query that wasn't the problem) and **cargo-culting** (applying rules without understanding). The loop is *causal and verifiable* — you diagnose the actual plan, fix the actual cause, and prove the fix — so effort goes where it pays. It's the operationalization of M01/1.14 ("design for your queries") and M04/4.15 ("make decisions observable").

**Tradeoffs & alternatives.** The loop costs a little discipline (read the plan before changing anything) but saves enormous wasted effort. The main tension is *where in the loop to fix*: an index (fast, but write/storage cost, M05/5.15), a rewrite (no storage cost, but changes the query), a stats refresh (free, fixes regressions), or a hint (immediate, but brittle, 6.12) — the loop is *also* about choosing the cheapest effective fix. The alternative — tuning by intuition — sometimes works for simple cases but fails exactly where it matters (complex plans, regressions), and produces index bloat and superstition.

**Generics / first-principles.** "Make the system's decisions observable, find the actual bottleneck, fix the cause, verify." This is the universal optimization discipline — identical to profiling code (profile → find the hot path → fix → re-profile), tuning distributed systems (trace → find the slow span → fix → re-trace), and the scientific method (observe → hypothesize → intervene → measure). The transferable instinct: **never optimize blind; instrument first, and confirm the change had the intended effect.** Intuition about "what the system probably does" is frequently wrong; the plan/profile/trace is ground truth.

**MySQL-specific reality.** MySQL's loop: `EXPLAIN` (estimated plan), `EXPLAIN ANALYZE`/`FORMAT=TREE` (actuals, 6.6), `OPTIMIZER_TRACE` (the *why*, 6.7), backed by the slow query log and performance_schema (M13) to *find* the queries worth tuning, and `ANALYZE TABLE` / index DDL (M05) / rewrites as the fixes. For our domain, the loop takes the "account 42 statement" query from a guess to a verified fast plan: EXPLAIN reveals whether it uses the M05 `(account_id, created_at)` index (6.3/6.4), and re-EXPLAIN confirms the fix. This loop is the spine of the whole module and the daily practice of every MySQL performance engineer.

---

## 6.2 · Reading EXPLAIN: the columns ★

**Mental model.** `EXPLAIN` output is a **table where each column answers one specific question** about how the query will run, and reading a plan is just reading those answers in order: *Which table, in what order? What access path? Which index? How many rows? What extra work?* Learn what each column means and a plan stops being cryptic and becomes a precise description of the optimizer's strategy — including exactly where it's about to do something expensive.

**How it actually works.** The key columns of tabular `EXPLAIN` and the question each answers:
- **`id` / `select_type`** — which SELECT (and whether it's a subquery, union, derived table, 6.10).
- **`table`** — which table this row is about; the **top-to-bottom row order reflects the join order** (6.9 — the first row is the driving table).
- **`type`** — the **access path** (M04/4.8): `const`, `eq_ref`, `ref`, `range`, `index`, `ALL` — best to worst (6.3). *The most important field.*
- **`possible_keys`** — indexes the optimizer *could* use; **`key`** — the index it *actually chose* (or NULL = none).
- **`key_len`** — how many bytes of the index are used (reveals whether a composite index is fully or partially used — leftmost-prefix, M05/5.7).
- **`ref`** — what the index is compared against (a constant, or a column from another table in a join).
- **`rows`** — the optimizer's *estimate* of rows examined for this step (from statistics, M04/4.7); **`filtered`** — the estimated % of those rows surviving the `WHERE` (6.5).
- **`Extra`** — the catch-all for expensive/important extra work: `Using filesort`, `Using temporary`, `Using index` (covering), `Using where`, `Using index condition` (6.4 — the tuning goldmine).

**Why it exists / what it solves.** Without knowing the columns, EXPLAIN is noise; with it, EXPLAIN is a **complete, structured description of the plan** that tells you precisely what to fix. Each column localizes a different class of problem (`type: ALL` → access path; `key: NULL` → no index used; huge `rows` → mis-estimate or missing filter; `Using filesort` → sort to eliminate). Reading the columns *is* the diagnosis step of the loop (6.1).

**Tradeoffs & alternatives.** Tabular EXPLAIN is compact and familiar but can be hard to read for complex multi-table plans (the join structure is implicit in row order); `FORMAT=TREE` (6.6) shows the operator tree explicitly (clearer nesting) and `FORMAT=JSON` shows the most detail (cost numbers, every attribute) at the price of verbosity. So the "alternative" is *which format* — tabular for a quick scan, TREE for structure, JSON/trace for depth. Reading EXPLAIN well also requires knowing the *schema and indexes* (M05) — the columns tell you *what* the optimizer did, but you need context to know *why* and *what to change*.

**Generics / first-principles.** "A plan/trace is a structured artifact; learn its fields and it becomes a precise diagnostic, not noise." Every observability tool — a flame graph, a query plan, a distributed trace, a `strace` — has a vocabulary of fields, and fluency in that vocabulary is what turns raw output into actionable diagnosis. The transferable instinct: **invest in reading your tools' output precisely** — the columns/fields each carry specific meaning, and skimming misses the signal.

**MySQL-specific reality.** MySQL's `EXPLAIN` columns are as above; the highest-signal ones for fast triage are **`type`** (access path, 6.3), **`key`** (index used), **`rows`** (estimate, 6.5), and **`Extra`** (hidden work, 6.4). `key_len` is an underused gem — it reveals how *much* of a composite index is used (e.g., only the leading column, exposing a leftmost-prefix issue, M05/5.7). `FORMAT=TREE` and `FORMAT=JSON` (8.0) give structure and detail. For the ledger statement query, a healthy EXPLAIN row reads: `table: ledger_entry, type: range, key: ix_acct_created, key_len: (both columns), rows: ~30, Extra: Using index` — versus the sick version `type: ALL, key: NULL, rows: 1B, Extra: Using filesort`. Learning to read that difference instantly is the core skill of this module.

---

## 6.3 · Access types (the `type` column): const → ALL

**Mental model.** The `type` column names the **access path** (M04/4.8) the optimizer chose for each table, and there's a clear ranking from **best (`const`) to worst (`ALL`)**. It's the *single most important EXPLAIN field for spotting trouble*: `ALL` (full table scan) on a large table is the classic red flag, while `const`/`eq_ref`/`ref`/`range` indicate the index is doing its job. Reading `type` is the fastest way to know whether a query is using indexes well or scanning.

**How it actually works.** The common access types, best to worst (mapping M04/4.8 to EXPLAIN):
- **`const`** — at most one row, via a PK/unique index matched to a constant (e.g., look up by `transaction_id` = 700). Essentially free.
- **`eq_ref`** — one row per driving row via a PK/unique index (the ideal inner-table access in a join, 6.8).
- **`ref`** — index lookup matching a value, possibly several rows (e.g., entries for one `account_id` via a non-unique index).
- **`range`** — index scan over a contiguous range (`created_at BETWEEN …`, `account_id IN (…)`).
- **`index`** — full scan *of the index* (not the table) — cheaper than `ALL` if the index is smaller / covers the query, but still scanning every index entry.
- **`ALL`** — **full table scan**: read every row. The red flag on large tables — usually a missing or unusable index (M05), or a deliberately non-selective query (6.5).
Reading `type` tells you immediately where on this ladder each table sits; the goal of tuning is usually to move a table *up* the ladder (`ALL`→`range`/`ref`) by providing a usable index.

**Why it exists / what it solves.** `type` is the **at-a-glance health indicator** of a query's access strategy. One look tells you "indexes are working" (`const`/`ref`/`range`) or "something's scanning" (`index`/`ALL`). It directs the most impactful tuning: a single `ALL` on a billion-row table is almost always *the* problem, and turning it into a `range`/`ref` via an index (M05) is the biggest win available. It focuses attention on the access path, which dominates cost.

**Tradeoffs & alternatives.** `ALL` isn't *always* bad — for a query that genuinely needs most of the table (low selectivity, 6.5/M05·5.9), a sequential full scan can be *cheaper* than millions of index bookmark lookups, and the optimizer correctly chooses it. So `ALL` is a *signal to investigate*, not an automatic verdict. Similarly `index` (full index scan) can be fine if the index is small and covering. The judgment: `ALL`/`index` on a *large* table for a *selective* query = fix it; on a *small* table or *non-selective* query = possibly correct. The fix is always "give the optimizer a better access path" (index/rewrite), not forcing it blindly (6.12).

**Generics / first-principles.** "The access method dominates cost — classify it first." `type` is a taxonomy of access strategies ranked by how much data they touch, and "which access method?" is the first question in any performance analysis (full scan vs index seek vs hash lookup, everywhere). The transferable instinct: **when something's slow, first ask how it's accessing the data — is it touching everything or just what it needs?** A scan where a seek should be is the most common and most fixable performance bug, in databases and beyond.

**MySQL-specific reality.** EXPLAIN `type` values, best→worst: `system`/`const`, `eq_ref`, `ref`, `fulltext`/`ref_or_null`, `range`, `index`, `ALL` (plus `index_merge` when the optimizer combines indexes). Triage rule: **scan for `ALL` (and `index`) on big tables first.** For the ledger statement query, the difference between `type: range` (using `(account_id, created_at)`, M05) and `type: ALL` (no usable index) is the difference between milliseconds and a billion-row scan. The everyday move: see `ALL` → check `possible_keys`/`key` → realize no index serves the predicate → add/adjust an index (M05) → re-EXPLAIN to confirm `ALL`→`range`. This is the most common single step in the tuning loop.

---

## 6.4 · The `Extra` column: the tuning goldmine

**Mental model.** The `Extra` column is where EXPLAIN reveals the **expensive hidden work** the other columns don't — the sorts, temp tables, and per-row evaluations that often dominate a query's actual cost. It's the **tuning goldmine** because the highest-value fixes frequently hide here: `Using filesort` and `Using temporary` are blocking operations that spill to disk (M04/4.13), and eliminating them (usually via an index, M05/5.10) is often a bigger win than fixing the access type. Conversely, `Using index` here is the *good* signal (a covering index, M05/5.6). Read `Extra` second only to `type`.

**How it actually works.** The most important `Extra` flags and what they mean:
- **`Using filesort`** — the query needs a sort (`ORDER BY`/`GROUP BY`) that no index provides → MySQL sorts in a buffer, **spilling to disk if large** (M04/4.13). A prime tuning target — add an index that provides the order (M05/5.10).
- **`Using temporary`** — an intermediate result is materialized into a temp table (often `GROUP BY`/`DISTINCT`/some unions), **on disk if large** (M04/4.13). Eliminate with an index aligned to the grouping, or a rewrite.
- **`Using index`** — *good news*: the query is answered entirely from the index (a **covering index**, M05/5.6) — no row lookups. The thing you *want* to see on hot reads.
- **`Using where`** — rows are filtered *after* being read from the storage engine (the index/scan didn't fully satisfy the `WHERE`). Common and not always bad, but a hint that the index isn't doing all the filtering.
- **`Using index condition`** — *index condition pushdown* (ICP): part of the `WHERE` is evaluated at the index level before fetching rows — a good optimization.
- **`Using join buffer`** — a join lacking a good index is using a buffer (block nested-loop / hash, 6.8) — often a sign to index the join column.

**Why it exists / what it solves.** `type` tells you how rows are *accessed*; `Extra` tells you what *expensive processing* happens after — and that processing (sorting, materializing, post-filtering) is frequently the real bottleneck, invisible in `type` alone. A query can have a great `type: range` *and* a killer `Using filesort` that dominates its time. Reading `Extra` surfaces these, directing tuning to where it actually pays — which is why it's called the goldmine.

**Tradeoffs & alternatives.** Some `Extra` flags are unavoidable for the query's semantics (a sort with no possible ordering index *must* filesort; certain aggregations *need* a temp table) — the question is whether you can *design them away* (an index providing the order, a rewrite reducing the sorted/grouped set) or must accept them (keeping the working set small enough to stay in memory, M04/4.13). `Using where` is often fine. The skill is distinguishing flags that signal a *fixable* inefficiency (filesort/temporary you can index away) from flags that are *expected* for the query.

**Generics / first-principles.** "Total cost includes the post-access processing, not just the access — read the whole pipeline." A fast lookup feeding an expensive sort is still slow; optimization means seeing the *entire* operator pipeline (M04/4.10), not just the leaf access. The transferable instinct: **look past 'did it use the index?' to 'what expensive work happens to the rows after?'** — the sort, the materialization, the post-filter. The biggest wins often live in eliminating a blocking step, not in the access path.

**MySQL-specific reality.** The flags above are MySQL-specific EXPLAIN annotations. Triage priority after `type`: **`Using filesort` and `Using temporary` are top targets** (blocking ops, disk-spill risk, M04/4.13) — eliminate via index (M05/5.10) or rewrite; **`Using index` is the goal** for hot reads (covering, M05/5.6); `Using index condition` (ICP) and `Using where` are informational. For the ledger statement query, the journey from `Extra: Using filesort` (sorting account 42's entries by date) to `Extra: Using index` (the `(account_id, created_at, amount)` covering index delivers them sorted *and* covers `amount`, M05/5.6/5.10) is a textbook tuning win — and it lives entirely in reading the `Extra` column.

---

## 6.5 · Row estimates, `filtered`, and cost

**Mental model.** The `rows` and `filtered` columns are the optimizer's **estimate of how much work each step does** — `rows` ≈ how many rows it expects to examine, `filtered` ≈ what % survive the `WHERE` — and the optimizer multiplies these through the plan to compare alternatives (M04/4.6–4.7). The critical diagnostic: these are **estimates from statistics** (M04/4.7), so a large **estimate-vs-actual gap** (revealed by `EXPLAIN ANALYZE`, 6.6) means the optimizer is reasoning from a wrong picture — usually **stale statistics**, data **skew**, or **correlated columns** — and a wrong estimate causes a wrong plan.

**How it actually works.** `rows` is the estimated number of rows the step examines (per the chosen access path and statistics); `filtered` is the estimated percentage of those rows that satisfy the conditions not handled by the index (so `rows × filtered%` ≈ rows passed to the next step). The optimizer uses these to estimate each plan's cost and pick the cheapest (M04/4.6). When the estimate is accurate, the chosen plan is usually good. When it's off — because statistics are stale (the table grew, M04/4.7), the data is skewed (a histogram would help, M04/4.7), or columns are correlated (the optimizer assumes independence and mis-multiplies selectivities) — the optimizer can pick badly (e.g., choose a scan thinking the index would match millions, or vice versa). You detect this by comparing the EXPLAIN estimate to the **actual** rows from `EXPLAIN ANALYZE` (6.6): a 10-vs-10,000,000 gap is the smoking gun.

**Why it exists / what it solves.** Row estimates are *how the optimizer decides* (M04/4.7), so reading them tells you *whether you can trust its decision*. A plan that looks reasonable but rests on a wildly wrong `rows` estimate is a regression waiting to happen (6.15). Checking the estimate (and its gap from reality) is how you diagnose the class of problems that *aren't* "missing index" but "the optimizer was misled" — fixed by `ANALYZE TABLE`, histograms, or a rewrite, not by adding an index.

**Tradeoffs & alternatives.** Estimates are inherently approximate (sampled stats, M04/4.7) — the tradeoff is accuracy vs the cost of computing better statistics (histograms, more sampling). You can't make them perfect, but you can keep them *fresh* (`ANALYZE TABLE` after big changes) and *richer* (histograms for skewed columns). When estimates are unfixably wrong for a critical query (rare), a hint (6.12) forces the plan — accepting brittleness to override a persistent mis-estimate. The judgment: a bad estimate is usually a *statistics* problem (fix the inputs), occasionally an *optimizer-limitation* problem (rewrite or hint).

**Generics / first-principles.** "A cost-based decision is only as good as its cost estimates — and the estimate-vs-actual gap is your diagnostic." This is the universal lesson about any predictive/cost-based system (M04/4.7 restated at the reading level): when it makes a surprising choice, **compare its prediction to reality and suspect its inputs.** The transferable instinct: instrument the *estimate* alongside the *actual* (EXPLAIN vs EXPLAIN ANALYZE; predicted vs measured) — the gap localizes whether the problem is the model's information (stats) or its logic.

**MySQL-specific reality.** `rows` and `filtered` come from InnoDB's sampled statistics and histograms (M04/4.7). The diagnostic workflow: if a plan looks wrong, run **`EXPLAIN ANALYZE`** (6.6) and compare estimated `rows` to actual — a big gap points to **`ANALYZE TABLE`** (refresh stats) or **`ANALYZE TABLE ... UPDATE HISTOGRAM`** (skew). The classic ledger incident (M04/4.7): a reconciliation query's `rows` estimate is stale after the ledger grew, so the optimizer mis-chooses — `ANALYZE TABLE ledger_entry` fixes the estimate and the plan. Reading `rows`/`filtered` and checking the estimate-vs-actual gap is how you catch and fix the "the optimizer was misled" class of slow queries — distinct from the "missing index" class that `type`/`Extra` reveal.

---

## 6.6 · EXPLAIN ANALYZE & FORMAT=TREE: plan vs reality

**Mental model.** Plain `EXPLAIN` shows the optimizer's **estimated** plan *without running the query* — fast and side-effect-free, but it's a *prediction*. **`EXPLAIN ANALYZE`** actually **runs the query** and reports the **actual** time, rows, and loop counts *per operator* — the ground truth. And **`FORMAT=TREE`** shows the plan as an explicit **operator tree** (matching the executor, M04/4.10), making nested joins and the data flow clear. Together: TREE shows you the *structure*, ANALYZE shows you *where the time actually went* — the difference between "what the optimizer expects" and "what really happens."

**How it actually works.**
- **`EXPLAIN FORMAT=TREE`** — renders the plan as a nested operator tree (e.g., `Nested loop → (Index range scan on account) + (Index lookup on ledger_entry)`), so you read the join structure and access methods top-down, the way the executor runs it (M04/4.10). Clearer than tabular EXPLAIN for complex plans.
- **`EXPLAIN ANALYZE`** — *executes* the query and annotates each operator in the TREE with **actual** stats: `actual time=first_row..last_row`, `rows=N` (actual), `loops=N` (how many times the operator ran — high loops on an inner table signals a large driving set, 6.9). You compare these actuals to the optimizer's estimates (6.5): a big `rows` estimate-vs-actual gap reveals a mis-estimate; the operator with the largest `actual time × loops` is where the real cost is.
Crucially, `EXPLAIN ANALYZE` **runs the query** — including its side effects and full cost — so you use it carefully on writes and expensive queries (it's a measurement tool, not a dry run).

**Why it exists / what it solves.** Estimates can be wrong (6.5), so a plan that *looks* fine in plain EXPLAIN can be slow in reality. `EXPLAIN ANALYZE` closes the gap between prediction and truth: it tells you *which operator actually dominates* (so you fix the right thing) and *whether estimates match reality* (so you know if the problem is stats vs logic). `FORMAT=TREE` makes complex plans *legible* (the implicit join order of tabular EXPLAIN becomes an explicit tree). They turn "I think this is slow because…" into "this operator took 90% of the time, and its estimate was 1000× off."

**Tradeoffs & alternatives.** Plain `EXPLAIN`: free, safe, but only estimates. `EXPLAIN ANALYZE`: truth, but *runs the query* (time cost, side effects — careful on writes/huge scans). `FORMAT=TREE`/`JSON`: more structure/detail, more verbosity. The workflow tradeoff: use plain EXPLAIN first (cheap, reveals plan shape and obvious problems), escalate to `EXPLAIN ANALYZE` when a plan looks fine but the query is slow (to find the real hotspot and the estimate gap), and the optimizer trace (6.7) when you need *why*. The alternative — timing the whole query with a stopwatch — tells you it's slow but not *which operator* or *why*.

**Generics / first-principles.** "Estimates predict; measurement confirms — instrument both, and trust the measurement." The plan-vs-reality split is the database form of the universal "profile, don't guess": a model (EXPLAIN) tells you what *should* happen; a profile (EXPLAIN ANALYZE) tells you what *did*. The transferable instinct: **when prediction and reality disagree, the disagreement is the diagnosis** — and the operator/span/function consuming the actual time is where to focus, not where you *assumed* the cost was. Always confirm a "fix" against measured reality (re-run ANALYZE), not against the plan alone.

**MySQL-specific reality.** `EXPLAIN ANALYZE` and `FORMAT=TREE` are **MySQL 8.0** (the 8.0 iterator executor, M04/4.10, made them clean). Read ANALYZE's per-operator `actual time`, `rows` (vs estimated), and `loops`: high `loops` on an inner join operator = a large driving set / missing index (6.8/6.9); a large estimate-vs-actual `rows` gap = stale stats/skew (6.5, fix with `ANALYZE TABLE`). For a slow ledger join, `EXPLAIN ANALYZE` pinpoints whether the time is in scanning the driving table, the per-row inner lookups (and how many loops), or a sort — so you fix the operator that actually dominates. This is the precision tool of the tuning loop (6.1): plain EXPLAIN to spot the obvious, ANALYZE to find the real hotspot and confirm the fix.

---

## 6.7 · The optimizer trace: why it chose this plan

**Mental model.** `EXPLAIN` tells you **what** plan the optimizer chose; sometimes you need to know **why** — *why did it pick a full scan over my perfect index? why this join order?* The **optimizer trace** answers that: it dumps the optimizer's internal reasoning — the **candidate plans it considered, the cost it assigned each, and why it rejected the alternatives**. It's the deepest diagnostic, used when the plan is surprising and you need to understand the optimizer's cost logic to fix it (usually by fixing the inputs the trace reveals it mis-judged).

**How it actually works.** You enable the trace, run the query, and read a (verbose, JSON) report of the optimizer's decision process: how it estimated the cost of each access path per table (M04/4.7–4.8), how it considered different join orders (6.9) and picked one, why it chose (or rejected) each index — including the **cost numbers** it computed. The payoff is seeing the *reason* behind a surprising choice: e.g., the trace shows the optimizer estimated your index would match 40% of the table (so it costed the scan cheaper) — revealing that the real problem is a **stale/ skewed statistic** (6.5, fix with `ANALYZE TABLE`/histogram), not the index. Or it shows it considered the join order you wanted but costed it higher — revealing a selectivity mis-estimate. The trace turns "the optimizer is being dumb" into "the optimizer believes X about my data, and X is wrong."

**Why it exists / what it solves.** When EXPLAIN's *what* isn't enough — the plan is surprising and you can't tell whether to fix stats, rewrite, or hint — the trace provides the *why*. It distinguishes the root causes: a mis-estimate (fix stats/histograms), an optimizer cost-model limitation (rewrite or hint), or a genuinely correct-but-surprising choice (leave it). Without the trace you're guessing at *why* a plan is wrong; with it, you see the optimizer's actual reasoning and can target the real cause.

**Tradeoffs & alternatives.** The trace is **verbose and advanced** — overkill for routine tuning (most problems are solved by reading `type`/`Extra` and adding an index, 6.3/6.4). It's the *last* diagnostic, for when EXPLAIN + EXPLAIN ANALYZE haven't explained a stubborn surprising plan. Its cost is the effort to read dense JSON reasoning; its value is uniquely answering "why." The alternative for "why is it doing this?" is trial-and-error (toggle an index, try a hint, see what changes) — slower and less informative than reading the actual cost reasoning. Use the escalation: `type`/`Extra` → `EXPLAIN ANALYZE` → optimizer trace.

**Generics / first-principles.** "When a decision surprises you, inspect the decision *process*, not just the outcome — including the inputs and alternatives it weighed." The optimizer trace is the database form of debugging a heuristic/ML/planning system by examining its scoring of candidates. The transferable instinct: **a surprising automated decision is best understood by seeing what options it considered and how it scored them** — which usually reveals that a wrong *input* (here, a statistic) drove the wrong *output*, redirecting the fix from the logic to the data.

**MySQL-specific reality.** Enabled via `SET optimizer_trace='enabled=on'`, then read `information_schema.OPTIMIZER_TRACE` (JSON) after running the query. It exposes per-plan cost estimates, considered access paths and join orders, and rejection reasons. The canonical use: a query inexplicably full-scans despite a seemingly perfect index → the trace shows the optimizer's `rows`/selectivity estimate for that index is way off → root cause is stale statistics or skew → fix with `ANALYZE TABLE` / histogram (6.5, M04/4.7), *not* a hint. It's the tool that tells you whether a surprising ledger-query plan is a stats problem (fixable cleanly) or an optimizer limitation (needs a rewrite/hint, 6.12) — the deepest rung of the diagnostic ladder, used sparingly but decisively.

---

*Concepts 6.1–6.7 — Pass B core notes complete. Next: 6.8–6.11 (join algorithms in depth, join order/driving table, subqueries/derived/CTEs, sorting/grouping at scale).*
