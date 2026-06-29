# M05 · Pass D — Enrichment · Concepts 5.15–5.18

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-when-indexes-hurt-methodology-integrity-capstone.md` + `06-passC-…`. Domain: payments/wallet. These close out M05.

---

## 5.15 · When indexes hurt: write amplification & page splits ★

**🔧 Code-specifics.**
```sql
-- Monotonic PK appends cleanly (no splits); random PK splits pages:
PRIMARY KEY (transaction_id)               -- BIGINT AUTO_INCREMENT → right-edge append ✓
-- ❌ PRIMARY KEY (uuid_v4_col)             -- random → mid-page inserts → splits
-- Time-ordered UUID as BINARY(16) keeps locality (M03/3.12):
INSERT INTO t (id) VALUES (UUID_TO_BIN(UUID(), 1));   -- swap_flag=1 → time-sortable
-- Defragment split-bloat (maintenance, M13):
OPTIMIZE TABLE ledger_entry;
-- Each index is maintained per write → minimize index count (5.16).
```

**⚠️ Failure modes & gotchas.**
- **Random UUIDv4 PK** → clustered-index page splits, fragmentation, choked writes (M03/3.12) — the canonical anti-pattern.
- **Over-indexing** → write amplification (~N+1 B+Tree ops per insert) drowns write throughput.
- **Many secondary indexes on a write-hot table** — each adds per-insert cost.

**💰 Fintech lens.** The forever-growing `ledger_entry` is the hottest write target. A compact monotonic/time-ordered PK (no splits) + a minimal index set (low write amplification) is what lets it sustain high write throughput for years. A random PK or over-indexing progressively chokes it.

**🎯 Interview / SD angle.** Two costs: **write amplification** (N indexes → ~N+1 maintenance ops/write) and **page splits** (random keys insert mid-page → half-empty pages, fragmentation). Why monotonic keys + minimal indexes matter. The append-vs-insert-in-middle distinction is fundamental (logs/LSM-trees).

**✅ Self-check.**
1. What two distinct costs make indexes "hurt"?
2. Why does a random PK cause page splits but a monotonic one doesn't?
3. How does index count affect write throughput?

---

## 5.16 · Index design methodology: choosing the fewest, best indexes

**🔧 Code-specifics.**
```sql
-- VERIFY each important query uses the intended index:
EXPLAIN SELECT amount FROM ledger_entry WHERE account_id=42 AND created_at>='2025-06-01' ORDER BY created_at;
-- FIND unused indexes (write cost for no benefit):
SELECT * FROM sys.schema_unused_indexes WHERE object_schema = DATABASE();
-- REDUNDANT: (account_id) is redundant if (account_id, created_at) exists (leftmost-prefix, 5.7):
ALTER TABLE ledger_entry ALTER INDEX ix_account INVISIBLE;   -- test-drop safely (5.13)
DROP INDEX ix_account ON ledger_entry;                       -- once confirmed
```

**⚠️ Failure modes & gotchas.**
- **Over-indexing** (an index per query) → write/storage cost (5.15).
- **Redundant indexes** — `(a)` when `(a,b)` exists — nobody dares drop them.
- **Indexing by guess, not by measured access patterns** → missing *and* useless indexes.

**💰 Fintech lens.** The methodology produces the ledger's lean set (5.18): clustered PK for statements, covering for hot reads, UNIQUE for idempotency — nothing redundant — keeping write amplification minimal on the high-volume ledger.

**🎯 Interview / SD angle.** The loop: **enumerate access patterns → design composite/covering indexes for query families → check selectivity → verify with EXPLAIN → prune unused/redundant → iterate.** "Fewest indexes that make the important queries fast." Tools: `sys.schema_unused_indexes`, invisible indexes, EXPLAIN.

**✅ Self-check.**
1. Outline the index-design methodology steps.
2. How do you find unused and redundant indexes?
3. Why is "fewest, best" the goal rather than "index everything queried"?

---

## 5.17 · Indexes as integrity: UNIQUE indexes & constraints

**🔧 Code-specifics.**
```sql
-- UNIQUE index = fast lookup + enforced invariant (idempotency, M16):
ALTER TABLE transaction_ ADD UNIQUE KEY uq_idem (idempotency_key);
-- Atomic check-and-insert; retry is rejected/deduped (closes the check-then-insert race):
INSERT INTO transaction_ (idempotency_key, ...) VALUES ('abc-123', ...)
  ON DUPLICATE KEY UPDATE transaction_id = transaction_id;   -- idempotent no-op on retry
