# M14 · Pass B — Guides 14.8–14.16 · Lost-Data, Durability, Scale, Distributed, Anti-Patterns, Sizing, Tool-Fit & Master Sheet

> **Pass B scope (reference module):** for each guide — **purpose**, **the decision logic**, **what it distills**, and the **fintech angle**. No new theory. Diagrams are Pass C.
>
> Running domain: payments/wallet, the ledger. The recurring check: *did money get lost or duplicated, and is this decision money-safe?*

---

## 14.8 · "I think I lost data" triage tree ★

**Purpose.** The *incident runbook* for suspected data loss — the money-safe response, and the **entry point to M15**. Distills **M09/M10/M12/M13** and routes to M15.

**The decision logic (the steps — in order, under pressure).**
1. **CONTAIN first (stop the bleeding).** *Before* investigating: stop *further* loss/corruption. Halt the offending process/deploy (if a bad migration/script is running, *stop it*); if a node is corrupting/diverging, *fence it* (M10/10.11 — never let a split-brain keep writing); freeze writes to the affected scope if needed. **Containment before diagnosis** — an ongoing incident gets worse while you investigate.
2. **Assess the blast radius.** *What* is lost/wrong, *how much*, *since when*, and *is it still spreading*? Which tables/accounts/shards? A logical error (bad `DELETE`/`UPDATE`)? Corruption (checksum failures)? A failover data-loss window (M10/10.10)? A half-completed Saga (M12/12.8)? Use **reconciliation** (M12/12.14) to *quantify* (balance ≠ Σ entries → exactly which accounts).
3. **Choose the recovery path** (routes to M15):
   - **A logical error** (bad statement) → **PITR** (M13/13.3 — restore + replay binlog to just before the bad statement). → M15.
   - **Node loss** → **failover** to a replica (M10/10.10) — but check the data-loss window (semi-sync, M10).
   - **Corruption** → restore from a tested backup (M13/13.5) + PITR; `innodb_force_recovery` levels (M15) only as a last resort to *extract* data.
   - **A distributed inconsistency** (half-Saga, dual-write loss) → compensate/reconcile (M12).
