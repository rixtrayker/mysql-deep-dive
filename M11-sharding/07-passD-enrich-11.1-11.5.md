# M11 · Pass D — Enrichment · Concepts 11.1–11.5

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL/config appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-scaling-partitioning-sharding-intro.md` + `04-passC-…`. Domain: payments/wallet, the ledger.

---

## 11.1 · Scaling up vs out; read vs write scaling

**🔧 Code-specifics.**
```sql
-- read scaling = replicas (M10) + read/write split (route SELECTs to replicas):
-- (ProxySQL rule) ^SELECT → replica hostgroup;  writes → primary hostgroup
-- write scaling = sharding (no single-server knob) — see 11.5
-- vertical first: bigger buffer pool is the highest-leverage single tuning:
SET GLOBAL innodb_buffer_pool_size = 100 * 1024*1024*1024;   -- ~most of RAM (M09)
SHOW ENGINE INNODB STATUS\G   -- watch write pressure: log waits, dirty-page %, checkpoint age
```

**⚠️ Failure modes & gotchas.**
- **Adding replicas to a write-bound system** — does nothing (each replica *also* applies every write); the classic expensive mistake.
- **Sharding when read-bound** — needless distributed complexity; replicas were the answer.
- **Skipping vertical scaling** — a bigger box buys huge runway far cheaper than distribution.

**💰 Fintech lens.** Most fintech write volumes fit one well-tuned primary + read-replicas for a *long* time. Reserve sharding (the one-way door) for genuine write/storage limits; ride vertical + replicas first.

**🎯 Interview / SD angle.** "Replicas DUPLICATE (scale reads, not writes); sharding DIVIDES (scales writes/storage). Diagnose the bottleneck — read/write/storage — then apply the matching tool. Scale up before out; shard last." Universal capacity planning.

**✅ Self-check.**
1. Why don't replicas scale writes?
2. What's the order of reach (up → ? → ?), and why shard last?
3. Read-bound vs write-bound — which tool each?

---

## 11.2 · Partitioning: splitting a table within one server

**🔧 Code-specifics.**
```sql
-- range-partition the ledger history by month (retention + pruning):
CREATE TABLE ledger_entry (
  entry_id BINARY(16), created_month INT, account_id BIGINT, amount_minor BIGINT, /* … */
  PRIMARY KEY (entry_id, created_month)               -- PK MUST include the partition col (11.4)
) PARTITION BY RANGE (created_month) (
  PARTITION p2026_01 VALUES LESS THAN (202602),
  PARTITION p2026_02 VALUES LESS THAN (202603) /* … */ );
