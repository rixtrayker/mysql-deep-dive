# M06 · Pass C — Diagrams & Worked Examples · Concepts 6.1–6.7

> **Pass C scope:** content-contract items **#12 Diagram(s)** and **#8 Worked example** (narrated, no code in prose — EXPLAIN output shown illustratively in diagrams). Pairs with `01-reading-the-plan.md`. Mermaid throughout. Domain: payments/wallet, M05-indexed ledger.

---

## 6.1 · The tuning loop: write → EXPLAIN → fix → re-EXPLAIN ★

**Diagram — the master tuning loop (reused all module):**

```mermaid
flowchart TD
    W["1 · WRITE / identify the query<br/>(slow query log / perf_schema / hot access pattern, M13)"]
    W --> E["2 · EXPLAIN it → make the plan VISIBLE (M04/4.15)"]
    E --> D["3 · DIAGNOSE the signal:<br/>type: ALL (scan) · key: NULL · Using filesort/temporary · huge rows · bad join order"]
    D --> F["4 · FIX THE CAUSE:<br/>add/adjust INDEX (M05) · ANALYZE TABLE (stats) · REWRITE (6.10/6.13) · hint (last resort, 6.12)"]
    F --> V["5 · re-EXPLAIN + MEASURE (EXPLAIN ANALYZE, 6.6)<br/>confirm the plan changed AND it's actually faster"]
    V --> I{"fixed?"}
    I -->|"one fix reveals the next bottleneck"| E
    I -->|yes| DONE["✓ verified fast plan"]
    rule["don't theorize — make the database show you · fix the CAUSE, not the symptom"]
    D -.-> rule
```

**Worked example — a slow "account 42 statement" once around the loop.**
A support engineer reports the statement screen is slow. Run the loop. **(1) Identify:** the query is `WHERE account_id = 42 ORDER BY created_at DESC LIMIT 20`. **(2) EXPLAIN:** the plan shows `type: ALL` (full table scan of a billion-row ledger) and `Extra: Using filesort` — *two* problems visible at once. **(3) Diagnose:** `ALL` means no usable index for `account_id` (the access path, 6.3); `Using filesort` means the `ORDER BY` has no index to provide the order (6.4). **(4) Fix the cause:** add the M05 composite index `(account_id, created_at)` — its leading `account_id` makes the lookup a `range`, and its second column delivers the rows *already in `created_at` order* (M05/5.10). **(5) Re-EXPLAIN + measure:** now `type: range`, `key: ix_acct_created`, and `Using filesort` is **gone**; `EXPLAIN ANALYZE` (6.6) confirms it dropped from seconds to milliseconds. **(6) Iterate:** if the screen also reads `amount`, extend the index to `(account_id, created_at, amount)` so EXPLAIN shows `Using index` (covering, M05/5.6) — one more turn of the loop. The example *is* the module: the fix wasn't guessed ("add some index"), it was *diagnosed* from the plan (the scan and the filesort each pointed to a specific index design) and *verified* by re-EXPLAIN. That causal, verifiable discipline — not folklore — is what makes a query engineer effective.

---

## 6.2 · Reading EXPLAIN: the columns ★

**Diagram — an annotated EXPLAIN row (each column = one question):**

```mermaid
flowchart LR
    subgraph ROW["one EXPLAIN row (the ledger statement query)"]
        direction TB
        t["table: ledger_entry → WHICH table (row order = join order, 6.9)"]
        ty["type: range → ACCESS PATH (M04/4.8, the #1 field, 6.3)"]
        pk["possible_keys / key: ix_acct_created → index it COULD / DID use"]
        kl["key_len: (both cols) → how MUCH of a composite index is used (leftmost-prefix, M05/5.7)"]
        rf["ref: const → what the index is compared against"]
        rw["rows: 30 · filtered: 100% → ESTIMATE of work (stats, 6.5)"]
        ex["Extra: Using index → expensive/important extra work (the goldmine, 6.4)"]
    end
    healthy["HEALTHY: range · ix_acct_created · rows~30 · Using index"]
    sick["SICK: ALL · key NULL · rows 1B · Using filesort"]
    ROW --> healthy
    ROW --> sick
```

