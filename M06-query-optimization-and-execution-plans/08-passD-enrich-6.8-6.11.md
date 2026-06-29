# M06 · Pass D — Enrichment · Concepts 6.8–6.11

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-joins-and-rewrites.md` + `05-passC-…`. Domain: payments/wallet.

---

## 6.8 · Join algorithms in depth: nested-loop, BNL, hash

**🔧 Code-specifics.**
```sql
-- Index the inner join column → enables fast index nested-loop:
ALTER TABLE ledger_entry ADD KEY ix_account (account_id);
EXPLAIN FORMAT=TREE SELECT * FROM account a JOIN ledger_entry e
  ON e.account_id=a.account_id WHERE a.status_code=1;
--   '-> Nested loop ... -> Index lookup on e using ix_account (e.account_id=a.account_id)'  ✓ NLJ
--   '-> Hash join'  → 8.0 fallback for unindexed equi-joins (fine for big analytical joins)
--   'Using join buffer (Block Nested Loop)'  → index the join column!
```

**⚠️ Failure modes & gotchas.**
- **Unindexed inner join column** → quadratic NLJ or whole-table hash/BNL scan.
- **Expecting hash join for non-equi-joins** — it's equi-joins only.
- **Hash join spilling** on very large inputs (memory pressure).

**💰 Fintech lens.** `account → ledger_entry` joins are fast only if `ledger_entry.account_id` is indexed (index NLJ); otherwise they degrade as the ledger grows. Index join columns to keep normalization's join cost (M02/2.1) affordable.

**🎯 Interview / SD angle.** Index NLJ (great with indexed inner), hash join (8.0+, large unindexed equi-joins), BNL (mostly obsolete). Read the algorithm in EXPLAIN; the lever you control is **index the join column**. Drive from the small/selective side (6.9).

**✅ Self-check.**
1. When is index nested-loop fast vs catastrophic?
2. What did hash join (8.0.18) improve, and its limitation?
3. What EXPLAIN signal says "index the join column"?

---

## 6.9 · Join order & the driving table

**🔧 Code-specifics.**
```sql
-- EXPLAIN row order = join order (first row = driving table); ANALYZE loops = probe counts:
EXPLAIN SELECT * FROM account a JOIN ledger_entry e ON e.account_id=a.account_id WHERE a.status_code=1;
-- bad order is usually a STATS problem first:
ANALYZE TABLE account, ledger_entry;
-- force order only as last resort:
SELECT /*+ JOIN_ORDER(a, e) */ ... ;   -- or STRAIGHT_JOIN
```

**⚠️ Failure modes & gotchas.**
- **Driving from the huge table** → multiplies work by orders of magnitude.
- **Forcing order before fixing stats** — the optimizer usually orders right with fresh stats.
- **Mis-estimate of post-filter size** → wrong driving table.

**💰 Fintech lens.** The `account`(filtered)→`ledger_entry` join *must* drive from `account` (a few thousand rows), not the billion-row ledger. Seeing it drive from the ledger in EXPLAIN is the bug.

**🎯 Interview / SD angle.** "Drive from the most selective/smallest-after-filtering side → small intermediates." Read order in EXPLAIN row order + ANALYZE `loops`. Fix bad order with stats first, `STRAIGHT_JOIN` last.

**✅ Self-check.**
1. Why does driving-table choice multiply through the join?
2. How do you read the chosen join order?
3. What's the first fix for a wrong join order (not forcing it)?

---

## 6.10 · Subqueries, derived tables & CTEs

**🔧 Code-specifics.**
```sql
-- Correlated subquery (may not flatten) → rewrite as a join:
-- SELECT * FROM account a WHERE EXISTS (SELECT 1 FROM ledger_entry e WHERE e.account_id=a.account_id AND e.amount>10000);
SELECT DISTINCT a.* FROM account a
JOIN ledger_entry e ON e.account_id=a.account_id WHERE e.amount>10000;   -- index NLJ (6.8)
-- CTE (8.0): merged or materialized — verify with EXPLAIN (look for DERIVED/MATERIALIZED):
WITH big AS (SELECT account_id FROM ledger_entry WHERE amount>10000) SELECT * FROM account JOIN big USING(account_id);
```

**⚠️ Failure modes & gotchas.**
- **Correlated subquery not flattened** → per-row re-evaluation (`DEPENDENT SUBQUERY`).
- **Derived table/CTE materialized** (un-indexed temp table) when merging would let an index apply.
- **Assuming all forms plan identically** — verify, don't assume.

**💰 Fintech lens.** "Accounts with any large entry" written as a correlated `EXISTS` vs a join — EXPLAIN tells you which the optimizer runs efficiently; rewrite to the form it handles well.

**🎯 Interview / SD angle.** "Logical equivalence ≠ equal execution." Modern MySQL flattens many IN/EXISTS (semi-joins) — but verify. Classic win: correlated subquery → join. CTEs add readability (`WITH RECURSIVE` for hierarchies); watch materialization.

**✅ Self-check.**
1. Why rewrite a correlated subquery as a join?
2. Merged vs materialized derived table/CTE — which is usually better?
3. Does modern MySQL flatten IN/EXISTS automatically?

---

## 6.11 · Sorting & grouping at scale (filesort/temp deep dive)

**🔧 Code-specifics.**
```sql
EXPLAIN SELECT DATE(created_at) d, SUM(amount) FROM ledger_entry WHERE ... GROUP BY d;
--   Extra: Using temporary; Using filesort  → spills to disk on large ranges (M04/4.13)
-- FIX hierarchy: 1) eliminate via index/summary table, 2) shrink set, 3) keep in memory
--   (1) maintain a summary table (M02/2.14) — don't recompute live:
--       settlement_totals(settle_date, currency, total)  ← updated incrementally
SHOW VARIABLES LIKE 'tmp_table_size';   -- in-memory threshold (per-connection)
```

**⚠️ Failure modes & gotchas.**
- **`Using filesort` / `Using temporary`** spilling to disk on large GROUP BY/ORDER BY.
- **`GROUP BY DATE(col)`** (non-sargable, 6.13) prevents an index from grouping directly.
- **Oversizing buffers** as the primary fix — delays the cliff, costs RAM × connections.

**💰 Fintech lens.** Daily settlement totals shouldn't be recomputed live over a growing ledger — maintain a summary table (M02/2.14), eliminating the temp table + filesort entirely. Statement ordering served by `(account_id, created_at)`.

**🎯 Interview / SD angle.** Tuning hierarchy: **eliminate (index/summary) > shrink set > keep in memory**. "The cheapest sort is the one you designed away." Distinguish fixable (indexable order) from intrinsic (computed-expression) sorts.

**✅ Self-check.**
1. What's the tuning hierarchy for a blocking sort/group?
2. Why is a summary table often the real fix for live aggregation?
3. What makes a sort *un*-indexable (intrinsic)?

---

*Enrichment for 6.8–6.11 complete. Next Pass D file: 6.12–6.16.*
