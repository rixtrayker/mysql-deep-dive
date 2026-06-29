# M10 · Pass D — Enrichment · Concepts 10.5–10.8

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-lag-consistency-gtid-parallel.md` + `05-passC-…`. Domain: payments/wallet.

---

## 10.5 · Replication lag: causes, measurement, consequences ★

**🔧 Code-specifics.**
```sql
-- rough (imperfect — can read 0 during stalls):
SHOW REPLICA STATUS\G   -- Seconds_Behind_Source
-- exact (GTID gap): compare source vs replica
-- source:  SELECT @@global.gtid_executed;   replica:  SELECT @@global.gtid_executed;   -- the diff = un-applied
-- robust (heartbeat): a row updated every 1s on the source, lag measured on the replica
-- reduce lag → parallel replication (10.8); monitor + alert on spikes (M13)
```

**⚠️ Failure modes & gotchas.**
- **Trusting `Seconds_Behind_Source` alone** — imperfect (0 during stalls, misleading); use GTID gap / heartbeat.
- **A long source transaction** stalls the replica applier → lag spike (M07/7.15).
- **Reading money-decision data off a lagging replica** → stale → double-charge (10.6).

**💰 Fintech lens.** Reconciliation/reporting on a lagging replica = fine (M02/2.17, tolerates staleness). A balance read driving a spending decision = NOT fine on a lagging replica (the double-charge bug). Monitor + alert on lag.

**🎯 Interview / SD angle.** "Async replicas trail by a variable lag; a replica read is a read of the PAST. Measure via GTID gap / heartbeat (not just Seconds_Behind_Source). Reduce with parallel replication." Eventual consistency made concrete (→ CAP, M12).

**✅ Self-check.**
1. What causes lag, and how do you measure it robustly?
2. Why is `Seconds_Behind_Source` unreliable?
3. Which reads can tolerate lag, which can't?

---

## 10.6 · Read-after-write consistency & read routing

**🔧 Code-specifics.**
```sql
-- pattern B — GTID-wait (causal read-after-write from a replica):
-- after the write, capture its GTID, then on the replica before the read:
SELECT WAIT_FOR_EXECUTED_GTID_SET('3E11FA47-...:1234', 1);  -- wait (≤1s) until applied, THEN read
-- pattern A — read-from-source after write: route the user's reads to the source for a window
-- routing done by app or ProxySQL (read/write split rules, 10.13)
```

**⚠️ Failure modes & gotchas.**
- **All reads to replicas without RYW** → "paid but balance unchanged → pay again" double charge.
- **GTID-wait with a far-behind replica** → the read blocks (up to timeout).
- **Sticky routing not handling lag** → still stale.

**💰 Fintech lens.** A user's own balance read after paying → **source** (or GTID-wait to a caught-up replica) so they see the new balance (no panic-retry double charge); other reads/reports → replicas (scaled).

**🎯 Interview / SD angle.** "Read routing scales reads but breaks read-your-writes; restore RYW by reading from a fresh source or waiting (GTID) for the write to propagate. Classify reads by freshness need." Causal/session consistency (universal: write-through cache, CDN cache-bust).

**✅ Self-check.**
1. What's the read-after-write hazard, and the double-charge bug?
2. Two patterns to restore RYW, and their tradeoffs?
3. How do you classify reads for routing?

---

## 10.7 · GTIDs: global transaction identifiers

**🔧 Code-specifics.**
```sql
SET GLOBAL gtid_mode = ON;                 -- (staged: OFF→OFF_PERMISSIVE→ON_PERMISSIVE→ON)
SET GLOBAL enforce_gtid_consistency = ON;
SET GLOBAL super_read_only = ON;           -- on REPLICAS — prevent errant transactions (10.12)
-- robust re-point on failover (auto-finds missing txns via GTID set diff):
CHANGE REPLICATION SOURCE TO SOURCE_HOST='new-primary', SOURCE_AUTO_POSITION=1;
SELECT @@global.gtid_executed;             -- the applied GTID set
```

**⚠️ Failure modes & gotchas.**
- **Errant transaction** (write directly on a replica) → a GTID the source lacks → breaks failover. Prevent: `super_read_only=ON`.
- **GTID gaps** from manually skipped transactions → trouble.
- **File+position (legacy)** → fragile manual position math on failover.

**💰 Fintech lens.** GTIDs are mandatory for safe automated-failover money topologies — robust promotion/re-pointing (each replica auto-finds missing txns), precise lag/divergence detection, RYW via GTID-wait. `super_read_only=ON` prevents errant transactions.

**🎯 Interview / SD angle.** "GTID = globally-unique server-independent txn ID → cross-node sync becomes SET RECONCILIATION (know WHAT each node has), not fragile position-matching → safe automated failover." Universal global-operation-identity (vector clocks, idempotency keys). Errant-txn hazard.

**✅ Self-check.**
1. Why are GTIDs more robust than file+position for failover?
2. What's an errant transaction, and how do you prevent it?
3. What does `SOURCE_AUTO_POSITION=1` do?

---

## 10.8 · Replication threads & parallel replication

**🔧 Code-specifics.**
```sql
-- parallel replication (keep replicas caught up under write load):
SET GLOBAL replica_parallel_workers = 8;                 -- applier worker threads
SET GLOBAL replica_parallel_type = 'LOGICAL_CLOCK';
SET GLOBAL replica_preserve_commit_order = ON;            -- preserve source commit order
-- on the SOURCE, for more parallelism (row-level writesets):
SET GLOBAL binlog_transaction_dependency_tracking = 'WRITESET';
```

**⚠️ Failure modes & gotchas.**
- **Single-threaded applier** under a write-heavy source → unbounded lag (10.5).
- **Too many workers** → coordination overhead/contention on the replica.
- **WRITESET + statement format** — needs ROW for row-level dependency tracking (10.3).

**💰 Fintech lens.** The write-heavy ledger (many parallel transfers, M08) requires parallel replication, or replicas fall hopelessly behind (stale reports, huge failover window). WRITESET gives the best parallelism (parallelize non-row-overlapping transfers).

**🎯 Interview / SD angle.** "Single applier can't keep up with a parallel source → lag. Parallel replication applies INDEPENDENT txns concurrently (LOGICAL_CLOCK: what committed together didn't conflict; WRITESET: non-overlapping rows), ordering only dependent ones." Dependency-aware parallel replay (universal).

**✅ Self-check.**
1. Why does a single-threaded applier lag, and how does parallel replication fix it?
2. How do LOGICAL_CLOCK and WRITESET decide what's parallelizable?
3. Why is parallel replication essential for a write-heavy ledger?

---

*Enrichment for 10.5–10.8 complete. Next Pass D file: 10.9–10.16.*
