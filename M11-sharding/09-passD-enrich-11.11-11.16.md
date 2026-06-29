# M11 · Pass D — Enrichment · Concepts 11.11–11.16

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-crossshard-ids-routing-resharding-capstone.md` + `06-passC-…`. Domain: payments/wallet, the ledger. These close out M11.

---

## 11.11 · Cross-shard transactions (the hard problem) ★

**🔧 Code-specifics.**
```sql
-- single-shard (the goal): a co-located transfer is just a normal ACID txn (11.9)
-- 2PC/XA (avoided): coordinator drives prepare→commit across shards
XA START 'tx1'; …; XA END 'tx1'; XA PREPARE 'tx1';   -- ⚠ holds locks; coordinator crash → in-doubt
XA COMMIT 'tx1';                                      -- blocking, fragile — widely avoided
-- Saga (the usual choice): local txns + compensation + idempotency key (no native syntax — app/orchestrator)
--   local debit (shard A) → local credit (shard B) → on failure: compensating re-credit (shard A)
```

**⚠️ Failure modes & gotchas.**
- **Naive two separate writes** (no protocol) + crash between → money lost/duplicated.
- **2PC coordinator crash after PREPARE** → shards stuck **in-doubt**, holding locks (the classic blocking failure).
- **Saga compensations** must be correct + idempotent ("undo a credit") and handle partial failure.

**💰 Fintech lens.** Co-locate (11.9) so the *vast majority* of transfers are single-shard ACID; for the unavoidable cross-shard minority use a **Saga + clearing accounts + idempotency keys + reconciliation** (M02/2.17) — never fragile 2PC. Eventually consistent there, never lost.

**🎯 Interview / SD angle.** "ACID is a single-node guarantee; spanning nodes needs 2PC (atomic but blocking) or Saga (non-blocking but eventually consistent) — both costly, so partition along transaction boundaries to keep txns single-node. Don't do cross-shard txns well — avoid them." The bridge to M12.

**✅ Self-check.**
1. Why is a cross-shard operation not atomic?
2. 2PC's blocking failure vs Saga's eventual consistency?
3. Why is *avoidance* (co-location) the real strategy?

---

## 11.12 · Distributed ID generation

**🔧 Code-specifics.**
```sql
-- ❌ AUTO_INCREMENT — per-server, collides across shards
-- ✅ ULID / UUIDv7 (time-ordered) stored BINARY(16) — unique + insert-friendly (M05/M09):
id BINARY(16)   -- store binary, NOT CHAR(36)  (16 vs 36 bytes × every index, M03/3.12)
-- ✅ Snowflake BIGINT = timestamp | node_id | sequence — unique + sortable + compact (8 bytes)
-- ✅ Vitess sequences — hand out ID blocks per shard (coordination per block, not per ID)
-- ⚠ avoid random UUIDv4 as the clustered PK (random inserts → page splits, M05/M09)
```

**⚠️ Failure modes & gotchas.**
- **Per-shard AUTO_INCREMENT** → colliding IDs across shards.
- **Random UUIDv4 as clustered PK** → page splits, fragmentation, secondary-index bloat (M05/M09).
- **Storing UUIDs as `CHAR(36)`** → 36 vs 16 bytes × every index.
- **Snowflake clock skew/rewind** → duplicate or out-of-order IDs.

**💰 Fintech lens.** Ledger entry/transaction IDs are **ULID/UUIDv7 (BINARY(16)) or Snowflake (BIGINT)** — unique across shards, time-ordered (insert-friendly on the append-heavy ledger), and components of **idempotency keys** (M16).

**🎯 Interview / SD angle.** "Generate unique IDs LOCALLY (no per-ID coordination); put time in the HIGH bits so they're sortable + index-friendly. Best = time-ordered + locally-unique (ULID/Snowflake). ID structure couples to clustered-index locality." Universal.

**✅ Self-check.**
1. Why does AUTO_INCREMENT break across shards?
2. Why is random UUIDv4 a bad clustered PK?
3. What makes ULID/Snowflake good (two properties)?

---

## 11.13 · The routing layer (Vitess & app-level) ★

**🔧 Code-specifics.**
```sql
-- Vitess: app connects to vtgate (MySQL protocol) as if it were one DB; VSchema/vindex route
--   vtgate: parse → vindex lookup → single-shard or scatter-gather + merge
--   vttablet: per-MySQL sidecar (pooling, query rewrite, reshard data movement)
--   also: sequences (IDs 11.12), reference tables (11.9), Reshard/MoveTables (11.14)
-- app-level alternative: maintain the shard map + a pool per shard; route/merge/reshard in code
```

**⚠️ Failure modes & gotchas.**
- **App-level resharding** hand-rolled → easy to lose/duplicate rows (use tooling).
- **A mis-routed write** → data-correctness bug (silent).
- **The router/proxy is itself a failure point** → needs HA; an extra network hop; some SQL limits.

**💰 Fintech lens.** A sharded payments platform typically runs **Vitess** — routes single-shard transfers (co-located, 11.9) to their shard as ACID txns, scatter-gathers/pushes cross-cutting reads to reporting replicas (11.10), generates IDs, keeps reference data everywhere, and (decisively) **reshards live** (11.14) without losing a transfer.

**🎯 Interview / SD angle.** "A sharded store needs a routing layer (shard map + query routing + cross-shard merge + rebalancing) — embedded in the client (control, duplicated, error-prone) or a proxy/coordinator (transparent, operationally heavy). Vitess vtgate ≈ mongos / Cassandra coordinator. Resharding automation is the deciding factor at scale." Universal.

**✅ Self-check.**
1. What does the routing layer own?
2. App-level vs Vitess — the tradeoff?
3. Why is resharding automation often the deciding reason for Vitess?

---

## 11.14 · Resharding: re-splitting live data ★

**🔧 Code-specifics.**
```sql
-- Vitess Reshard (8→16): copy → VReplication catch-up → VDiff verify → atomic SwitchTraffic
--   Reshard … Create        -- provision new shards + start VReplication (binlog catch-up, M10/10.14)
--   VDiff …                  -- checksum source vs target (counts + hashes) — reconciliation-grade
--   Reshard … SwitchTraffic  -- atomic routing cutover (brief write pause); keep old shards as rollback
-- changing shard COUNT = tractable (bounded move); changing shard KEY = full re-distribution (avoid)
```

**⚠️ Failure modes & gotchas.**
- **Hand-rolled live reshard** (no checksum/rollback) → lost/duplicated rows (money!).
- **Skipping VDiff verification** → silent loss/duplication at cutover.
- **Changing the shard *key*** (not just count) → no shortcut; re-distribute every row.
- **Partial cutover / split-brain on the moved range** (M15 territory).

**💰 Fintech lens.** Grow the ledger 8→16 via **Reshard** — VReplication catch-up so live transfers aren't lost, **VDiff** proves no transfer lost/duplicated (reconciliation-grade, M02/2.17), atomic `SwitchTraffic` (sub-second pause), old shards as rollback. Verify it like a financial operation.

**🎯 Interview / SD angle.** "Move live data: copy → sync via the change log (binlog/CDC) → verify equivalence → atomic routing cutover, moving only ~1/N (consistent hashing/range-splits). The change log makes 'copy while changing' possible; verification makes it safe. Same shape as online schema migration (gh-ost)." Universal.

**✅ Self-check.**
1. Walk the four resharding steps.
2. Why is the change log essential, and what does VDiff guarantee?
3. Why is changing the shard key worse than the shard count?

---

## 11.15 · Choosing partition vs shard vs replica (the decision)

**🔧 Code-specifics.**
```sql
-- the decision is architectural, not a single knob. The composed production topology:
--   SHARDED (Vitess, write scale) × each shard a PRIMARY+REPLICAS (M10, read+HA)
--   × ledger history PARTITIONED by month within each shard (11.2, retention)
-- diagnosis signals: read-bound → replicas · big-single-table+retention → partition · write/storage-bound → shard
SHOW ENGINE INNODB STATUS\G       -- write pressure (log waits, checkpoint age) → write-bound?
-- replica lag / read QPS → read-bound?
```

**⚠️ Failure modes & gotchas.**
- **Sharding when read-bound** / **replicas for write-scale** / **partitioning for write-scale** — wrong-tool mistakes.
- **Sharding prematurely** — permanent complexity before it's needed.
- **Picking a shard key without studying the access pattern** (11.6).

**💰 Fintech lens.** Ride vertical + read-replicas a *long* way (most fintech write volumes fit one tuned box); partition the history for retention; shard by tenant/account (co-locating transfers, 11.9) *only* at genuine write/storage limits. Shard last.

**🎯 Interview / SD angle.** "Diagnose the bottleneck (read/write/storage/manageability), apply the cheapest tool — replicate for reads/HA, partition for single-node manageability, shard for write/storage scale — deferring distribution until forced. The tools compose. 'Don't shard until you must' is the key judgment." Universal.

**✅ Self-check.**
1. Walk the diagnosis → tool decision.
2. The composed production topology (all three)?
3. Why shard last / shard reluctantly?

---

## 11.16 · Fintech capstone: the sharded ledger ★

**🔧 Code-specifics.**
```sql
-- the money-safe scaled topology (the pieces together):
-- Vitess shard by tenant_id/ledger_group (hash vindex) → transfers CO-LOCATE → single-shard ACID (M07–M09)
-- each shard = primary + replicas: semi-sync (node-loss durable, M10/10.4) + fenced auto-failover
-- IDs: ULID/UUIDv7 BINARY(16) or Snowflake BIGINT (unique across shards, 11.12)
-- cross-shard transfer → Saga + clearing accounts + idempotency keys + reconciliation (11.11, M02/2.17)
-- reference tables (currencies, account-types) replicated to ALL shards; reporting → replica-fed warehouse
-- growth: Reshard + VDiff (live, verified, 11.14);  money = *_minor BIGINT (never FLOAT)
SHOW STATUS LIKE 'Rpl_semi_sync_source_status';   -- per shard: verify durability (M10/10.12)
```

**⚠️ Failure modes & gotchas.**
- **Async failover (M10) per shard losing transfers · split-brain forking a shard's ledger · cross-shard partial write · stale-replica reads** — the money-never-lies catastrophes (per-shard M10 + cross-shard 11.11).
- **A botched live reshard** losing/duplicating rows (11.14, M15).
- **No monitoring** (semi-sync degraded, lag, errant GTIDs) per shard (M10/10.12).
- **No reconciliation** to catch cross-shard drift.

**💰 Fintech lens (★).** A committed transfer is **atomic** (single-shard ACID, M07–M09), **durable beyond node loss** (semi-sync, M10), **never double-applied** (idempotency keys), **never lost cross-shard** (Saga + reconciliation), and **writes scale** (sharding) **without forking the ledger**. Money-never-lies across the distribution.

**🎯 Interview / SD angle.** "Scale a transactional system by partitioning along its transaction boundaries (common txn stays single-partition/ACID), replicating each partition (durability/HA/reads), generating IDs without coordination, and handling the rare cross-partition op with a compensation workflow + verification — never by making cross-partition txns cheap. Minimize the distributed surface." The distributed realization of money-never-lies; sets up M12/M15/M16.

**✅ Self-check.**
1. For each failure (node loss, cross-shard, reshard, lag), what protects the money?
2. How does this compose M09 (durable) → M10 (node-loss-durable) → M11 (write-scaled)?
3. State the universal recipe for scaling a correctness-critical partitioned system.

---

*Enrichment for 11.11–11.16 complete. **M11 Pass D is fully drafted (all 16 concepts) — M11 is now content-complete across Passes A–D.***