ALTER TABLE ledger_entry DROP PARTITION p2018_06;     -- instant retention (vs a DELETE storm)
EXPLAIN SELECT … WHERE created_month = 202602;        -- check the 'partitions' column → pruned
```
> `amount_minor BIGINT` = money in integer minor units (never FLOAT/DOUBLE).

**⚠️ Failure modes & gotchas.**
- **DELETE-storm retention** on a huge unpartitioned table (undo/redo flood, locks, fragmentation) — `DROP PARTITION` instead.
- **Querying without the partition column** → all-partition scan (no pruning).
- **Expecting write-scaling** — partitioning is one server; it scales nothing.

**💰 Fintech lens.** The immutable ledger history is the prime partition candidate — **range-by-month** for instant regulatory retention (`DROP PARTITION`) + time-range pruning. The accounts/balances table is *not* (point-queried, FK-related).

**🎯 Interview / SD angle.** "Partitioning = intra-node organization (retention-by-drop, pruning), NOT scaling. Different from sharding (inter-node, capacity)." Name the distinction explicitly.

**✅ Self-check.**
1. Why is `DROP PARTITION` vastly better than `DELETE` for retention?
2. Why does partitioning give zero write-scaling?
3. Which ledger table fits partitioning, which doesn't?

---

## 11.3 · Partitioning types & pruning (range/list/hash/key)

**🔧 Code-specifics.**
```sql
PARTITION BY RANGE (TO_DAYS(created_at)) (…)   -- time-series: prune by range + drop oldest
PARTITION BY LIST (region_code) (PARTITION eu VALUES IN (1,2,3), …)   -- categorical
PARTITION BY HASH (account_id) PARTITIONS 8;   -- EVEN spread, but ✗ no range pruning
PARTITION BY KEY (uuid_col) PARTITIONS 8;      -- like HASH, MySQL hash (non-int/multi-col)
EXPLAIN … ;   -- the 'partitions' column shows which were touched (verify pruning)
```

**⚠️ Failure modes & gotchas.**
- **HASH-partitioning time-series** → range queries can't prune (scatter all partitions).
- **RANGE on a monotonic key** → newest partition is a write hotspot.
- **Assuming pruning happens** — verify with `EXPLAIN partitions`; a non-partition-key filter scans all.

**💰 Fintech lens.** Ledger history → **RANGE by time** (queries are time-bounded, retention is age-based) despite the newest-partition hotspot. HASH only fits a table needing pure even spread with no range queries (rare for us).

**🎯 Interview / SD angle.** "RANGE/LIST = order-locality (prune + retention, but hotspots); HASH/KEY = even spread (no hotspot, but no range pruning). The same order-vs-spread tradeoff reappears in sharding (11.7)." Deep recurring choice.

**✅ Self-check.**
1. Why can't HASH-partitioned data prune a range query?
2. RANGE's pruning win vs its hotspot cost?
3. How do you verify pruning actually happens?

---

## 11.4 · Partitioning limits & gotchas

**🔧 Code-specifics.**
```sql
-- ① unique keys (incl. PK) MUST contain the partition column:
PRIMARY KEY (entry_id, created_month)     -- ✓   PRIMARY KEY (entry_id)  -- ✗ rejected
-- ② NO foreign keys on partitioned tables (enforce referential integrity in the app)
-- ③ non-partition-key filter → ALL-partition scan:
EXPLAIN SELECT … WHERE account_id = ?;    -- partitioned by month → scans every partition
```

**⚠️ Failure modes & gotchas.**
- **The unique-key rule** forces an unnatural PK (`(id, month)`), surprising teams.
- **No FKs** — referential integrity silently moves to the app (easy to forget → orphans).
- **All-partition scans** make a partitioned table *slower* than an unpartitioned indexed one for non-partition-key queries.

**💰 Fintech lens.** Partition the **history** (`(entry_id, created_month)` PK acceptable, append-only, no FKs needed). *Don't* partition **accounts/balances** (needs a natural PK + FKs + point queries). These limits are sharding's constraints in miniature — global uniqueness/cross-split FK/cross-split txn all break once data is split.

**🎯 Interview / SD angle.** "Partitioning enforces constraints LOCALLY per partition → global uniqueness must align with the partition key, FKs are gone, and it never adds capacity. The same constraints sharding imposes harshly across nodes." Learn the pain here.

**✅ Self-check.**
1. Why must every unique key contain the partition column?
2. Why no foreign keys, and what's the consequence?
3. How do these limits preview sharding's?

---

## 11.5 · Sharding: splitting data across servers ★

**🔧 Code-specifics.**
```sql
-- MySQL has NO built-in sharding. Two paths:
-- (A) application-level: app computes shard = scheme(shard_key) and connects to that server
-- (B) Vitess (the production answer): VSchema defines keyspaces + vindexes (shard-key → shard)
--     vtgate routes; each shard = a normal MySQL primary+replicas running the SAME schema
-- within a shard, EVERYTHING is normal single-node InnoDB: BEGIN…COMMIT is ACID (M07–M09)
SELECT … WHERE tenant_id = ?;   -- keyed → routes to ONE shard (fast, ACID)
```

**⚠️ Failure modes & gotchas.**
- **Cross-shard transactions** lose single-node ACID (11.11) — *the* money risk.
- **Non-shard-key queries** scatter-gather to all shards (11.10).
- **The shard-key bet** is near-irreversible (11.14); **ops multiply** (N servers × replicas).
- **Sharding prematurely** — eating permanent complexity before you need it.

**💰 Fintech lens.** Shard the ledger by `account_id`/`tenant_id` so each shard owns a disjoint slice; a transfer between co-located accounts stays single-shard ACID (11.9); each shard is replicated (M10) for HA + reporting offload (M02/2.17). Shard last, design for single-shard money ops.

**🎯 Interview / SD angle.** "Sharding DIVIDES the dataset across nodes by a key — scales writes/storage ~linearly, at the cost of any operation spanning slices (cross-shard txns/queries, global constraints, resharding). Design = minimize cross-slice ops via co-location (11.9)." Universal horizontal partitioning.

**✅ Self-check.**
1. Why does sharding scale writes where replication can't?
2. What does sharding cost (the cross-slice tax)?
3. Within a shard, what guarantees still hold?

---

*Enrichment for 11.1–11.5 complete. Next Pass D file: 11.6–11.10.*
