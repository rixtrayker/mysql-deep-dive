# M05 · Pass D — Enrichment · Concepts 5.1–5.6

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-structural-foundation.md` (Pass B) and `04-passC-…` (Pass C, with ★ SVGs). Domain: payments/wallet.

---

## 5.1 · What an index is (and the core tradeoff)

**🔧 Code-specifics.**
```sql
-- Add an index (the read win); it's maintained on every write (the cost):
CREATE INDEX ix_account ON ledger_entry (account_id);
-- or at table creation:  KEY ix_account (account_id)
-- Inspect what indexes exist + their estimated cardinality (5.9):
SHOW INDEX FROM ledger_entry;
-- Verify the optimizer actually uses it (M04/4.15, M06):
EXPLAIN SELECT * FROM ledger_entry WHERE account_id = 42;   -- type: ref (not ALL)
```

**⚠️ Failure modes & gotchas.**
- **Indexing reflexively** ("slow → add an index") without measuring → accumulates write cost (5.15).
- **No index on a hot WHERE/JOIN column** → full scans that worsen as data grows.
- **Forgetting indexes cost writes + storage + buffer pool** — not free read magic.

**💰 Fintech lens.** On the billion-row `ledger_entry`, the difference between an index lookup and a full scan on `account_id` is milliseconds vs minutes — and it *stays* fast as the ledger grows. But every index taxes the hottest write path; spend deliberately.

**🎯 Interview / SD angle.** Lead with the **tradeoff**: indexes speed some reads but slow *every* write and cost storage/cache. "Indexing = choosing where to spend → fewest, best indexes (5.16)." Frame any index as a bet that its read benefit beats its write/storage cost.

**✅ Self-check.**
1. What does an index cost, and when is it paid?
2. Why does a full scan get worse over time but an index lookup barely changes?
3. State the core indexing tradeoff in one sentence.

---

## 5.2 · The B+Tree: the structure behind almost every index ★

**🔧 Code-specifics.**
```sql
-- MySQL/InnoDB indexes are B+Trees by default (no type needed):
CREATE INDEX ix_acct_created ON ledger_entry (account_id, created_at);
-- A B+Tree serves BOTH point lookups and ranges (its two superpowers):
EXPLAIN SELECT * FROM ledger_entry WHERE account_id = 42;                       -- point (ref)
EXPLAIN SELECT * FROM ledger_entry WHERE account_id = 42 AND created_at >= '2025-06-01'; -- range
-- (No user syntax "exposes" the tree; the structure explains WHY these are fast.)
```

**⚠️ Failure modes & gotchas.**
- **Expecting a hash-index property** (O(1)) from a B+Tree, or ranges from a hash (5.14) — wrong structure for the query shape.
- **Random-order inserts** degrade the B+Tree via page splits (5.15) — B+Trees love monotonic keys.

**💰 Fintech lens.** A 3–4 level B+Tree indexes billions of `ledger_entry` rows in a few page reads — and its linked sorted leaves are *why* an account's statement (a range) is a fast sequential walk, the dominant ledger access pattern (M01/1.14).

**🎯 Interview / SD angle.** Be able to explain **why** a B+Tree gives O(log n) lookups *and* efficient ranges: balanced + high fanout (shallow → few I/Os) + **sorted, linked leaves** (ranges walk sequentially). This one structure explains nearly every indexing rule — a top-tier signal.

**✅ Self-check.**
1. What two operations does a B+Tree serve well, and which structural property enables each?
2. Why is a B+Tree shallow even for billions of rows?
3. Why do linked leaves matter for range scans?

---

## 5.3 · Pages: the unit of index (and table) storage ★

**🔧 Code-specifics.**
```sql
SELECT @@innodb_page_size;                 -- 16384 (16KB) — the I/O & cache unit
-- Compact key = more keys/page = shallower tree (M03/3.2, 3.12):
--   BIGINT (8 bytes)   → high fanout ✓
--   CHAR(36) UUID      → ~4× fewer keys/page ✗  → store as BINARY(16):
ALTER TABLE account ADD COLUMN public_id BINARY(16);   -- not CHAR(36)
-- See table/index footprint (fewer pages = better cache fit):
SELECT table_name, ROUND((data_length+index_length)/1048576) mb
FROM information_schema.tables WHERE table_schema=DATABASE();
```

**⚠️ Failure modes & gotchas.**
- **Fat keys** (CHAR(36) UUID, oversized types) → fewer keys/page → deeper tree, bigger index, worse buffer-pool fit.
- **Fat rows in the clustered index** (big columns inline) → fewer rows/page (push off-page, M03/3.14).

**💰 Fintech lens.** The page is the I/O unit, so compact keys on the ledger mean more keys per page → shallower trees → more of the index in the buffer pool → fewer disk reads. Highest-leverage, zero-effort optimization: just pick compact types (M03/3.2).

**🎯 Interview / SD angle.** Connect type size → fanout → tree height → I/O count. "Fanout = page_size ÷ key_size; smaller keys = shallower, smaller, more cache-resident." This is the mechanism *behind* M03/3.12's "BINARY(16) not CHAR(36)."

**✅ Self-check.**
1. What sets a B+Tree's fanout, and why does fanout matter?
2. Why does key size affect buffer-pool hit rate?
3. What's the page size, and what is the page the unit of?

---

## 5.4 · Clustered index: the table IS its primary-key B+Tree ★

**🔧 Code-specifics.**
```sql
-- The PK defines the physical layout; shape it for the dominant query (M01/1.14):
CREATE TABLE ledger_entry (
  account_id     BIGINT NOT NULL,
  created_at     DATETIME(6) NOT NULL,
  transaction_id BIGINT NOT NULL,
  line_no        INT NOT NULL,
  amount         DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (account_id, created_at, transaction_id, line_no)   -- clustered: rows stored in THIS order
) ENGINE=InnoDB;
-- PK lookup returns the row directly (no second hop) — cheapest path (M04/4.8):
EXPLAIN SELECT * FROM ledger_entry WHERE account_id=42 AND created_at='2025-06-01 ...';  -- const/eq_ref
```

**⚠️ Failure modes & gotchas.**
- **No explicit PK** → InnoDB invents a hidden rowid you can't use; you lose clustering control.
- **Random PK (UUIDv4)** → inserts scatter → page splits (5.15).
- **Fat PK** → embedded in every secondary index → bloats them all (5.5, M03/3.12).

**💰 Fintech lens.** Clustering `ledger_entry` on `(account_id, created_at)` physically groups each account's history in time order → statements are sequential reads. This single choice is the biggest structural win for the dominant ledger pattern (M01/1.14).

**🎯 Interview / SD angle.** "In InnoDB the table *is* the PK B+Tree — leaves hold the rows." So PK choice = physical layout = (a) PK lookups have no extra hop, (b) PK-range scans are sequential, (c) PK is in every secondary index. Drives "compact, monotonic, query-shaped PK."

**✅ Self-check.**
1. Where do the rows physically live in InnoDB?
2. Why is a PK lookup cheaper than a secondary-index lookup?
3. Why does PK choice affect every secondary index?

---

## 5.5 · Secondary indexes: pointers back to the clustered index ★

**🔧 Code-specifics.**
```sql
-- A secondary index; its leaves store (indexed cols + PK), not the row:
CREATE INDEX ix_txn ON ledger_entry (transaction_id);
-- Non-covering lookup = secondary descent + a bookmark lookup per row into the clustered index:
EXPLAIN SELECT * FROM ledger_entry WHERE transaction_id = 700;   -- ref, then per-row row fetch
-- Keep the PK compact — it's the "pointer" stored in EVERY secondary index (5.4, M03/3.12).
```

**⚠️ Failure modes & gotchas.**
- **Many-row secondary lookups** → many random bookmark fetches; can be slower than a scan (optimizer may skip it, 5.9).
- **Fat PK** inflates every secondary index (it's the bookmark).
- **Assuming a secondary index is "free"** — it's a second hop unless covering (5.6).

**💰 Fintech lens.** A `(transaction_id)` index on `ledger_entry` makes "all legs of a transaction" fast — but each match still hops to the clustered index for the row. For hot reads, prefer a covering index (5.6) to kill the hop.

**🎯 Interview / SD angle.** "Secondary leaf = indexed columns + **PK** (not a physical pointer)." So a lookup is two B+Tree descents, the PK is the bookmark (and is in every secondary index), and the logical-PK bookmark survives row movement (page splits). The hop motivates covering indexes.

**✅ Self-check.**
1. What's stored in a secondary index's leaf?
2. Why is a secondary lookup two steps?
3. Why does InnoDB store the PK rather than a physical row pointer?

---

## 5.6 · Covering indexes: answering from the index alone ★

**🔧 Code-specifics.**
```sql
-- Cover a hot read by including its SELECTed columns → skip the row fetch:
CREATE INDEX ix_cover ON ledger_entry (account_id, created_at, amount);
-- Now this is answered FROM THE INDEX — EXPLAIN shows "Using index":
EXPLAIN SELECT amount FROM ledger_entry
WHERE account_id = 42 AND created_at >= '2025-06-01' ORDER BY created_at;
--   Extra: Using index   (no clustered-index access, no filesort — also serves the sort, 5.10)
```

**⚠️ Failure modes & gotchas.**
- **Over-widening every index to cover** → big indexes, high write cost (5.15) — cover only HOT reads.
- **`SELECT *` defeats covering** — you can't cover every column; select only what you need.
- **A column in WHERE/ORDER BY/SELECT not in the index** → falls back to bookmark lookups.

**💰 Fintech lens.** The dominant balance/statement reads on the ledger become pure index-only reads (`Using index`) when the composite index covers `amount` — often an order-of-magnitude win on a query run millions of times. Cornerstone of the ledger read design (5.18).

**🎯 Interview / SD angle.** Covering = "all columns the query touches are in one index → answer from the index leaf, skip the bookmark hop (5.5)." The biggest single read optimization; EXPLAIN `Using index`. Tradeoff: wider index (write/storage) — cover hot reads only. High-signal, frequently tested.

**✅ Self-check.**
1. What makes an index "covering" for a query?
2. What EXPLAIN flag confirms it, and what cost does it eliminate?
3. Why not just make every index cover everything?

---

*Enrichment for 5.1–5.6 complete. Next Pass D file: 5.7–5.14.*
