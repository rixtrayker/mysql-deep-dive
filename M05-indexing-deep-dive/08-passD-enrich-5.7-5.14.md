# M05 · Pass D — Enrichment · Concepts 5.7–5.14

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-design-levers-and-toolbox.md` + `05-passC-…`. Domain: payments/wallet.

---

## 5.7 · Composite indexes & the leftmost-prefix rule ★

**🔧 Code-specifics.**
```sql
CREATE INDEX ix_acct_created ON ledger_entry (account_id, created_at);
-- Serves leading-prefix queries:
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42;                         -- ✓ ref
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42 AND created_at>='2025-06-01'; -- ✓ range
-- Does NOT serve a non-leading subset:
EXPLAIN SELECT * FROM ledger_entry WHERE created_at>='2025-06-01';              -- ✗ key=NULL, type=ALL
```

**⚠️ Failure modes & gotchas.**
- **Querying a non-leading column alone** → index unusable → full scan (the #1 "why isn't my index used?").
- **A gap in the prefix** (`a` and `c` but not `b` on `(a,b,c)`) → only `a` used for seeking, `c` filtered.
- **Assuming one index serves any column subset** — only *leading prefixes*.

**💰 Fintech lens.** `(account_id, created_at)` is the ledger workhorse: one index serves "this account," "this account in a date range," and "this account ordered by date" — three patterns, one index — because of leftmost-prefix. "All entries in June across accounts" needs a different design.

**🎯 Interview / SD angle.** Explain leftmost-prefix as a consequence of **lexicographic sort order** (phone book by last,first). One composite index serves a *family* of prefix queries — the foundation of minimal index sets (5.16). Knowing it's not arbitrary (it's sort-order) is the signal.

**✅ Self-check.**
1. Which queries can `(a, b, c)` serve, and which can't it?
2. Why is the rule a consequence of lexicographic ordering, not an arbitrary limit?
3. What happens with a gap in the prefix?

---

## 5.8 · Column order in composite indexes (the design decision)

**🔧 Code-specifics.**
```sql
-- Equality column first, range/sort column last (+ covering col at the end):
CREATE INDEX ix_good ON ledger_entry (account_id, created_at, amount);
EXPLAIN SELECT amount FROM ledger_entry
WHERE account_id=42 AND created_at>='2025-06-01' ORDER BY created_at;  -- ✓ range, Using index, no filesort
-- WRONG order for the same query:
CREATE INDEX ix_bad ON ledger_entry (created_at, account_id);          -- ✗ leading range can't seek account_id
```

**⚠️ Failure modes & gotchas.**
- **Range/sort column before equality column** → index can't seek the equality column → poor plan + filesort.
- **Once a range is used, later columns can't be seeked** (only filtered) — keep the range last.
- **One index can't lead with two different columns** — sometimes a second index is needed.

**💰 Fintech lens.** `(account_id, created_at)` (equality → range/sort) serves the ledger's hot statement query with no filesort; the reverse order would scatter the account's rows and force a sort. Column order is the highest-leverage index-design choice on the ledger.

**🎯 Interview / SD angle.** The heuristic: **equality columns first, then the single range/sort column last**, then covering columns. Be able to justify it from leftmost-prefix (5.7) + "a range uses up seekability." Walking a query to its correct index order is a classic exercise.

**✅ Self-check.**
1. State the equality/range column-order heuristic and why it works.
2. Why must the range column come last among seekable columns?
3. For `WHERE a=? AND b>=? ORDER BY b`, what's the index?

---

## 5.9 · Selectivity & cardinality: when an index helps

**🔧 Code-specifics.**
```sql
SHOW INDEX FROM ledger_entry;            -- Cardinality column (estimated distinct values)
ANALYZE TABLE ledger_entry;              -- refresh stale cardinality (M04/4.7)
-- High selectivity → index used; low → often skipped:
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42;     -- high-card → ref ✓
EXPLAIN SELECT * FROM account WHERE status_code=1;          -- low-card → often ALL (scan)
-- Histogram helps for SKEWED columns (rare values selective):
ANALYZE TABLE account UPDATE HISTOGRAM ON status_code WITH 16 BUCKETS;
```

**⚠️ Failure modes & gotchas.**
- **Indexing low-cardinality columns standalone** → optimizer ignores it (wasted write cost).
- **Stale cardinality** → wrong index decisions (`ANALYZE TABLE`, M04/4.7).
- **Confusion that "my index isn't used"** — often correct (non-selective).

**💰 Fintech lens.** Index `account_id`, `transaction_id`, `idempotency_key` (high selectivity); don't bother indexing `status_code` alone. But low-card columns can still ride in a *composite* or *covering* index where they add value (5.6/5.7).

**🎯 Interview / SD angle.** "An index helps in proportion to how much it narrows the search." Define cardinality vs selectivity; explain *why* a low-selectivity index loses to a scan (many bookmark lookups, 5.5). Mention covering/composite/histogram rescues. Information-theoretic framing is a plus.

**✅ Self-check.**
1. Cardinality vs selectivity — define both.
2. Why might the optimizer correctly ignore an index?
3. Three ways a low-cardinality column can still earn an index.

---

## 5.10 · Index-only ordering & grouping (killing filesort/temp)

**🔧 Code-specifics.**
```sql
-- An index in the ORDER BY order eliminates the sort step:
CREATE INDEX ix_acct_created ON ledger_entry (account_id, created_at);
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42 ORDER BY created_at;       -- no "Using filesort"
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42 ORDER BY created_at DESC;  -- backward scan, still no filesort
-- WITHOUT the matching index:
-- ... ORDER BY created_at  → Extra: "Using filesort" (spills to disk on large results, M04/4.13)
```

**⚠️ Failure modes & gotchas.**
- **`Using filesort` / `Using temporary`** on hot queries → blocking ops that spill to disk (M04/4.13).
- **Bumping `sort_buffer_size`** just delays the cliff — the fix is an ordered index.
- **Mixed-direction sort** needs a descending index (5.13), not a normal one.

**💰 Fintech lens.** "Account's entries newest-first" must read from `(account_id, created_at)` in order — no filesort. A high-volume account's statement spilling to disk is a latency spike on a core screen.

**🎯 Interview / SD angle.** "Indexes deliver rows *pre-sorted* — an `ORDER BY`/`GROUP BY` matching index order eliminates the filesort/temp table (M04/4.13)." The cheapest sort is the one you avoided. Reason the sort column belongs in the composite index (5.8).

**✅ Self-check.**
1. How does an index eliminate a filesort?
2. Why is "bigger sort buffer" a poor primary fix?
3. What does an index do for `GROUP BY`?

---

## 5.11 · Prefix indexes (indexing part of a long column)

**🔧 Code-specifics.**
```sql
-- Index the first N chars of a long string:
CREATE INDEX ix_ref ON transaction_ (external_reference(12));
-- Choose N: smallest length capturing most selectivity
SELECT COUNT(DISTINCT LEFT(external_reference,8))  / COUNT(*) AS sel8,
       COUNT(DISTINCT LEFT(external_reference,12)) / COUNT(*) AS sel12,
       COUNT(DISTINCT external_reference)          / COUNT(*) AS selFull
