# M10 · Pass D — Enrichment · Concepts 10.1–10.4

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL/config appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-foundations-mechanism-sync.md` (Pass B) and `04-passC-…` (Pass C, with ★ SVGs). Domain: payments/wallet, the ledger.

---

## 10.1 · Why replicate? read scaling, HA, durability ★

**🔧 Code-specifics.**
```sql
-- set up a replica to stream the source's binlog (modern syntax, GTID-based, 10.7):
CHANGE REPLICATION SOURCE TO SOURCE_HOST='primary.db', SOURCE_AUTO_POSITION=1, SOURCE_SSL=1;
START REPLICA;
SHOW REPLICA STATUS\G   -- Replica_IO_Running / Replica_SQL_Running = Yes, Seconds_Behind_Source
-- replication scales READS + HA/durability; it does NOT scale writes (every replica applies every write → sharding M11)
```

**⚠️ Failure modes & gotchas.**
- **Expecting replication to scale writes** — it doesn't (every replica applies every write); that's sharding (M11).
- **Reading from replicas without accounting for lag** → stale reads (10.5/10.6).
- **No failover plan** → a source death is a total outage (replication isn't HA without orchestration, 10.13).

**💰 Fintech lens.** Replicas offload reporting/reconciliation (M02/2.17) from the transactional primary, provide failover targets (HA), and give a second copy that survives node/region loss (DR). The three reasons all matter for money.

**🎯 Interview / SD angle.** "Replication copies data for read scaling, HA (failover), and geo-redundancy — at the cost of copies not being instantly identical (lag). It scales reads, NOT writes (sharding does that)." Universal leader-follower replication.

**✅ Self-check.**
1. What three things does replication buy, and what's the core cost?
2. Why doesn't replication scale writes?
3. What scales writes instead?

---

## 10.2 · The mechanism: binlog → relay log → apply ★

**🔧 Code-specifics.**
```sql
-- the two positions on a replica (received vs applied):
SHOW REPLICA STATUS\G
--   Source_Log_File / Read_Source_Log_Pos   → RECEIVED (IO thread, relay log)
--   Relay_Source_Log_File / Exec_Source_Log_Pos → APPLIED (SQL thread)
--   Seconds_Behind_Source ≈ lag
--   with GTID: Retrieved_Gtid_Set (received) vs Executed_Gtid_Set (applied)
```

**⚠️ Failure modes & gotchas.**
- **IO thread fine but SQL thread behind** → received-but-not-applied gap (lag, 10.5).
- **Relay log on a separate disk that fills** → replication halts.
- **Confusing received vs applied** — a replica can have received but not yet applied a transaction.

**💰 Fintech lens.** A committed transfer flows source binlog → replica relay log → applied — so reporting replicas reflect it (after lag), the standby has it for failover, the DR replica for region survival. Same binlog, many consumers (10.14).

**🎯 Interview / SD angle.** "Log shipping: source binlog → replica relay log → SQL applier replays it — state-machine replication (replay an ordered durable log → identical state). Two positions: received vs applied; their gap is lag." Same as crash recovery (M09) + event sourcing (M01/1.17).

**✅ Self-check.**
1. Trace the three steps of the mechanism.
2. What are the two positions on a replica, and what's their gap?
3. Why is this "state-machine replication"?

---

## 10.3 · Binary log formats: statement, row, mixed

**🔧 Code-specifics.**
```sql
SET GLOBAL binlog_format = ROW;        -- the safe default (no divergence)
SET GLOBAL binlog_row_image = MINIMAL; -- log only changed columns + key (smaller RBR)
-- ❌ STATEMENT (SBR) — non-deterministic statements diverge:
--    INSERT … VALUES (UUID(), NOW())  → different values on the replica → ledger FORKS
SHOW VARIABLES LIKE 'binlog_format';
```

**⚠️ Failure modes & gotchas.**
- **SBR + non-deterministic statements** (`NOW()`, `UUID()`, `RAND()`, `LIMIT` without `ORDER BY`) → silent replica divergence.
- **STATEMENT format with Group Replication** — not supported (requires ROW).
- **RBR binlog size** on bulk updates (mitigate with `binlog_row_image=MINIMAL`).

**💰 Fintech lens.** The ledger replicates with **ROW format** — exact row images copied identically, zero divergence risk. A forked source/replica ledger is a money-never-lies catastrophe. ROW for fintech, full stop.

**🎯 Interview / SD angle.** "ROW (ship the exact result — safe, can't diverge) vs STATEMENT (ship the SQL — compact but non-deterministic statements diverge) vs MIXED. Ship the RESULT, not the OPERATION, when correctness demands it." Same as deterministic-state-machine replication (Raft).

**✅ Self-check.**
1. Why can statement-based replication cause divergence?
2. Why is ROW the safe default, and its cost?
3. What's the principle (ship result vs operation)?

---

## 10.4 · Async, semi-sync & sync replication ★

**🔧 Code-specifics.**
```sql
-- semi-sync (replica-confirmed durability) — the fintech choice:
INSTALL PLUGIN rpl_semi_sync_source SONAME 'semisync_source.so';   -- on the source
SET GLOBAL rpl_semi_sync_source_enabled = 1;
SET GLOBAL rpl_semi_sync_source_wait_for_replica_count = 1;        -- how many must ack
SET GLOBAL rpl_semi_sync_source_timeout = 10000;                   -- ⚠ ms before SILENT fallback to async (10.12)
-- ⚠ MONITOR it isn't silently degraded:
SHOW STATUS LIKE 'Rpl_semi_sync_source_status';                    -- 1=semi-sync active, 0=degraded to ASYNC
```

**⚠️ Failure modes & gotchas.**
- **Semi-sync silently degrades to async on timeout** (10.12) — you THINK you have replica durability but don't.
- **Async source crash before replica received** → those committed transactions lost on failover (10.10).
- **Semi-sync at low concurrency** → the per-commit round-trip latency is fully visible (group commit can't amortize, 9.11).

**💰 Fintech lens.** **Semi-sync = replica-confirmed durability** — a confirmed transfer survives total loss of the primary's node (extends M09's single-node durability, 9.16). Mandatory-ish for money, WITH alerting on `Rpl_semi_sync_source_status` (10.12).

**🎯 Interview / SD angle.** "How many nodes must ack before commit returns = the durability/consistency vs latency dial. Async (fast, lossy), semi-sync (durable beyond a node, +1 round-trip), sync/group (consistent, most latency)." Same as Kafka acks / quorum W / Raft majority / synchronous_commit. The PACELC 'else' knob (M12).

**✅ Self-check.**
1. What does each sync mode wait for, and what does it guarantee/lose?
2. Why is semi-sync the fintech choice, and what must you monitor?
3. What universal dial is this?

---

*Enrichment for 10.1–10.4 complete. Next Pass D file: 10.5–10.8.*
