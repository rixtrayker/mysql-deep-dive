# M06 · Pass D — Enrichment · Concepts 6.1–6.7

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-reading-the-plan.md` (Pass B) and `04-passC-…` (Pass C). Domain: payments/wallet.

---

## 6.1 · The tuning loop: write → EXPLAIN → fix → re-EXPLAIN ★

**🔧 Code-specifics.**
```sql
-- The loop, in commands:
EXPLAIN SELECT amount FROM ledger_entry
WHERE account_id=42 AND created_at>='2025-06-01' ORDER BY created_at DESC LIMIT 20;  -- 1. see plan
-- diagnose: type=ALL + Using filesort → fix the cause:
ALTER TABLE ledger_entry ADD KEY ix_acct_created (account_id, created_at, amount);    -- 2. fix
EXPLAIN ANALYZE SELECT ... ;        -- 3. re-EXPLAIN + measure (actuals)
```

**⚠️ Failure modes & gotchas.**
- **Fixing the symptom, not the cause** (e.g., raising buffers instead of indexing the filesort away).
- **Not re-EXPLAINing** — assuming a fix worked without confirming the plan changed.
- **Tuning a query that isn't the bottleneck** — find the real slow query first (slow log / perf_schema, M13).

**💰 Fintech lens.** The loop takes every hot money query (statement, balance, reconciliation, idempotency) from a guess to a verified fast plan — and re-EXPLAIN proves it before it ships to a payments path.

**🎯 Interview / SD angle.** "Don't theorize — make the database show you." The causal loop (write→EXPLAIN→diagnose→fix cause→verify) vs guess-and-check. Same shape as profiling code / tracing distributed systems. High-signal to articulate the *verify* step.

**✅ Self-check.**
1. What are the five steps of the tuning loop?
2. Why is re-EXPLAIN (and measuring) essential, not optional?
3. How do you find which query to tune in the first place?

---

## 6.2 · Reading EXPLAIN: the columns ★

**🔧 Code-specifics.**
```sql
EXPLAIN SELECT amount FROM ledger_entry WHERE account_id=42 ORDER BY created_at DESC;
-- key columns to read (in priority order):
--   type   → access path (6.3)      key      → index chosen (or NULL)
--   rows   → estimate (6.5)          key_len  → how much of a composite index is used (M05/5.7)
--   Extra  → hidden work (6.4)       ref      → what the index is matched against
EXPLAIN FORMAT=JSON SELECT ... ;     -- full detail incl. cost numbers (6.6)
```

**⚠️ Failure modes & gotchas.**
- **Reading only `type`** and missing a killer `Using filesort` in `Extra` (6.4).
- **Ignoring `key_len`** — it reveals partial composite-index use (leftmost-prefix gap, M05/5.7).
- **Treating `rows` as exact** — it's an estimate (6.5).

**💰 Fintech lens.** A healthy ledger-statement EXPLAIN reads `range · ix_acct_created · Using index`; the sick version `ALL · NULL · Using filesort`. Reading the difference instantly is the core triage skill for money queries.

**🎯 Interview / SD angle.** Each column answers one question (which table/path/index/rows/extra). Highest-signal fields: `type`, `key`, `rows`, `Extra` — plus `key_len` as the underused gem for composite-index coverage.

**✅ Self-check.**
1. What question does each of `type`, `key`, `rows`, `Extra` answer?
2. What does `key_len` reveal that `key` doesn't?
3. Which format gives cost numbers?

---

## 6.3 · Access types (the `type` column): const → ALL

**🔧 Code-specifics.**
```sql
-- Same query, type changes as indexes improve:
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42;                 -- ALL → ref (add index)
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42 AND created_at>='2025-06-01'; -- range
EXPLAIN SELECT * FROM transaction_ WHERE idempotency_key='abc';         -- const (UNIQUE, M05/5.17)
-- ladder best→worst: const, eq_ref, ref, range, index, ALL
```

**⚠️ Failure modes & gotchas.**
- **`type: ALL`** on a large table → usually a missing/unusable index (but verify selectivity first, 6.5).
- **`type: index`** (full index scan) mistaken for good — it scans every index entry.
- **Forcing an index** when the optimizer correctly chose `ALL` for a non-selective query.

**💰 Fintech lens.** The ledger statement must be `range` (or `ref`), the idempotency lookup `const`. A `type: ALL` on either is the red flag that the index isn't being used.

**🎯 Interview / SD angle.** Order the ladder const→eq_ref→ref→range→index→ALL and map to access paths (M04/4.8). "Triage `ALL` on big tables first." Know `ALL` isn't *always* wrong (non-selective queries).

**✅ Self-check.**
1. Order the access types best to worst.
2. What's the difference between `index` and `ALL`?
3. When is `ALL` actually the right plan?

---

## 6.4 · The `Extra` column: the tuning goldmine

**🔧 Code-specifics.**
```sql
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42 ORDER BY created_at DESC;
--   Extra: Using filesort   → sort with no index (M04/4.13) — TARGET
--   Extra: Using temporary  → temp table (GROUP BY/DISTINCT) — TARGET
--   Extra: Using index      → COVERING (M05/5.6) — the GOAL
-- Fix filesort by providing the order via an index:
ALTER TABLE ledger_entry ADD KEY ix_acct_created (account_id, created_at);  -- filesort gone
```

**⚠️ Failure modes & gotchas.**
- **`Using filesort` / `Using temporary`** on hot queries → spill to disk (M04/4.13).
- **Bumping `sort_buffer_size`** instead of indexing the sort away — delays the cliff, costs RAM.
- **`SELECT *` defeating** a would-be covering index (no `Using index`).

**💰 Fintech lens.** A high-volume account's statement filesorting to disk is a latency spike on a core screen — the `(account_id, created_at)` index removes it (M05/5.10), and covering `amount` upgrades it to `Using index`.

**🎯 Interview / SD angle.** Read `Extra` second (after `type`). "Biggest wins often = eliminating a blocking op, not the access path." `Using index` good, `Using filesort`/`Using temporary` bad, `Using where` informational.

**✅ Self-check.**
1. Which `Extra` flags are the top tuning targets, and why?
2. Which `Extra` flag is the *goal* for hot reads?
3. Why is "bigger sort buffer" a poor primary fix?

---

## 6.5 · Row estimates, `filtered`, and cost

**🔧 Code-specifics.**
```sql
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42;   -- rows: 30 (ESTIMATE), filtered: 100%
EXPLAIN ANALYZE SELECT ... ;                              -- actual rows=10,000,000 → BIG gap
-- Big gap → fix the inputs:
ANALYZE TABLE ledger_entry;                               -- refresh stale stats
ANALYZE TABLE ledger_entry UPDATE HISTOGRAM ON status_code WITH 16 BUCKETS;  -- skew
SHOW INDEX FROM ledger_entry;                             -- inspect cardinality the optimizer sees
```

**⚠️ Failure modes & gotchas.**
- **Stale stats after growth** → wrong `rows` → wrong plan (the #1 regression cause, 6.15).
- **Skewed/correlated columns** → estimate assumes uniformity/independence → mis-estimate.
- **Treating a bad plan as an index problem** when it's a *statistics* problem.

**💰 Fintech lens.** The forever-growing ledger needs fresh stats or a reconciliation query's estimate goes stale and the optimizer flips to a full scan — a stability/availability risk (6.15).

**🎯 Interview / SD angle.** "A cost-based decision is only as good as its estimates — the estimate-vs-actual gap is your diagnostic." Distinguish the "optimizer was misled" class (fix stats) from "missing index" class (fix index).

**✅ Self-check.**
1. What do `rows` and `filtered` represent?
2. What does a big estimate-vs-actual gap point to?
3. Three causes of a wrong estimate and their fixes.

---

## 6.6 · EXPLAIN ANALYZE & FORMAT=TREE: plan vs reality

**🔧 Code-specifics.**
```sql
EXPLAIN FORMAT=TREE SELECT ... ;     -- operator tree (structure), no run
EXPLAIN ANALYZE SELECT ... ;         -- RUNS it; per-operator actual time / rows / loops
--   '-> Index lookup on e ... (actual time=0.05..0.05 rows=29 loops=350000)'
--      high LOOPS = large driving set / missing index (6.8/6.9)
--      actual rows ≫ estimated rows = stale stats (6.5)
```

**⚠️ Failure modes & gotchas.**
- **`EXPLAIN ANALYZE` RUNS the query** — careful on writes / huge scans (side effects, full cost).
- **Reading estimates as truth** when a plan looks fine but is slow — use ANALYZE for actuals.
- **Missing the hotspot** — the dominant operator is `actual time × loops`, not where you assumed.

**💰 Fintech lens.** ANALYZE pinpoints *which* operator makes a reconciliation/join slow (e.g., 350k inner loops) — turning "the report is slow" into a precise fix.

**🎯 Interview / SD angle.** "Estimates predict; measurement confirms." Plain EXPLAIN (cheap, estimates) → EXPLAIN ANALYZE (truth, runs it) → trace (why). `loops` and estimate-vs-actual are the key reads. 8.0 features.

**✅ Self-check.**
1. What does EXPLAIN ANALYZE add over EXPLAIN, and what's the cost?
2. What does a high `loops` count on the inner table indicate?
3. When do you escalate from EXPLAIN to ANALYZE?

---

## 6.7 · The optimizer trace: why it chose this plan

**🔧 Code-specifics.**
```sql
SET optimizer_trace = 'enabled=on';
SELECT ... ;   -- run the query you want to understand
SELECT trace FROM information_schema.optimizer_trace\G   -- JSON: considered plans, costs, rejections
SET optimizer_trace = 'enabled=off';
-- reveals e.g. it estimated your index would match 40% of rows → costed scan cheaper
```

**⚠️ Failure modes & gotchas.**
- **Reaching for the trace too early** — most problems are solved by `type`/`Extra` + an index.
- **Verbose JSON** — know what to look for (the rejected index's cost/selectivity estimate).
- **Concluding "optimizer bug"** when it's a stats problem the trace actually reveals.

**💰 Fintech lens.** When a money query inexplicably skips its index, the trace tells you whether it's a stats problem (fix cleanly with `ANALYZE TABLE`) or an optimizer limitation (rewrite/hint) — so you don't pin a critical query with a brittle hint unnecessarily.

**🎯 Interview / SD angle.** "EXPLAIN says *what*; the trace says *why* — the considered alternatives and their costs." The last rung of the ladder (type/Extra → ANALYZE → trace). Usually reveals a wrong *input* (stat) drove the wrong *output*.

**✅ Self-check.**
1. What does the optimizer trace show that EXPLAIN doesn't?
2. When do you reach for it?
3. What does it usually reveal as the root cause of a surprising plan?

---

*Enrichment for 6.1–6.7 complete. Next Pass D file: 6.8–6.11.*