FROM transaction_;
-- TEXT/BLOB can ONLY be prefix-indexed (M03/3.7):  KEY ix_note (note(50))
```

**⚠️ Failure modes & gotchas.**
- **N too short** → low selectivity, many rechecks, optimizer may skip it.
- **Prefix index can't COVER** (5.6) or fully **ORDER BY** the column (prefix order ≠ full order).
- **Forgetting TEXT/BLOB require a prefix length** (else error).

**💰 Fintech lens.** A long `external_reference` looked up by a selective prefix → prefix index (small, fast). But a fixed-length `idempotency_key` is indexed in full (it must be a covering UNIQUE for exact-match dedup, 5.17) — never prefix it.

**🎯 Interview / SD angle.** "Index a discriminating prefix → most selectivity at a fraction of the size; recheck the full value on candidates." Know the N-choosing recipe (`COUNT(DISTINCT LEFT(...))`) and the limits (no covering, no full sort). TEXT/BLOB *must* be prefix-indexed.

**✅ Self-check.**
1. How do you choose the prefix length?
2. What two capabilities does a prefix index lose?
3. Which columns *must* be prefix-indexed?

---

## 5.12 · Functional & expression indexes

**🔧 Code-specifics.**
```sql
-- BEST: rewrite to sargable (no special index needed):
SELECT * FROM ledger_entry WHERE created_at >= '2025-06-01' AND created_at < '2025-07-01';
-- Else functional index (8.0) or generated-column index (5.7+):
CREATE INDEX ix_day ON ledger_entry ((DATE(created_at)));            -- functional (8.0)
ALTER TABLE account ADD COLUMN tier VARCHAR(16) AS (metadata->>'$.tier') STORED, ADD KEY ix_tier (tier);  -- JSON (M03/3.11)
-- The query expression must MATCH the indexed expression.
```

**⚠️ Failure modes & gotchas.**
- **Wrapping an indexed column in a function** (`DATE(created_at)`, `YEAR(...)`) → non-sargable → full scan.
- **Query expr ≠ indexed expr** → index silently unused.
- **Non-deterministic expression** → not indexable.

**💰 Fintech lens.** The canonical use is indexing a **JSON-extracted** attribute (M03/3.11) — keep flexible metadata in JSON, promote a queried path to an indexed typed column. But never bury core money fields in JSON (M03/3.11).

**🎯 Interview / SD angle.** Define **sargability**: a predicate uses an index only if expressed in terms of the indexed value. Fix non-sargable predicates by *rewriting* (preferred) or a *functional index*. JSON indexing is the headline use. "Don't wrap an indexed column in a function" is a classic trap.

**✅ Self-check.**
1. Why does `WHERE DATE(created_at)='...'` not use a `(created_at)` index?
2. Two ways to fix it — which is preferred?
3. How do functional indexes enable JSON queryability?

---

## 5.13 · Descending & invisible indexes (and other modern options)

**🔧 Code-specifics.**
```sql
-- Descending index for MIXED-direction sorts (8.0):
CREATE INDEX ix_mixed ON ledger_entry (created_at DESC, amount ASC);
EXPLAIN SELECT * FROM ledger_entry ORDER BY created_at DESC, amount ASC;   -- no filesort
-- Invisible index: test a drop SAFELY (still maintained, optimizer ignores it):
ALTER TABLE ledger_entry ALTER INDEX ix_old INVISIBLE;   -- monitor for regressions
-- ALTER TABLE ledger_entry ALTER INDEX ix_old VISIBLE;  -- instant revert
-- DROP INDEX ix_old ON ledger_entry;                    -- once confirmed unused
```

**⚠️ Failure modes & gotchas.**
- **Mixed-direction `ORDER BY`** isn't served by a single ascending index → filesort (needs descending index).
- **Invisible ≠ free** — it's still maintained (write cost); it's a *test* state, then drop.
- **Dropping a still-needed index** without testing → instant full scans in prod.

**💰 Fintech lens.** A "newest first, then amount ascending" report needs a descending index; and when pruning the ledger's index set on a live system (5.16), invisible indexes are how you *safely* confirm an index is unused before dropping it.

**🎯 Interview / SD angle.** Descending indexes serve mixed-direction sorts (a single ASC index can't). Invisible indexes = reversible test-before-drop (same de-risking instinct as feature flags / soft-delete). Both are MySQL 8 safe-evolution tools (with online DDL, M13).

**✅ Self-check.**
1. When do you need a descending index (vs a backward scan)?
2. What does an invisible index let you test, and is it still maintained?
3. Why test a drop before doing it?

---

## 5.14 · Other index types: hash, fulltext, spatial, adaptive hash

**🔧 Code-specifics.**
```sql
-- Fulltext for word/relevance search (NOT LIKE '%term%'):
ALTER TABLE transaction_ ADD FULLTEXT INDEX ft_desc (description);
SELECT * FROM transaction_ WHERE MATCH(description) AGAINST('refund' IN NATURAL LANGUAGE MODE);
-- Spatial (R-tree) for geometry:  ALTER TABLE t ADD SPATIAL INDEX(geom);
-- Hash index: MEMORY engine's native type (InnoDB uses B+Trees; emulate via hashed gen-col).
-- Adaptive hash index (automatic, on by default):
SHOW VARIABLES LIKE 'innodb_adaptive_hash_index';
```

**⚠️ Failure modes & gotchas.**
- **`LIKE '%term%'`** (leading wildcard) → can't use a B+Tree index → full scan; use fulltext.
- **Expecting ranges/ordering from a hash index** — it does exact-match only.
- **Adaptive hash index contention** on some workloads → occasionally disabled (M09).

**💰 Fintech lens.** Searching transaction descriptions/notes is a *fulltext* job, not a `LIKE` scan. The ledger itself lives on B+Trees; the adaptive hash index silently accelerates hot account/PK lookups.

**🎯 Interview / SD angle.** "Match the index structure to the query shape": B+Tree (default — equality+ranges+ordering), hash (exact-only), fulltext (text search), spatial (geo). Know `LIKE '%x%'` can't use an index and the adaptive hash index is automatic. B+Tree by default.

**✅ Self-check.**
1. Why can't `LIKE '%term%'` use a normal index, and what should you use?
2. What can a hash index NOT do that a B+Tree can?
3. What does the adaptive hash index do, and do you create it?

---

*Enrichment for 5.7–5.14 complete. Next Pass D file: 5.15–5.18.*