**Worked example — decoding a real EXPLAIN row, column by column.**
You EXPLAIN the (now-indexed) statement query and read across the row like a sentence. **`table: ledger_entry`** — this row is about the ledger (in a single-table query there's one row; in a join, top-to-bottom order would tell you the join order, 6.9). **`type: range`** — the access path is an index range scan (good — not a full `ALL` scan, 6.3); this is the field you read *first*. **`key: ix_acct_created`** — it actually chose the M05 `(account_id, created_at)` index (vs `possible_keys` listing what it *could* have used). **`key_len`** showing *both* columns' bytes — it's using the full composite, not just the leading column (a quick way to confirm leftmost-prefix is working, M05/5.7; a too-small `key_len` would reveal only `account_id` is used). **`ref: const`** — the index is matched against a constant (`account_id = 42`). **`rows: 30, filtered: 100%`** — the optimizer estimates ~30 rows examined, all surviving the `WHERE` (6.5) — a small, healthy estimate. **`Extra: Using index`** — the covering-index win (M05/5.6): answered from the index alone, no row fetch, no filesort (6.4). Read together, the row *describes the entire strategy*, and you can tell at a glance it's healthy. The same query before tuning read the "sick" sentence — `type: ALL, key: NULL, rows: 1B, Extra: Using filesort` — and each sick column pointed at exactly what to fix. Fluency in this vocabulary turns EXPLAIN from cryptic output into precise diagnosis, which is the whole skill of 6.1's loop.

---

## 6.3 · Access types (the `type` column): const → ALL

**Diagram — the access-type ladder (best → worst):**

```mermaid
flowchart TB
    BEST["const / system → ≤1 row via PK/unique = constant ✓✓ (idempotency lookup)"]
    EQ["eq_ref → 1 row per driving row via PK/unique (ideal join inner, 6.8)"]
    REF["ref → index lookup, one value, N rows (entries for one account_id)"]
    RANGE["range → index scan over a contiguous range (created_at BETWEEN…)"]
    IDX["index → full scan OF THE INDEX (cheaper than ALL if small/covering)"]
    ALL["ALL → FULL TABLE SCAN ❌ (the red flag on large tables)"]
    BEST --> EQ --> REF --> RANGE --> IDX --> ALL
    note["triage: scan for ALL (and index) on BIG tables FIRST.<br/>goal of tuning: move a table UP the ladder (ALL → range/ref) via an index (M05)"]
    caveat["⚠ ALL isn't always wrong: for a NON-selective query (6.5), a scan can beat millions of bookmark lookups — the optimizer may be right"]
    ALL -.-> caveat
```

**Worked example — the same query climbing the ladder as you add indexes.**
Take `WHERE account_id = 42 AND created_at >= '2025-06-01'` and watch `type` change as the index design improves. **No index on `account_id`:** `type: ALL` — full scan of a billion rows, the red flag. **Add `(account_id)`:** `type: ref` — an index lookup jumps to account 42's rows, then filters by date; vastly fewer rows touched. **Use `(account_id, created_at)`:** `type: range` — an index range scan reads *exactly* account 42's June-onward entries (the date condition now uses the index too, M05/5.7). **If the query only needs columns in that index:** EXPLAIN may show `type: range` with `Extra: Using index` (covering). And the idempotency lookup `WHERE idempotency_key = 'abc'` on the UNIQUE index is **`type: const`** — at most one row, essentially free. Same family of queries, climbing from `ALL` (catastrophic) to `range`/`const` (fast), purely by giving the optimizer better access paths (M05). The diagram's caveat matters for nuance: `ALL` is a *signal to investigate*, not an automatic verdict — if account 42 somehow matched most of the table (or the table were tiny), the optimizer might *correctly* prefer a scan over millions of bookmark lookups (6.5/M05·5.9). So the move is: see `ALL` on a big, selective query → check `possible_keys`/`key` → realize no index serves the predicate → add one → re-EXPLAIN for `ALL`→`range`. This single step is the most common one in the whole tuning loop.

---

## 6.4 · The `Extra` column: the tuning goldmine

**Diagram — Extra flags: good vs bad signals:**

```mermaid
flowchart TB
    EX["Extra column — the expensive/important hidden work"]
    EX --> GOOD["✓ GOOD signals"]
    EX --> BAD["✗ TUNING TARGETS"]
    EX --> INFO["◻ informational"]
    GOOD --> g1["Using index → COVERING (answered from index, no row fetch, M05/5.6)"]
    GOOD --> g2["Using index condition → ICP: WHERE pushed to index level (good)"]
    BAD --> b1["Using filesort → sort with no index → spills to disk (M04/4.13)<br/>FIX: index that provides the ORDER (M05/5.10)"]
    BAD --> b2["Using temporary → temp table (GROUP BY/DISTINCT) → disk if large<br/>FIX: index aligned to grouping / rewrite"]
    BAD --> b3["Using join buffer (BNL) → join lacks index → FIX: index the join column (6.8)"]
    INFO --> i1["Using where → rows filtered after read (common, often fine)"]
    rule["read Extra SECOND (after type). Biggest wins often = eliminating a blocking op, not fixing access"]
```

**Worked example — spotting `Using filesort` and the index that removes it.**
A query has a *great* access type but is still slow — exactly the case `Extra` exists to catch. The statement query `WHERE account_id = 42 ORDER BY created_at DESC` with only a `(account_id)` index shows `type: ref` (the access path is fine — it jumps straight to account 42's rows) but `Extra: Using filesort`. That filesort is the real cost: MySQL fetches account 42's rows efficiently, then has to **sort them by `created_at`** — and for a high-volume account with millions of entries, that sort **spills to disk** (M04/4.13), turning a fast lookup into a multi-second stall. Reading *only* `type` would have missed it (the access looked healthy); reading `Extra` reveals the bottleneck is the *post-access sorting*. The fix lives in `Extra` too: extend the index to `(account_id, created_at)` so the rows come out of the index *already in `created_at` order* (M05/5.10) — re-EXPLAIN and `Using filesort` is **gone**, replaced (if `amount` is covered) by the goldmine signal `Using index` (M05/5.6). This is the concept's core lesson: **total cost includes the processing after the access**, and the biggest wins often hide in eliminating a `Using filesort`/`Using temporary` blocking op — which is why `Extra` is the tuning goldmine, read second only to `type`.

---

## 6.5 · Row estimates, `filtered`, and cost

**Diagram — estimate vs actual (the diagnostic gap):**

```mermaid
flowchart TB
    PLAN["EXPLAIN: rows = 30 (ESTIMATE from stats, M04/4.7)<br/>× filtered % = rows passed to next step"]
    REAL["EXPLAIN ANALYZE: actual rows = 10,000,000 (REALITY, 6.6)"]
    PLAN --> GAP{"estimate vs actual GAP?"}
    REAL --> GAP
    GAP -->|"small gap"| TRUST["plan rests on good estimates → trust it"]
    GAP -->|"BIG gap (10 vs 10M)"| CAUSE["the optimizer was MISLED → wrong plan"]
    CAUSE --> c1["stale statistics (table grew) → ANALYZE TABLE"]
    CAUSE --> c2["data skew → ANALYZE TABLE … UPDATE HISTOGRAM"]
    CAUSE --> c3["correlated columns (assumes independence) → rewrite / hint"]
    rule["a cost-based decision is only as good as its estimates — the GAP is your diagnostic"]
```

**Worked example — the query whose estimate says 10 but it scans millions.**
A query that *looks* fine in plain EXPLAIN runs slowly, and the `rows` column is the clue. EXPLAIN estimates `rows: 30` for a step — small, so the chosen plan looks reasonable. But the query is slow, so you run `EXPLAIN ANALYZE` (6.6) and the *actual* rows for that operator is **10,000,000**. That 30-vs-10M gap is the smoking gun: the optimizer is reasoning from a **wrong estimate**, so even though the *plan* looks sensible on paper, it's the wrong plan for the real data. The diagnosis isn't "add an index" (the access path may be fine) — it's "*why is the estimate so wrong?*" The usual causes (the diagram): **stale statistics** (the ledger grew but cardinality wasn't refreshed, M04/4.7) → fix with `ANALYZE TABLE`; **data skew** (the estimate assumes uniform distribution but one value dominates) → fix with a histogram; or **correlated columns** (the optimizer multiplies selectivities assuming independence, but `currency` and `country` are correlated, so the combined estimate is way off) → fix with a rewrite. This is a *different class* of slow query from "missing index" — it's "the optimizer was misled" — and you can only catch it by **reading `rows`/`filtered` and comparing the estimate to reality**. The instinct it builds: when a plan looks right but performs wrong, suspect the *estimates* (the inputs), not the optimizer's *logic*.

---

## 6.6 · EXPLAIN ANALYZE & FORMAT=TREE: plan vs reality

**Diagram — three views, what each gives:**

```mermaid
flowchart TB
    Q["a slow query"]
    Q --> T1["EXPLAIN (tabular)<br/>ESTIMATED plan, no run · fast, safe · spot obvious problems"]
    Q --> T2["EXPLAIN FORMAT=TREE<br/>operator TREE (matches executor, M04/4.10) · read join structure clearly"]
    Q --> T3["EXPLAIN ANALYZE<br/>RUNS it → actual time / rows / LOOPS per operator · the TRUTH"]
    T3 --> READ["read ANALYZE: operator with biggest (actual time × loops) = the real hotspot<br/>high LOOPS on inner table = large driving set / missing index (6.8/6.9)<br/>big estimate-vs-actual rows gap = stale stats (6.5)"]
    warn["⚠ EXPLAIN ANALYZE RUNS the query (side effects, full cost) — careful on writes/huge scans"]
    T3 -.-> warn
    flow["workflow: EXPLAIN first (cheap) → ANALYZE when a plan LOOKS fine but is slow → trace for WHY (6.7)"]
```

**Worked example — finding which operator actually dominates a slow join.**
A join of `account` → `ledger_entry` is slow, but plain EXPLAIN shows a plausible plan (indexes in `key`, reasonable `type`s) — so you can't tell *where* the time goes from estimates alone. You run **`EXPLAIN ANALYZE`**, which *executes* the query and annotates each operator in the tree with **actual** stats. The output reveals the truth: the inner `ledger_entry` lookup shows `actual time=0.05..0.05 rows=29 loops=350000` — i.e., it ran **350,000 times** (once per driving row). That high **`loops`** count is the diagnosis: the driving table (`account`) wasn't filtered down enough (or the join order is wrong, 6.9), so the inner table is probed hundreds of thousands of times — and `350,000 × 0.05ms` is where the seconds went, *not* in the access path you might have suspected. The fix follows from the actual hotspot: filter the driving side harder, fix the join order (6.9), or ensure the inner lookup is a tight `eq_ref` (6.8) — and you **re-run ANALYZE to confirm** the loops dropped and the time fell. `FORMAT=TREE` made the join *structure* legible (the nested-loop shape); `ANALYZE` made the *cost* visible (which operator, how many loops). Together they turn "the join is slow" into "this inner operator runs 350k times — reduce the driving set" — the difference between guessing and knowing. (And you used ANALYZE deliberately here because it's a read; on a write you'd be more careful, per the warning.)

---

## 6.7 · The optimizer trace: why it chose this plan

**Diagram — the trace answers "why":**

```mermaid
flowchart TB
    SURPRISE["surprising plan: full scan DESPITE a perfect index — WHY?"]
    SURPRISE --> TRACE["optimizer trace (information_schema.OPTIMIZER_TRACE)"]
    TRACE --> SHOW["dumps the optimizer's REASONING:<br/>· candidate plans considered<br/>· COST assigned to each<br/>· why alternatives were rejected"]
    SHOW --> REVEAL["reveals: it estimated your index would match 40% of the table<br/>→ costed the scan cheaper → chose scan"]
    REVEAL --> ROOT{"root cause?"}
    ROOT -->|"wrong ESTIMATE"| FIX1["stale/skewed stats → ANALYZE TABLE / histogram (NOT a hint!)"]
    ROOT -->|"optimizer LIMITATION"| FIX2["rewrite (6.10) or hint (6.12)"]
    ladder["escalation: type/Extra (6.3/6.4) → EXPLAIN ANALYZE (6.6) → optimizer trace (LAST, for WHY)"]
```

**Worked example — why the optimizer skipped your perfect index.**
You built what looks like the *perfect* index for a query, but EXPLAIN stubbornly shows `type: ALL` — a full scan — and you can't understand why. Plain EXPLAIN tells you *what* (it's scanning) but not *why* (why did it reject your index?). So you escalate to the **optimizer trace**: enable it, run the query, and read the optimizer's internal cost reasoning. The trace shows it: when costing the access paths, the optimizer estimated your index would match **40% of the table** — so it computed that 40%-of-a-billion bookmark lookups (M05/5.5) would cost *more* than a sequential full scan, and chose the scan. That estimate is the revelation: the index is fine, but the optimizer *believes* it's non-selective. Now you know the **root cause** is a wrong estimate, not an optimizer bug or a bad index — so the fix is **`ANALYZE TABLE`** (refresh stale statistics) or a **histogram** (if the column is skewed and the value you query is actually rare), *not* a hint (6.12) and *not* a different index. After fixing the stats, the trace (and EXPLAIN) show the optimizer now estimates the index matches few rows, costs it cheaper than the scan, and uses it. The example shows the trace's unique value: it's the only tool that exposes *why* — the considered alternatives and their costs — which distinguishes "the optimizer was misled by bad inputs (fix the stats)" from "the optimizer has a genuine limitation (rewrite/hint)." It's the deepest, last rung of the diagnostic ladder, used sparingly but decisively when EXPLAIN's *what* isn't enough.

---

*Diagrams + worked examples for 6.1–6.7 complete (7 Mermaid). Next Pass C file: 6.8–6.11 (join algorithm mechanics, driving table, rewrite map, filesort/temp decision).*
