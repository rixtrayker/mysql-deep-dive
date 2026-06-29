# M10 · Pass D — Enrichment · Concepts 10.9–10.16

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-topologies-failure-bridge-capstone.md` + `06-passC-…`. Domain: payments/wallet. These close out M10.

---

## 10.9 · Replication topologies ★

**🔧 Code-specifics.**
```sql
-- chained: a replica re-logs to its own binlog so ITS replicas can chain:
SET GLOBAL log_replica_updates = ON;
-- multi-source: multiple replication CHANNELS (aggregate shards, M11):
CHANGE REPLICATION SOURCE TO SOURCE_HOST='shardA', SOURCE_AUTO_POSITION=1 FOR CHANNEL 'shardA';
CHANGE REPLICATION SOURCE TO SOURCE_HOST='shardB', SOURCE_AUTO_POSITION=1 FOR CHANNEL 'shardB';
-- group replication (consensus cluster → InnoDB Cluster, 10.13): managed via MySQL Shell / plugin
```

**⚠️ Failure modes & gotchas.**
- **Chained replication** → additive lag per hop + longer failure chain.
- **Multi-source with overlapping data** → conflicts/collisions.
- **Group replication** → needs ≥3 nodes (majority), coordination latency.

**💰 Fintech lens.** Payments composes topologies: per-region fan-out (primary+replicas+standby), cross-region for DR, multi-source to aggregate sharded ledgers (M11) for global reporting (M02/2.17), optionally InnoDB Cluster for strong-consistency HA.

**🎯 Interview / SD angle.** "Fan-out (read scale), chained (load/geo), multi-source (aggregate), group replication (consensus HA) — composable per requirement. The divide: async fan-out (fast, lag) vs group replication (consistent, slower)." Universal topology patterns. Sharding (M11) is orthogonal.

**✅ Self-check.**
1. Match each topology to a need.
2. What does multi-source enable for sharded systems?
3. What does group replication give that async fan-out doesn't?

---

## 10.10 · Failover & promotion (and the data-loss window) ★

**🔧 Code-specifics.**
```sql
-- promote a replica (orchestrated; manual steps shown):
STOP REPLICA; RESET REPLICA ALL;          -- detach from the dead source
SET GLOBAL super_read_only = OFF;          -- make it writable (the new primary)
-- re-point the OTHER replicas (GTID auto-position, 10.7):
CHANGE REPLICATION SOURCE TO SOURCE_HOST='new-primary', SOURCE_AUTO_POSITION=1;
-- choose the FRESHEST replica: largest Executed_Gtid_Set minimizes loss
-- semi-sync (10.4) bounds the loss window to ~zero; FENCE the old source first (10.11)
```

**⚠️ Failure modes & gotchas.**
- **Async failover** → loses the promoted replica's lag worth of committed transactions (the data-loss window).
- **Promoting a behind replica** → more loss; choose the freshest.
- **Failover without fencing** → split-brain (10.11) — worse than data loss.

**💰 Fintech lens.** Fail over with semi-sync (no confirmed transfer lost) + GTID (auto re-point) + fence (no split-brain) + freshest replica + automation → a source death is a brief blip with no lost money, not a data-loss incident.

**🎯 Interview / SD angle.** "Promoting a follower after leader death loses whatever hadn't replicated to it — semi-sync bounds it to zero, async doesn't; choose the freshest; FENCE the old leader. Can't have instant availability AND zero loss." The CAP tradeoff concrete (Raft/Kafka parallels).

**✅ Self-check.**
1. What's the data-loss window, and what determines its size?
2. How does semi-sync bound it?
3. Why is fencing non-negotiable?

---

## 10.11 · Split-brain & the danger of two sources ★

**🔧 Code-specifics.**
```sql
-- prevent: super_read_only on ALL replicas (no node accidentally becomes a 2nd source):
SET GLOBAL super_read_only = ON;
-- fencing happens at the orchestration/infra layer (STONITH: power mgmt / network ACL) — not pure SQL
-- structural prevention: Group Replication / InnoDB Cluster (quorum — minority can't commit)
SELECT * FROM performance_schema.replication_group_members;   -- group repl member states
```

**⚠️ Failure modes & gotchas.**
- **Failover without fencing** + old source returns → two sources → split-brain → forked ledger.
- **Network partition in multi-primary** → each side accepts writes → divergence.
- **Errant transactions** (10.12) are the GTID symptom of split-brain.

**💰 Fintech lens (★).** A forked ledger (two primaries, conflicting transfers, real money on both) is an unrecoverable money-never-lies catastrophe. Prevention (fencing OR quorum) is the ONLY acceptable strategy — never fail over without it.

**🎯 Interview / SD angle.** "Two sources accepting writes diverge irreconcilably (split-brain). Enforce 'exactly one leader' via FENCING/STONITH or QUORUM/consensus — never assume. Why consensus algorithms exist; why 'fence before promote' is sacred." Worse than the outage. CAP (M12).

**✅ Self-check.**
1. What is split-brain, and why is it worse than data loss?
2. The two prevention strategies?
3. Why must you never fail over without fencing/quorum?

---

## 10.12 · Critical internals: the silent failures ★

**🔧 Code-specifics.**
```sql
-- ① semi-sync degrade-to-async — THE money gotcha: MONITOR + ALERT:
SHOW STATUS LIKE 'Rpl_semi_sync_source_status';   -- 0 = degraded to ASYNC (alert!)
SHOW STATUS LIKE 'Rpl_semi_sync_source_no_tx';
-- ② relay-log corruption → Last_IO_Error/Last_SQL_Error; recover via GTID re-fetch
-- ③ errant transactions → super_read_only=ON prevents; detect via GTID set comparison
SHOW REPLICA STATUS\G   -- Last_IO_Error, Last_SQL_Error, Retrieved vs Executed Gtid_Set
```

**⚠️ Failure modes & gotchas.**
- **Semi-sync silently degrades to async** → you THINK you have replica durability but don't (the worst silent failure).
- **Relying on config, not monitoring** — "configured for X" ≠ "X is currently true."
- **Relay-log corruption / errant txns** caught only if you monitor.

**💰 Fintech lens (★).** For money, you VERIFY durability (alert on `Rpl_semi_sync_source_status=0`, lag, errant GTIDs, replica errors), you don't ASSUME it — because the failures are silent. Same discipline as tested backups / verified fsync (M09/9.7).

**🎯 Interview / SD angle.** "A safety mechanism that FAILS OPEN (degrades silently) gives false confidence — monitor that the guarantee is ACTUALLY HOLDING, not just configured. Semi-sync silently degrading to async is the canonical case." Fail-silent hazard (universal). Bridge to M15.

**✅ Self-check.**
1. What happens when semi-sync degrades, and why is it dangerous?
2. Why monitor the guarantee, not just the config?
3. How do you prevent errant transactions / recover relay-log corruption?

---

## 10.13 · High-availability solutions (the orchestration layer)

**🔧 Code-specifics.**
```sql
-- InnoDB Cluster (consensus HA + auto-failover, managed via MySQL Shell):
-- dba.createCluster('payments');  cluster.addInstance(...);  -- (Shell, not SQL)
-- routing: ProxySQL read/write split (its admin interface):
-- INSERT INTO mysql_query_rules (match_pattern, destination_hostgroup) VALUES ('^SELECT', <replica_hg>);
SELECT * FROM performance_schema.replication_group_members;   -- cluster member states
```

**⚠️ Failure modes & gotchas.**
- **Orchestrator that doesn't fence** → automated failover causes split-brain (10.11).
- **The orchestrator/proxy itself is a failure point** → needs its own HA.
- **Bad automated promotion** (a behind replica) → more data loss.

**💰 Fintech lens.** Payments uses InnoDB Cluster + MySQL Router (consensus HA, structural split-brain prevention) OR semi-sync + Orchestrator + ProxySQL (orchestrated fenced failover + smart routing) → automatic, fenced failover with seconds of disruption, not minutes.

**🎯 Interview / SD angle.** "Raw replication = data plane; HA needs a CONTROL PLANE (detect → fence/promote → re-route) + routing layer (service discovery). Orchestrator/InnoDB Cluster + ProxySQL/Router." Same as Kubernetes controllers + service routing. The orchestrator MUST fence.

**✅ Self-check.**
1. What two roles does the HA orchestration layer provide?
2. Why is it the "control plane" of replication?
3. What's the critical correctness requirement of the orchestrator?

---

## 10.14 · Replication for backups, PITR & CDC (bridge)

**🔧 Code-specifics.**
```sql
-- PITR (M13): full backup + binlog replay to a point:
SHOW VARIABLES LIKE 'binlog_expire_logs_seconds';   -- retention
-- mysqlbinlog --stop-datetime='2026-06-28 14:30:00' binlog.000123 | mysql   -- replay to a point
-- CDC (M12): Debezium reads the binlog (as a replica) → Kafka; requires:
SHOW VARIABLES LIKE 'binlog_format';   -- ROW (10.3) · sync_binlog=1 (9.10) for durable binlog
```

**⚠️ Failure modes & gotchas.**
- **Binlog not retained** → no PITR window.
- **Dual-writing** (app writes DB + queue itself) → the dual-write problem (partial failure); use CDC/outbox (M12).
- **CDC needs ROW format** (10.3) for exact downstream changes.

**💰 Fintech lens.** The ledger's binlog feeds replicas + PITR (recover before any incident, M13/M15) + CDC (fraud/notifications/analytics + reliable outbox propagation, M12). One binlog, three uses.

**🎯 Interview / SD angle.** "A durable ordered change log is reusable: replay for copies (replication), roll a backup forward (PITR), stream to integrate (CDC). CDC-off-the-binlog avoids the dual-write problem (outbox pattern)." 'Log is primary, everything derives' at the architecture level.

**✅ Self-check.**
1. Three uses of the binlog beyond replicas?
2. How does PITR use the binlog?
3. How does CDC/outbox avoid the dual-write problem?

---

## 10.15 · Choosing a replication strategy (the decision)

**🔧 Code-specifics.**
```sql
-- the fintech-convergent strategy (the settings together):
SET GLOBAL binlog_format = ROW;                 -- no divergence (10.3)
SET GLOBAL gtid_mode = ON; SET GLOBAL enforce_gtid_consistency = ON;   -- robust failover (10.7)
SET GLOBAL rpl_semi_sync_source_enabled = 1;    -- durability beyond a node (10.4) — MONITOR it (10.12)
SET GLOBAL sync_binlog = 1;                      -- durable binlog for PITR/CDC (9.10/10.14)
SET GLOBAL super_read_only = ON;                 -- on replicas (10.7/10.11)
SET GLOBAL replica_parallel_type = 'LOGICAL_CLOCK';   -- keep replicas caught up (10.8)
```

**⚠️ Failure modes & gotchas.**
- **One blanket config** for all systems → over/under-engineered.
- **Relaxing money guarantees** (async, statement format, no fencing) for speed → data loss/divergence.
- **Configuring guarantees without monitoring them** (10.12).

**💰 Fintech lens.** Fintech converges: ROW + GTID + semi-sync(monitored) + super_read_only + fenced auto-failover + RYW routing + sync_binlog=1 + parallel replication + lag/status monitoring — bias toward guarantees, verify they hold.

**🎯 Interview / SD angle.** "Derive the design from required guarantees (scale, availability, durability, consistency) — bias toward stronger guarantees as the cost of failure rises, and VERIFY they hold." Requirements-driven distributed design. Same right-sizing as isolation (M07/7.14) + durability matrix (M09/9.10).

**✅ Self-check.**
1. Walk the requirements→design decision procedure.
2. What's the fintech-convergent strategy?
3. Why bias toward stronger guarantees for money?

---

## 10.16 · Fintech capstone — the replicated payments platform ★

**🔧 Code-specifics.**
```sql
-- the money-safe replicated topology (settings together):
-- binlog_format=ROW · gtid_mode=ON · rpl_semi_sync_source_enabled=1 (monitored)
-- sync_binlog=1 · super_read_only=ON (replicas) · replica_parallel_type=LOGICAL_CLOCK
-- + automated fenced failover (InnoDB Cluster / Orchestrator+ProxySQL)
-- + read-after-write routing for money reads + cross-region replica + binlog→PITR/CDC
SHOW STATUS LIKE 'Rpl_semi_sync_source_status';   -- VERIFY durability (alert on 0)
```

**⚠️ Failure modes & gotchas.**
- **Async failover losing transfers · split-brain forking the ledger · semi-sync silently degraded · stale-replica reads (double charge)** — the money-never-lies catastrophes (10.5/10.10/10.11/10.12).
- **No monitoring** → configured guarantees that silently aren't holding.
- **No DR replica** → region loss = data loss.

**💰 Fintech lens (★).** A confirmed transfer survives process crash, power loss, torn page (M09), TOTAL node/disk loss (semi-sync), and region loss (DR); failover loses no confirmed money; the ledger never forks; users never read stale balances. Money-never-lies across the distribution.

**🎯 Interview / SD angle.** "Durable beyond one node (sync repl), exactly one leader (fence/quorum), read-your-writes where it matters, and verified (monitored). The cost of these guarantees is justified by the cost of their failure." The distributed realization of money-never-lies. Sets up M11/M12/M15/M16.

**✅ Self-check.**
1. For each failure (node loss, region loss, failover, lag), what protects the money?
2. How does this extend M09's single-node durability?
3. State the universal recipe for high-value distributed data.

---

*Enrichment for 10.9–10.16 complete. **M10 Pass D is fully drafted (all 16 concepts) — M10 is now content-complete across Passes A–D.***
