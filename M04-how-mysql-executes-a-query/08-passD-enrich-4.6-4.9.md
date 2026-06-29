# M04 · Pass D — Enrichment · Concepts 4.6–4.9

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-the-optimizer.md` + `05-passC-…`. Domain: payments/wallet. (Deep EXPLAIN/index/join tuning is M05/M06.)

---

## 4.6 · The query optimizer: choosing among plans ★

**🔧 Code-specifics.**
```sql
-- See the chosen plan; FORMAT=TREE shows the operator tree:
EXPLAIN FORMAT=TREE SELECT * FROM account a JOIN ledger_entry e
  ON e.account_id = a.account_id WHERE a.status_code = 1;
-- See WHY it chose that plan (cost numbers, rejected alternatives):
SET optimizer_trace = 'enabled=on';
SELECT * FROM account WHERE account_id = 42;
SELECT * FROM information_schema.optimizer_trace;
SET optimizer_trace = 'enabled=off';
-- Override only when the optimizer is wrong (sparingly, M06): index hints / optimizer hints
SELECT /*+ INDEX(e ix_acct_created) */ ... ;
```

**⚠️ Failure modes & gotchas.**
- **Fighting the optimizer with hints** instead of fixing inputs (indexes/stats) → brittle, breaks as data changes.
- **Assuming the plan is optimal** — it's the cheapest *by estimate*, not provably best.
- **Complex subqueries/many-table joins** — historically weaker spots; verify with EXPLAIN.

**💰 Fintech lens.** A ledger join that picks the wrong driving table degrades catastrophically as the ledger grows; you keep the good plan available (index join columns) and estimable (fresh stats), not by hinting every query.

**🎯 Interview / SD angle.** The optimizer is **cost-based**: enumerate equivalent plans → estimate → pick cheapest. "You shape the decision (indexes/stats/hints), you don't command the plan." Mention optimizer trace and that hints are a last resort.

**✅ Self-check.**
1. What does the optimizer actually search over, and how does it choose?
2. Why prefer fixing indexes/stats over hints?
3. What does `optimizer_trace` show you?

---

## 4.7 · The cost model & statistics

**🔧 Code-specifics.**
```sql
-- Refresh stale statistics (the usual fix for a sudden bad plan):
ANALYZE TABLE ledger_entry;
-- Build a histogram for a skewed / non-indexed column (8.0):
ANALYZE TABLE ledger_entry UPDATE HISTOGRAM ON status_code WITH 16 BUCKETS;
-- Inspect cardinality the optimizer sees:
SHOW INDEX FROM ledger_entry;                       -- Cardinality column per index
SELECT * FROM information_schema.statistics WHERE table_name='ledger_entry';
SHOW VARIABLES LIKE 'innodb_stats_persistent%';     -- persisted stats + sample pages
```

**⚠️ Failure modes & gotchas.**
- **Stale stats after bulk load/growth** → full scan chosen over an index (the classic regression).
- **Skewed data** → simple cardinality misleads; needs histograms.
- **Correlated columns** → optimizer assumes independence, mis-estimates combined selectivity.

**💰 Fintech lens.** The forever-growing ledger needs fresh stats or reconciliation queries suddenly scan billions of rows — a stale-stats full scan can stall the system (a money-never-lies-adjacent stability risk). Schedule `ANALYZE TABLE` after big loads.

**🎯 Interview / SD angle.** "The optimizer is only as smart as its statistics." Diagnostic instinct: **surprising plan → suspect inputs (stats) before logic.** Know `ANALYZE TABLE`, histograms (8.0), and selectivity from cardinality.

**✅ Self-check.**
1. Why does a query get slow without any code/index change?
2. What does `ANALYZE TABLE` fix, and when do you run it?
3. When do histograms help where plain cardinality doesn't?

---

## 4.8 · Access paths: how a single table is read ★

**🔧 Code-specifics.**
```sql
-- The access path shows up in EXPLAIN 'type' (and Extra). Compare with/without an index:
EXPLAIN SELECT amount FROM ledger_entry WHERE account_id=42 AND created_at>='2025-06-01';
--   type=ALL              → full scan (no useful index)          ❌
--   type=ref              → index lookup on account_id            ✅
--   type=range + Extra 'Using index condition' → range scan       ✅
--   Extra 'Using index'   → COVERING index (answered w/o row fetch) ✅✅
-- Create the index that turns ALL → range:
ALTER TABLE ledger_entry ADD KEY ix_acct_created (account_id, created_at);
```

**⚠️ Failure modes & gotchas.**
- **`type: ALL`** (full scan) on a large table — usually a missing index.
- **Index not used** because it's low-selectivity (matches most rows) — sometimes correct (scan is cheaper).
- **Non-covering secondary index** costs an extra clustered-index fetch per row (M01/1.3) — covering avoids it.

**💰 Fintech lens.** "Account 42's recent entries" must be a `range`/`ref` on `(account_id, created_at)` (M01/1.14), not `ALL` over a billion-row ledger. The right access path is what keeps the ledger queryable as it grows.

**🎯 Interview / SD angle.** Name the ladder: **const/eq_ref → ref → range → covering → ALL**, mapped to EXPLAIN `type`. Selectivity decides which wins; covering indexes skip the row fetch. This is the conceptual seed of M05/M06.

**✅ Self-check.**
1. Order the access paths best→worst and map to EXPLAIN `type`.
2. Why might the optimizer correctly *skip* an index?
3. What makes a covering index special?

---

## 4.9 · Join execution strategies

**🔧 Code-specifics.**
```sql
-- Index the join column so the optimizer can use index nested-loop (ref/eq_ref):
ALTER TABLE ledger_entry ADD KEY ix_account (account_id);   -- enables cheap NLJ from account
EXPLAIN FORMAT=TREE SELECT * FROM account a JOIN ledger_entry e
  ON e.account_id = a.account_id WHERE a.status_code = 1;
--   '-> Nested loop ... Index lookup on e using ix_account'  ✅
--   '-> Hash join'  → 8.0 fallback for unindexed equi-joins (better than unindexed NLJ)
-- Join ORDER is the row order in tabular EXPLAIN; drive from the most selective/smallest side.
```

**⚠️ Failure modes & gotchas.**
- **Unindexed join column** → quadratic nested-loop (or hash join scanning the whole table).
- **Wrong driving table** (driving from the huge side) → orders-of-magnitude worse.
- **Hash join needs memory** — can spill on very large inputs.

**💰 Fintech lens.** `account` → `ledger_entry` joins are fast *only* if `ledger_entry.account_id` is indexed; otherwise they degrade badly as the ledger grows. Index join columns to keep normalization's "pay with joins" cost (M02/2.1) affordable.

**🎯 Interview / SD angle.** Know **index nested-loop** (great with an indexed inner), **hash join** (8.0+, large unindexed equi-joins), and **join order** (drive from the selective side). The lever you control: **index the join columns** (M05). Deep mechanics → M06.

**✅ Self-check.**
1. When is nested-loop efficient vs catastrophic?
2. What did hash join (8.0) improve?
3. What's the main lever you control over join performance?

---

*Enrichment for 4.6–4.9 complete. Next Pass D file: 4.10–4.16.*