-- ⚠ multiple NULLs allowed in UNIQUE (M01/1.7) → use NOT NULL for keys that must be unique.
```

**⚠️ Failure modes & gotchas.**
- **Application-level "check then insert"** for uniqueness → racy under concurrency (duplicates slip through, M07/M08).
- **Multiple NULLs allowed** in a UNIQUE index → nullable UNIQUE isn't single-occupancy for NULL.
- **Hot unique key** → enforcement adds locking/contention (M08).

**💰 Fintech lens (★).** The idempotency-key UNIQUE index makes double-posting a transfer **structurally impossible** — a retry with the same key is rejected/deduped — *and* gives instant "find by idempotency key" lookups. Performance + money-never-lies integrity from one index (M16).

**🎯 Interview / SD angle.** "A UNIQUE index is an access path *and* an enforced invariant — the atomic check-and-insert closes the race that app-level uniqueness can't." The canonical fintech use is **idempotency**. Mention the NULL gotcha. Top system-design point.

**✅ Self-check.**
1. What two roles does a UNIQUE index play at once?
2. Why is app-level "check then insert" racy, and how does UNIQUE fix it?
3. What's the NULL gotcha with UNIQUE indexes?

---

## 5.18 · Fintech capstone — indexing the ledger ★

**🔧 Code-specifics.**
```sql
-- The complete, justified index set (each earns its place):
CREATE TABLE ledger_entry (
  account_id BIGINT UNSIGNED NOT NULL, created_at DATETIME(6) NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL, line_no INT NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (account_id, created_at, transaction_id, line_no),  -- clustered: statement locality (5.4)
  KEY ix_txn (transaction_id)                                     -- only because "all legs" is hot (5.16)
) ENGINE=InnoDB;
CREATE INDEX ix_cover ON ledger_entry (account_id, created_at, amount);  -- cover hot reads (5.6)
ALTER TABLE transaction_ ADD UNIQUE KEY uq_idem (idempotency_key);       -- idempotency (5.17)
-- ✗ no standalone (account_id) — redundant via leftmost-prefix (5.7/5.16)
```

**⚠️ Failure modes & gotchas.**
- **Random UUID PK** → page splits choke ledger writes (5.15/M03·3.12).
- **Over-indexing the ledger** → write amplification kills throughput.
- **Under-indexing** → statements/reconciliation full-scan billions of rows.
- **Money as FLOAT** in a covering index → inexact sums (M03/3.4).

**💰 Fintech lens (★).** A deliberate, minimal index set keeps the ledger **fast for reads** (statements/reconciliation), **cheap for writes** (no splits, low amplification), and **correct** (UNIQUE idempotency) — *simultaneously*, as it grows to billions of rows. The synthesis of M01/1.14 + M03/3.12 + this module.

**🎯 Interview / SD angle.** "Design the minimal index set that makes dominant access patterns fast and invariants enforced, on a compact append-friendly key layout." Walk the ledger's indexes and justify each by an access pattern. This is the input to M06 (tune), M07/M08 (transact/lock), M09 (buffer pool), M16 (shard).

**✅ Self-check.**
1. Justify each index on `ledger_entry` / `transaction_`.
2. Which index is dropped as redundant, and why?
3. How does this set scale in reads, writes, and correctness together?

---

*Enrichment for 5.15–5.18 complete. **M05 Pass D is fully drafted (all 18 concepts) — M05 is now content-complete across Passes A–D.***