4. **Recover**, then **VERIFY** (M12/12.14 — reconcile the recovered data: balance = Σ entries, internal = external — *prove* correctness, don't assume).
5. **Post-mortem** — root cause, prevent recurrence (the early-warning signal that would've caught it, 13.11; the tested restore that should've existed, 13.5).

**What it distills.** M09 (crash recovery), M10 (failover, the loss window), M12 (reconciliation, distributed inconsistency), M13 (PITR, backups) — and it's the *fast decision* that routes to **M15's detailed handling**.

**Fintech angle (★).** For money, the order is sacred: **contain → assess → recover → VERIFY (reconcile)**. The verify step (reconcile against the immutable ledger + external records) is non-negotiable — "recovered" without reconciliation isn't recovered. This tree is *the* money-incident runbook.

---

## 14.9 · The durability config matrix

**Purpose.** For each `innodb_flush_log_at_trx_commit` × `sync_binlog` combination — *exactly what you lose on a crash* and the throughput. Distills **M09**.

**The decision logic (the matrix).**
- **`innodb_flush_log_at_trx_commit`**: **1** = fsync the redo log every commit (fully durable — no committed transaction lost on crash); **2** = write to OS cache every commit, fsync ~every second (lose ~1s of commits on an *OS/power* crash, not a mysqld crash); **0** = write + fsync ~every second (lose ~1s on a *mysqld* crash too). 
- **`sync_binlog`**: **1** = fsync the binlog every commit (no binlog loss → safe PITR/replication); **0** = let the OS flush (lose recent binlog events on crash → PITR/replica gaps); **N** = fsync every N commits.
- **The money combination**: **`flush_log_at_trx_commit=1` + `sync_binlog=1`** = *full durability* (no committed transfer lost, binlog safe for PITR/replication) — **the money settings** (M09/9.10), at a throughput cost (mitigated by **group commit**, M09/9.11). Any weaker combo trades *correctness* (data-at-risk on crash) for throughput — *unacceptable for money*.
- The matrix gives, per combo: *what you lose on a mysqld crash, on an OS/power crash, and the relative throughput* — so you choose with eyes open.

**What it distills.** M09 (the durability chain, the two settings, group commit, the exact data-at-risk per combo).

**Fintech angle.** Money = **1/1, always** (no committed transfer may be lost). The matrix exists so nobody sets `=2`/`=0` for "speed" and silently risks losing transfers (a money-never-lies violation, M09). These are *correctness* settings (M13/13.13).

---

## 14.10 · Replication mode + RPO/RTO quick-pick

**Purpose.** Pick async vs semi-sync vs group replication + the backup/failover choices, *from RPO/RTO*. Distills **M10/M13**.

**The decision logic.**
- **By RPO** (data-loss tolerance, M13/13.4): **RPO≈0** → **semi-sync** (M10/10.4 — committed transfer durable on a replica immediately) + continuous durable binlog for PITR (M13/13.3). **RPO = seconds-tolerable** → async replication (simpler, faster). **Strong consistency needed** → group replication (M10/10.9, CP).
- **By RTO** (downtime tolerance, M13/13.4): **RTO≈seconds** → automated fenced failover to a hot standby (M10/10.10–10.13). **RTO≈minutes** → fast physical/snapshot restore (M13/13.2). 
- **The money quick-pick**: **semi-sync + GTID + automated fenced failover + tested PITR** (M10 + M13) = RPO≈0 + fast RTO + recoverable-from-logical-disasters. Plus: **monitor semi-sync status** (M10/10.12 — it silently degrades) and **ROW binlog format** (M10/10.3 — no divergence).

**What it distills.** M10 (sync modes, GTID, failover) + M13 (RPO/RTO, backup/PITR).

**Fintech angle.** The payments quick-pick is fixed: **ROW + GTID + semi-sync(monitored) + automated fenced failover + sync_binlog=1 + tested PITR**. RPO≈0, fast RTO, no forked ledger.

---

## 14.11 · Scale decision: partition vs replica vs shard

**Purpose.** "One box isn't enough" → *diagnose the bottleneck → the right tool*. Distills **M11/M13**.

**The decision logic.**
1. **Vertical headroom left?** → scale up first (bigger box, more RAM/buffer pool — M09/M13). Cheapest. Ride it far.
2. **Read-bound?** (reads saturate, writes fine) → **read-replicas** (M10) + read/write routing + caching. *Don't shard.*
3. **One huge table, retention/range needs, not write-bound?** → **partition** (M11/11.2 — range-by-time, drop-retention + pruning). *Not* scaling.
4. **Write-/storage-bound past the biggest box** (vertical + replicas exhausted)? → **shard** (M11/11.5) — derive the shard key from the access pattern (co-locate transfers, M11/11.6/11.9), hash/consistent-hashing (M11/11.7/11.8), routing layer (Vitess, M11/11.13). Each shard itself replicated (M10).
5. **Compose**: sharded (write scale) × replicated-per-shard (read+HA) × partitioned-within (retention).
- **The rule**: **shard last, shard reluctantly** (M11/11.15) — its complexity is a one-way door.

**What it distills.** M11 (scaling up/out, partition vs shard vs replica, shard key, the decision) + M13 (diagnosing the bottleneck).

**Fintech angle.** Most fintech write volumes fit one tuned box + replicas a *long* way. Shard the ledger only at genuine write/storage limits — and then by tenant/account to keep transfers single-shard ACID (M11/11.9).

---

## 14.12 · Distributed-pattern quick-pick

**Purpose.** A cross-node operation? → *the right pattern*. Distills **M12**.

**The decision logic.** Match the distributed problem to the pattern:
- **A cross-node transaction must be atomic** → first **avoid it** (co-locate, M11/11.9 — make it single-shard ACID); if unavoidable → **Saga** (M12/12.8 — local txns + compensations; *never* fragile 2PC/XA, M12/12.6/12.7).
- **A retryable operation must not double-apply** → **idempotency key** (M12/12.9 — the load-bearing primitive; unique constraint atomic with the effect).
- **Save state AND notify another system** → **outbox** (M12/12.11 — event in the same txn as the state; *never* dual-write, M12/12.10).
- **Propagate changes to other systems** → **CDC** (M12/12.12 — Debezium reads the binlog → Kafka; no dual-writes).
- **Messages may be delivered twice** → **idempotent consumers** (M12/12.13 — at-least-once + idempotent = exactly-once effect).
- **Need to detect/repair any distributed inconsistency** → **reconciliation** (M12/12.14 — re-derive from the immutable ledger; the backstop).
- **What consistency for this read/write?** → **per-operation** (M12/12.15 — strong+atomic for money, eventual+idempotent+reconciled for propagation).

**What it distills.** M12 (the whole distributed-patterns toolkit).

**Fintech angle.** The money flows compose these: co-locate transfers (single-shard ACID) → Saga for cross-shard → idempotency everywhere → outbox/CDC for propagation → reconciliation backstop. *Avoid* the distributed surface; handle the rest rigorously.

---

## 14.13 · The anti-pattern catalog ★

**Purpose.** The recurring mistakes across the whole journey → *the fix for each*. Distills **M01–M13**.

**The decision logic (the catalog — mistake → fix, grouped).**
- **Modeling/types (M01–M03)**: **FLOAT/DOUBLE for money** → `DECIMAL` or integer minor units (`*_minor BIGINT`). **`UUID()` v4 as clustered PK** → ULID/UUIDv7/Snowflake (time-ordered, M11/11.12). **Storing UUIDs as `CHAR(36)`** → `BINARY(16)`. **Reserved word `transaction`** → `transaction_`.
- **Indexing/queries (M05/M06)**: **`SELECT *`** → select only needed columns (enables covering). **N+1 queries** → a join. **Leading wildcard `LIKE '%x'`** → can't use the index (full-text or restructure). **Function on a column** (`WHERE DATE(col)=…`) → defeats the index; rewrite as a range. **Implicit type conversion** → defeats the index; match types. **Missing index on a hot filter** / **over-indexing a write-heavy table**.
- **Transactions/locking (M07/M08)**: **long-running transactions** → keep short (HLL bloat, lock contention). **Inconsistent lock ordering** → canonical order (deadlocks). **Naive DDL on a huge table** → online DDL (M13/13.6). **DDL during long queries** → MDL stall.
- **Durability/replication (M09/M10)**: **`flush_log_at_trx_commit=2`/`sync_binlog=0` for money** → 1/1. **STATEMENT binlog format** → ROW (no divergence). **Reading money-decision data off a lagging replica** → primary (stale-read double-spend). **Failover without fencing** → split-brain.
- **Distributed (M12)**: **dual-write (DB + queue)** → outbox/CDC. **No idempotency on retryable ops** → idempotency keys. **Cross-shard 2PC/XA** → Saga. **Eventual consistency for money without reconciliation** → reconcile.
- **Operations (M13)**: **untested backups** → tested restore drills. **No early-warning monitoring** → watch lag/HLL/checkpoint-age/disk/semi-sync. **Cargo-cult config** → tune the few that matter, measure. **Shared superuser / `root` in apps** → least privilege.

**What it distills.** Every "failure modes & gotchas" across M01–M13.

**Fintech angle (★).** The money-critical anti-patterns (FLOAT money, stale-replica money read, weak durability config, dual-write, no idempotency, untested backup, no reconciliation) are the *money-never-lies* violations — this catalog is the checklist against them.

---

## 14.14 · Sizing rules of thumb

**Purpose.** Quick capacity heuristics. Distills **M09/M11/M13**.

**The decision logic (the rules).**
- **Buffer pool**: ~**70–80% of RAM** on a dedicated server (M09/M13 — the biggest lever; fit the working set).
- **Connection pool**: *small* (a DB handles bounded concurrency best, M04/M08) — often tens, not hundreds, per instance; multiplex via ProxySQL for many instances (M13/13.12).
- **When to shard**: only when *write/storage-bound past the biggest replicated single box* (M11/11.15) — not before.
- **Index count**: keep lean on write-heavy tables (each index = write amplification, M05); drop unused (`sys.schema_unused_indexes`, M13).
- **Row/column size**: keep rows reasonable (huge rows hurt buffer-pool density, M09); use appropriate types (M03 — smallest that fits); off-row large blobs.
- **Redo log**: large enough to avoid frequent checkpoint stalls (M09/M13).
- **Replica count**: scale reads with replicas until the *write* load (which each replica also applies) or the failover topology becomes the limit → then shard (M11).

**What it distills.** M09 (buffer pool, redo), M11 (when to shard), M13 (pool sizing, config).

**Fintech angle.** Right-size the payments primary (big buffer pool, full durability, small pools); shard reluctantly; keep the write-heavy ledger lean on indexes.

---

## 14.15 · "Is MySQL the right tool?" decision guide

**Purpose.** When MySQL fits vs when to reach elsewhere — the honest tool-fit guide.

**The decision logic.**
- **MySQL fits**: **OLTP** (many small ACID transactions — the payments ledger ✓), **relational** data with integrity needs, **read-heavy** web workloads (replicas), moderate write scale (and shardable, M11). InnoDB's ACID + durability (M07–M09) is *ideal* for money.
- **Reach elsewhere**: **Analytics/OLAP** (large scans, aggregations over billions of rows) → a **columnar warehouse** (ClickHouse, BigQuery, Snowflake — fed from MySQL via CDC, M12/12.12) — *don't* run heavy analytics on the OLTP ledger (offload to the warehouse, M02/2.17, M13). **Pure key-value / caching** → **Redis** (sub-ms, in-memory). **Full-text search** → **Elasticsearch** (fed via CDC). **Graph traversal** (deep relationships) → a graph DB (Neo4j). **Time-series at massive scale** → a time-series DB. **Massive horizontal scale with eventual consistency** → Cassandra/Dynamo (but you lose ACID — wrong for money).
- **The principle**: MySQL is the *system of record* (the ACID ledger); *derive* other stores (warehouse, search, cache) from it via CDC (M12) — "the log is primary." Use the right tool per workload, with MySQL as the source of truth for money.

**What it distills.** The whole journey's positioning — MySQL's strengths (ACID OLTP) vs its non-fits (analytics, search, KV, graph), and the CDC-derived-stores pattern (M12).

**Fintech angle.** MySQL is the **system of record for money** (ACID, durable — M07–M09). Analytics/search/cache are *derived* from it via CDC (M12) — never run heavy analytics on the ledger, never use an eventually-consistent store as the money source of truth.

---

## 14.16 · The master cheat-sheet (one-page recall) ★

**Purpose.** The single-page condensation — key numbers, defaults, decisions, and the "money settings" — for interview/incident recall. Distills **everything (M01–M13)**.

**The decision logic (what's on the one-pager).**
- **The money settings**: `DECIMAL`/integer-minor-units (never FLOAT); `flush_log_at_trx_commit=1` + `sync_binlog=1`; semi-sync; ROW binlog; idempotency keys; reconciliation.
- **The defaults to know**: InnoDB, REPEATABLE READ, buffer pool ~70-80% RAM, GTID on, ROW format.
- **The decision one-liners**: which index (=cols, range, sort; covering); which isolation (weakest-correct; money = RR + FOR UPDATE); scale (up → replicas → partition → shard, shard last); distributed (co-locate → Saga → idempotency → outbox/CDC → reconcile); durability (1/1 for money).
- **The triage entry points**: lag → 14.6, deadlock → 14.4, slow query → 14.7, lost data → 14.8 → M15.
- **The matrices**: isolation × anomaly (14.3), durability config (14.9), force-recovery levels (→ M15).
- **The threads**: durability ("what survives a crash?"), money-never-lies ("did money get lost/duplicated?"), generics-first, tradeoff.

**What it distills.** The entire resource (M01–M13) compressed to one page of recall.

**Fintech angle (★).** The "money settings" line is the *money-never-lies* checklist in one place: `DECIMAL`/minor-units, 1/1 durability, semi-sync, ROW, idempotency, reconciliation — the non-negotiables for not losing money. This is the page you recall under pressure.

---

*Guides 14.8–14.16 complete. **M14 Pass B is fully drafted (all 16 guides).** Next: M14 Pass C (the actual decision-trees/flowcharts/matrices — mostly Mermaid + ~3–4 ★ SVGs for the lost-data tree, anti-pattern catalog, master cheat-sheet).*
