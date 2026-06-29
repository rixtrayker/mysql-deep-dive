# M06 · Query Optimization & Execution Plans — Pass A (Skeleton)

> **Pass A goal:** lock the ordered concept list, a one-line mental model per concept, and the planned diagram + worked example per concept. No prose yet — that's Pass B.
>
> **Module mental model:** *M04 told you the optimizer chooses a plan; M05 gave it good access paths to choose from. M06 is where you* see *and* shape *those choices. `EXPLAIN` is the instrument: it shows the optimizer's chosen access paths, join order, and row estimates — reading it is reading the optimizer's mind. Once you can read a plan, query optimization becomes a tight, repeatable loop: write the query → `EXPLAIN` it → spot the problem (full scan, filesort, bad join order, wrong estimate) → fix it (add/adjust an index, refresh stats, rewrite the query, or — rarely — hint) → re-`EXPLAIN`. This module turns the theory of M04/M05 into the daily practice of making queries fast, and it builds the diagnostic instinct: don't guess, make the database show you what it's actually doing.*
>
> **Threads carried in this module:**
> - **Tradeoff** — every tuning move (index vs rewrite vs hint, covering width vs write cost) is a cost decision; EXPLAIN is how you read the optimizer's cost reasoning and decide where to spend.
> - **Generics-first** — "make decisions observable, then optimize" and the read-plan → fix → verify loop are universal (query planners, profilers, distributed traces); MySQL's EXPLAIN is one instrument.
> - **Money-never-lies** — plan *stability* is a correctness-adjacent concern: a reconciliation query that silently regresses to a full scan over a billion-row ledger can stall the system; tuning keeps money queries fast *and* predictable.
>
> **Prereqs:** M04 (the optimizer 4.6, cost model/statistics 4.7, access paths 4.8, join strategies 4.9, the EXPLAIN bridge 4.15), M05 (the indexes that create good access paths), M01/1.14 (design for your queries), M03 (typed schema). **Leads into:** M13 (slow query log / performance_schema as the *source* of queries to tune), M14 (the triage decision-tree cheat-sheets), M16 (keeping the platform's hot money queries fast at scale).

---

## Concept list (ordered)

| # | Concept | One-line mental model | Diagram | Worked example |
|---|---------|----------------------|---------|----------------|
| 6.1 | **The tuning loop: write → EXPLAIN → fix → re-EXPLAIN** | Query optimization is a repeatable diagnostic loop, not guesswork — make the plan visible, find the problem, fix the cause, confirm. ★ | The loop (master diagram, reused) | Take a slow "account 42 statement" query once around the loop end-to-end |
| 6.2 | **Reading EXPLAIN: the columns** | EXPLAIN's columns each answer one question — which table, what access path, which index, how many rows, what extra work — together they're the plan. ★ | Annotated EXPLAIN row → what each column means | Decode a real EXPLAIN row for the ledger statement query, column by column |
| 6.3 | **Access types (the `type` column): const → ALL** | The `type` column names the access path (M04/4.8) from best (`const`) to worst (`ALL`) — the single most important field for spotting trouble. | Access-type ladder with EXPLAIN `type` values | Same query under different indexes shows `const` / `ref` / `range` / `index` / `ALL` |
| 6.4 | **The `Extra` column: the tuning goldmine** | `Extra` reveals the expensive hidden work — `Using filesort`, `Using temporary`, `Using index` (covering), `Using index condition` — where most tuning wins live. | `Extra` flags → good vs bad signals | Spot `Using filesort` on a statement query and the index that removes it (M05/5.10) |
| 6.5 | **Row estimates, `filtered`, and cost** | The `rows` × `filtered` estimate is the optimizer's guess of work (M04/4.7); a big estimate-vs-actual gap means stale stats or a mis-estimate. | Estimate vs actual (EXPLAIN vs EXPLAIN ANALYZE) | A query whose estimate says 10 rows but actually scans millions — diagnosing the gap |
| 6.6 | **EXPLAIN ANALYZE & FORMAT=TREE: plan vs reality** | `EXPLAIN` shows the *estimated* plan without running; `EXPLAIN ANALYZE` *runs* it and reports actual time/rows/loops per operator — the truth. | Tabular vs TREE vs ANALYZE (what each gives) | Use ANALYZE to find which operator actually dominates a slow join |
| 6.7 | **The optimizer trace: why it chose this plan** | When EXPLAIN shows *what* but you need *why*, the optimizer trace exposes the cost numbers and the rejected alternatives. | Trace structure: considered plans → costs → choice | Why the optimizer picked a scan over your index — read it in the trace |
| 6.8 | **Join algorithms in depth: nested-loop, BNL, hash** | The deep mechanics of how MySQL joins tables (M04/4.9) — and how to read which algorithm EXPLAIN chose and make it pick the efficient one. | Mechanics of each algorithm + EXPLAIN signature | Joining account→ledger_entry: index nested-loop vs hash join, and the index that flips it |
| 6.9 | **Join order & the driving table** | The optimizer picks which table drives the join; driving from the small/selective side keeps intermediate results tiny — and you can read/influence the order. | Driving-table choice → intermediate result size | Driving from `account` (filtered) vs `ledger_entry` (billion rows) — the order that wins |
| 6.10 | **Subqueries, derived tables & CTEs** | The same logical result can be written as a subquery, a join, a derived table, or a CTE — and how you write it affects (or used to affect) the plan. | Rewrite map: subquery ⇄ join ⇄ CTE ⇄ derived | A correlated subquery rewritten as a join; CTE materialization vs merging (8.0) |
| 6.11 | **Sorting & grouping at scale (filesort/temp deep dive)** | When sorts/groups can't use an index they buffer or spill to disk (M04/4.13) — how to read the spill and design it away. | In-memory vs on-disk sort/temp decision + fixes | A large GROUP BY spilling to an on-disk temp table; the index/rewrite that fixes it |
| 6.12 | **Optimizer & index hints (and when to use them)** | Hints override the optimizer's choices — a last resort when good indexes + fresh stats still produce a bad plan; powerful but brittle. | Hint types + the "fix inputs first" decision flow | Forcing an index the optimizer wrongly skips — and why it's the last option |
| 6.13 | **Query anti-patterns & their fixes** ★ | A catalog of query shapes that silently defeat indexes or explode work — N+1, `SELECT *`, non-sargable predicates, leading wildcards, implicit conversions, `OFFSET` pagination — each with a fix. ★ | Anti-pattern → why it's slow → fix (catalog) | The implicit-conversion trap (string vs int) silently full-scanning; deep-OFFSET pagination |
| 6.14 | **Pagination & large result sets** | Naive `LIMIT/OFFSET` gets quadratically slower deep into a list; keyset ("seek") pagination stays constant — a critical pattern for statements/feeds. | OFFSET scan-and-discard vs keyset seek | Paginating a million-row statement: `OFFSET 1000000` vs `WHERE id > last_seen` |
| 6.15 | **Plan stability: why a fast query suddenly gets slow** | Plans can regress without code changes — stale stats, data growth/skew, parameter sniffing — and keeping plans stable is an operational discipline. | Causes of plan regression → detection → fix | A reconciliation query that was fast yesterday now full-scans — root-causing the regression |
| 6.16 | **Fintech capstone: tuning the ledger's hot queries** ★ | End-to-end: take the payments system's critical queries (statement, balance, reconciliation, idempotency lookup) through the loop — verify they use the M05 indexes, kill every filesort, keep them stable. ★ | Annotated EXPLAINs of the money queries (before→after) | Tune the full set of ledger access patterns to fast, stable plans (synthesizes M04/M05, sets up M16) |

---

## Diagram inventory for M06 (Pass C targets)

- **Notation standard:** Mermaid throughout — flowcharts for the tuning loop and decision trees, annotated "tables" (Mermaid) for EXPLAIN-row decoding, comparison flows for join algorithms / rewrites / pagination. **No bespoke SVG needed** (EXPLAIN output and decision trees render well in Mermaid; the structural visuals live in M05/M09).
- **★ Emphasis diagrams (still Mermaid, just central):** 6.1 (the tuning loop — master, reused), 6.2 (annotated EXPLAIN row), 6.13 (anti-pattern catalog), 6.16 (before→after EXPLAINs of the money queries).

## Worked-example domain

Single running **payments/wallet** domain (continues M01–M05), using the M05-indexed ledger. The recurring vehicles: the **statement query** (`WHERE account_id=42 ... ORDER BY created_at`), the **balance read**, the **reconciliation** aggregate (`SUM` over the ledger), and the **idempotency-key lookup** — the exact access patterns M05/5.18 indexed, now verified and tuned via EXPLAIN. Billion-row scale assumed so plan choices and regressions are real.

## "Go deeper" additions (matching house style)

Beyond a basic "run EXPLAIN and add an index" treatment, this skeleton deliberately includes the staff-level material: **EXPLAIN ANALYZE & FORMAT=TREE plan-vs-reality (6.6)**, **the optimizer trace for *why* (6.7)**, **join-algorithm deep mechanics + driving table (6.8–6.9)**, **subquery/CTE/derived-table rewrites incl. 8.0 CTE materialization (6.10)**, **filesort/temp deep tuning (6.11)**, **hints as a last resort with the "fix inputs first" discipline (6.12)**, **the full anti-pattern catalog incl. sargability & implicit conversions (6.13)**, **keyset vs OFFSET pagination (6.14)**, and **plan stability / regression root-causing (6.15)** — the things that separate "knows EXPLAIN exists" from "can diagnose and stabilize any slow query."

## Open questions surfaced during Pass A (not blocking)

1. **Join-algorithm depth (6.8) vs M04/4.9:** M04 *introduced* join strategies; M06 does the *deep mechanics + EXPLAIN reading + tuning*. Confirm this split (introduce there, master here) rather than repeating? (Proposed: yes — M06 is the deep dive, with back-references to M04/4.9.)
2. **Anti-pattern catalog (6.13) vs M14 cheat-sheet:** keep 6.13 as the *explained* catalog (why + fix, with worked examples) and let M14 be the *quick-reference* triage version? (Proposed: yes — depth here, scannable reference in M14.)
3. **Concept count (16).** Comfortable, or merge (e.g., fold 6.3 access-types + 6.4 Extra into one "reading the plan" concept, or 6.14 pagination into 6.13 anti-patterns)?

## Pass A status: ✅ drafted — awaiting your sign-off before Pass B (core notes).
