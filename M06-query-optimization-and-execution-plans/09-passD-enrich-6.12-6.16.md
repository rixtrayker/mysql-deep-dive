# M06 · Pass D — Enrichment · Concepts 6.12–6.16

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-toolkit-antipatterns-pagination-stability-capstone.md` + `06-passC-…`. Domain: payments/wallet. These close out M06 (and the M04–M06 performance arc).

---

## 6.12 · Optimizer & index hints (and when to use them)

**🔧 Code-specifics.**
```sql
-- Fix inputs FIRST (preferred): ANALYZE TABLE / add index / rewrite. Hint = last resort:
SELECT /*+ INDEX(ledger_entry ix_acct_created) */ ... ;   -- 8.0 optimizer hint
SELECT * FROM ledger_entry FORCE INDEX (ix_acct_created) WHERE ... ;  -- classic index hint
SELECT /*+ JOIN_ORDER(a, e) */ ... ;        -- force join order (or STRAIGHT_JOIN)
SELECT /*+ MAX_EXECUTION_TIME(1000) */ ... ; -- cap a runaway query (ms)
-- re-EXPLAIN to confirm the hint took.
```

**⚠️ Failure modes & gotchas.**
- **Hinting instead of fixing inputs** (stats/index/rewrite) → brittle.
- **A hint that becomes wrong** as data/optimizer change → silent regression (6.15).
- **Undocumented hints** — nobody knows why they exist or when to remove them.

**💰 Fintech lens.** A money query forced with a hint is a *stability liability* — prefer a designed index + fresh stats so the optimizer naturally chooses right. If you must hint a critical query, document why and monitor it.

**🎯 Interview / SD angle.** "Fix the inputs the optimizer reasons from before overriding its output." Hints trade adaptivity for control and are brittle. Last rung of the loop. Know `FORCE INDEX`, `STRAIGHT_JOIN`, `/*+ … */` (8.0).

**✅ Self-check.**
1. What should you try before a hint, in order?
2. Why are hints brittle?
3. When is a hint genuinely justified?

---

## 6.13 · Query anti-patterns & their fixes ★

**🔧 Code-specifics.**
```sql
-- ❌ non-sargable (function on column) → ✅ sargable range:
-- WHERE DATE(created_at) = '2025-06-01'
WHERE created_at >= '2025-06-01' AND created_at < '2025-07-01';
-- ❌ implicit conversion (string col vs number) → ✅ match types:
-- WHERE idempotency_key = 12345        -- col-side conversion → full scan
WHERE idempotency_key = '12345';
-- ❌ leading wildcard → ✅ anchored or fulltext (M05/5.14):
-- WHERE description LIKE '%refund%'
WHERE MATCH(description) AGAINST('refund' IN NATURAL LANGUAGE MODE);
-- ❌ SELECT * (defeats covering) → ✅ select only needed columns
-- ❌ N+1 → ✅ one JOIN or IN(...) batch
```

**⚠️ Failure modes & gotchas.**
- **Implicit conversion** (indexed VARCHAR vs numeric literal) → *silent* full scan.
- **`SELECT *`** defeats covering indexes (M05/5.6) and bloats rows/network.
- **`LIKE '%x%'`** can't use a B+Tree index (leading wildcard).
- **N+1** shows as many fast queries in the slow log, not one slow one.

**💰 Fintech lens.** The implicit-conversion trap on an idempotency/account lookup turns an instant `const` query into a table scan under load. N+1 fetching each account's latest entry → one join.

**🎯 Interview / SD angle.** Unifying theme: **sargability** — write predicates the engine can seek on. Recognize the catalog by sight (N+1, SELECT *, non-sargable, leading wildcard, implicit conversion, deep OFFSET) + each fix. Code-review/interview staple (M14 = scannable triage).

**✅ Self-check.**
1. What is sargability, and which anti-patterns break it?
2. Why is implicit type conversion especially dangerous?
3. How does `SELECT *` hurt beyond extra columns?

---

## 6.14 · Pagination & large result sets

**🔧 Code-specifics.**
```sql
-- ❌ deep OFFSET — scans + discards a million rows:
SELECT * FROM ledger_entry WHERE account_id=42 ORDER BY created_at DESC LIMIT 20 OFFSET 1000000;
-- ✅ keyset / seek — index seek straight to the page (O(1) per page):
SELECT * FROM ledger_entry
WHERE account_id=42 AND (created_at, id) < (:last_created_at, :last_id)   -- unique tiebreaker
ORDER BY created_at DESC, id DESC LIMIT 20;
```

**⚠️ Failure modes & gotchas.**
- **Deep `OFFSET`** is O(offset) — fine shallow, collapses deep; EXPLAIN won't flag it (rows-read ≫ returned).
- **Keyset without a unique tiebreaker** → skipped/duplicated rows at page boundaries.
- **Keyset can't jump to an arbitrary page** (next/prev only).

**💰 Fintech lens.** A million-row statement export *must* use keyset — `OFFSET 1000000` scans a million ledger entries per page. The `(account_id, created_at, id)` clustering (M05/5.4) makes keyset a fast seek.

**🎯 Interview / SD angle.** "Seek to the position via the ordered index; don't scan-and-discard." OFFSET (arbitrary jumps, shallow) vs keyset (constant-time, deep, no random page, needs unique sort). Classic scalable-feed SD question.

**✅ Self-check.**
1. Why does deep `OFFSET` get slow?
2. How does keyset stay constant-time?
3. Why does keyset need a unique tiebreaker?

---

## 6.15 · Plan stability: why a fast query suddenly gets slow

**🔧 Code-specifics.**
```sql
-- Detect: find queries whose latency jumped (perf_schema, M13):
SELECT digest_text, count_star, avg_timer_wait/1e9 avg_ms
FROM performance_schema.events_statements_summary_by_digest ORDER BY avg_timer_wait DESC LIMIT 20;
-- Root-cause + fix the most common cause (stale stats after growth):
EXPLAIN ANALYZE SELECT ... ;        -- estimate-vs-actual gap?
ANALYZE TABLE ledger_entry;         -- refresh → re-EXPLAIN, plan returns
-- prevent: schedule ANALYZE after bulk loads; histograms for skew
```

**⚠️ Failure modes & gotchas.**
- **Stale stats + data growth** → optimizer flips to a full scan (the #1 cause).
- **Set-and-forget tuning** — plans regress silently as data changes.
- **No regression monitoring** — you find out when users complain.

**💰 Fintech lens.** A reconciliation query silently regressing to a full scan over a billion-row ledger can stall the system and delay the books — money-never-lies-adjacent. Monitor + keep stats fresh.

**🎯 Interview / SD angle.** "Performance achieved ≠ performance maintained." Causes: stale stats/growth, skew, parameter sensitivity, version/threshold flips. Detect via slow log/perf_schema, fix with `ANALYZE TABLE`/histograms, pin critical queries if needed. Bridges to M13/M14.

**✅ Self-check.**
1. Why can a query regress with no code change?
2. What's the most common cause and its fix?
3. How do you detect a regression?

---

## 6.16 · Fintech capstone — tuning the ledger's hot queries ★

**🔧 Code-specifics.**
```sql
-- STATEMENT: range + covering + no filesort + keyset (6.14):
EXPLAIN SELECT amount FROM ledger_entry
WHERE account_id=42 AND (created_at,id) < (:last,:lastid)
ORDER BY created_at DESC, id DESC LIMIT 20;     -- type=range, key=ix_acct_created, Using index
-- BALANCE: const PK lookup on summary table (M02/2.14):
EXPLAIN SELECT balance FROM account WHERE account_id=42;          -- const
-- RECONCILIATION: index-served, on a REPLICA (M10), stats kept fresh (6.15):
ANALYZE TABLE ledger_entry;
-- IDEMPOTENCY: const on UNIQUE index, matching types (6.13):
EXPLAIN SELECT * FROM transaction_ WHERE idempotency_key='abc';   -- const
```

**⚠️ Failure modes & gotchas.**
- **Statement filesorting** on a hot account (missing/incomplete index).
- **Reconciliation regressing** to a full scan (stale stats, 6.15).
- **Deep-OFFSET statement export** scanning millions (use keyset, 6.14).
- **Idempotency lookup implicit conversion** → silent scan (6.13).

**💰 Fintech lens (★).** A payments platform lives or dies by whether statement/balance/reconciliation/idempotency queries are fast *and stay fast under growth*. Synthesis of M04 (plan) + M05 (indexes) + M06 (read & tune) + operational layer (keyset, fresh stats, replica offload).

**🎯 Interview / SD angle.** "Identify critical queries, instrument them, tune to fast paths, monitor for regression." Walk the four money queries with expected EXPLAIN signatures (range+Using index / const / index-served / const). The exact query set M16 keeps fast across shards.

**✅ Self-check.**
1. Expected EXPLAIN signature for each of the four money queries?
2. Which one carries the plan-stability risk, and why?
3. How does this capstone synthesize M04 + M05 + M06?

---

*Enrichment for 6.12–6.16 complete. **M06 Pass D is fully drafted (all 16 concepts) — M06 is now content-complete across Passes A–D, completing the M04–M06 performance arc.***
