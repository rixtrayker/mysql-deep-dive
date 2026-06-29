# M09 · Pass D — Enrichment · Concepts 9.11–9.16

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-writepath-recovery-capstone.md` + `06-passC-…`. Domain: payments/wallet. These close out M09 — **and Track C (M07+M08+M09)**.

---

## 9.11 · Group commit & the binlog↔redo two-phase commit

**🔧 Code-specifics.**
```sql
-- group commit is automatic; tune larger groups (trade latency for fewer fsyncs):
SHOW VARIABLES LIKE 'binlog_group_commit_sync_delay';        -- wait briefly to batch more
SHOW VARIABLES LIKE 'binlog_group_commit_sync_no_delay_count';
-- binlog↔redo 2PC keeps the two logs consistent (requires binlog on):
SHOW VARIABLES LIKE 'log_bin';        -- ON for replication/PITR (M10/M13)
SHOW VARIABLES LIKE 'sync_binlog';    -- =1 with flush_log_at_trx_commit=1 → consistent durable commit
```

**⚠️ Failure modes & gotchas.**
- **Low concurrency** → group commit can't amortize → fsync cost per commit is full.
- **Binlog off** → no 2PC needed, but no replication/PITR (M10/M13).
- **`binlog_group_commit_sync_delay` too high** → added commit latency.

**💰 Fintech lens.** Group commit lets a payments platform sustain thousands of *durable* (1,1) transfers/sec; the 2PC guarantees every transfer durable in the redo is also in the binlog → replicas/PITR have exactly the committed transfers (no divergence).

**🎯 Interview / SD angle.** "Group commit batches concurrent commits' fsyncs into one (amortizes the expensive fsync; scales with concurrency); the binlog↔redo 2PC keeps the two durable logs agreeing across a crash." Batch-the-sync + atomic-commit-across-two-resources (like distributed 2PC, M12).

**✅ Self-check.**
1. What does group commit amortize, and why does it scale with concurrency?
2. Why must the redo log and binlog agree, and how does 2PC ensure it?
3. What does the recovery reconcile use as the arbiter?

---

## 9.12 · The purge thread & history-list blowup

**🔧 Code-specifics.**
```sql
-- the key metric — history list length (un-purged undo):
SHOW ENGINE INNODB STATUS\G   -- "History list length: N" (growing = a long txn blocking purge)
-- find the culprit long transaction:
SELECT trx_id, trx_started, TIMESTAMPDIFF(SECOND,trx_started,NOW()) age_s
FROM information_schema.INNODB_TRX ORDER BY trx_started LIMIT 5;
SHOW VARIABLES LIKE 'innodb_purge_threads';   -- parallelize purge (can't beat a BLOCKED horizon)
KILL <long_txn_thread_id>;                     -- purge drains once it ends
```

**⚠️ Failure modes & gotchas.**
- **Long transaction / idle-in-transaction** (pool leak, M04/4.2) → pins undo → history-list blowup.
- **Blowup symptoms**: undo storage grows (disk fills), MVCC reads slow (long chains, M08/8.2).
- **More purge threads can't fix a *blocked* horizon** — only ending the long txn does.

**💰 Fintech lens.** A forgotten long reconciliation transaction blocks purge → history list blows up → undo bloat + slow hot-account reads. Fix: kill it; prevent: short txns (M07/7.15), run long reads on a REPLICA (M10).

**🎯 Interview / SD angle.** "Purge GCs old undo once no snapshot needs it; a long transaction pins the purge horizon → history-list blowup (undo bloat, long chains)." The MVCC GC / oldest-reader-pins-the-horizon problem (Postgres VACUUM has the identical issue). Monitor history list length.

**✅ Self-check.**
1. What does the purge thread do, and what blocks it?
2. What are the symptoms of history-list blowup?
3. How do you fix and prevent it?

---

## 9.13 · Adaptive flushing, checkpoint-age stalls & the change buffer

**🔧 Code-specifics.**
```sql
SHOW VARIABLES LIKE 'innodb_adaptive_flushing';   -- ON
SHOW VARIABLES LIKE 'innodb_io_capacity';         -- ~ sustained flush IOPS of your storage
SHOW VARIABLES LIKE 'innodb_io_capacity_max';     -- burst ceiling
SHOW VARIABLES LIKE 'innodb_redo_log_capacity';   -- bigger = more burst headroom (#1 stall fix)
SHOW VARIABLES LIKE 'innodb_change_buffering';    -- defer secondary-index writes (non-unique)
SHOW VARIABLES LIKE 'innodb_flush_neighbors';     -- 0 on SSD
```

**⚠️ Failure modes & gotchas.**
- **Undersized redo log** → checkpoint-age stall (write cliff) under bursts — the classic cause.
- **`io_capacity` too low** → adaptive flushing falls behind → stalls; too high → wasted I/O.
- **Change buffer** only helps non-unique secondary indexes (uniqueness needs the page immediately).

**💰 Fintech lens.** The write-heavy ledger needs a generously-sized redo log + accurate IO capacity so adaptive flushing keeps up under transfer bursts (no stalls); the change buffer defers secondary-index maintenance.

**🎯 Interview / SD angle.** "Adaptive flushing paces page-flushing to keep the redo log from filling; checkpoint-age stalls are a write cliff (fix: bigger redo log + accurate IO capacity); the change buffer defers/batches random secondary-index writes." Pacing + backpressure + write-deferral (universal write-path patterns).

**✅ Self-check.**
1. What causes a checkpoint-age stall, and the #1 fix?
2. What does the change buffer defer, and for which indexes?
3. What does `innodb_io_capacity` guide?

---

## 9.14 · Crash recovery: redo apply → undo rollback → binlog reconcile ★

**🔧 Code-specifics.**
```sql
-- recovery is AUTOMATIC on startup after an unclean shutdown (logged to the error log):
--   [InnoDB] Starting crash recovery / Applying batch of redo / Rolling back trx ...
-- recovery time ∝ redo to replay (checkpoint age, 9.6).
-- DAMAGED-data escape hatch (M15 territory — read-only/degraded modes to salvage):
SHOW VARIABLES LIKE 'innodb_force_recovery';   -- 0 normal; 1–6 forces up past corruption (DANGEROUS)
```

**⚠️ Failure modes & gotchas.**
- **Large checkpoint age** → long recovery (downtime) — trade vs steady-state write smoothness.
- **`innodb_force_recovery` > 0** is for *damaged* data — degraded/read-only, can lose data (M15).
- **Relying on local recovery for HA** — promote a replica instead (M10) to hide recovery time.

**💰 Fintech lens.** Server crashes mid-transfer → recovery repairs torn pages (doublewrite), replays redo (committed transfers survive — M07/7.5), rolls back the in-flight transfer (atomicity), reconciles with the binlog (replicas agree). Consistent + durable on restart.

**🎯 Interview / SD angle.** "Recovery = doublewrite repair → redo roll-forward (committed, idempotent via LSN) → undo roll-back (in-flight) → binlog reconcile (2PC). Nothing committed lost, nothing uncommitted survives." This *is* ARIES. Recovery-vs-throughput via checkpoint age. Catastrophic recovery → M15.

**✅ Self-check.**
1. Name the recovery steps in order.
2. What survives, and what's rolled back?
3. What governs recovery time?

---

## 9.15 · Tuning the internals (the key knobs that matter)

**🔧 Code-specifics.**
```sql
-- the handful that matter (each maps to a mechanism + a tradeoff you understand):
SET GLOBAL innodb_buffer_pool_size = …;          -- 9.2 hold the working set (~50–75% RAM)
SET GLOBAL innodb_flush_log_at_trx_commit = 1;   -- 9.10 durability (money)
SET GLOBAL sync_binlog = 1;                       -- 9.10 binlog durability (money)
SET GLOBAL innodb_redo_log_capacity = …;         -- 9.4/9.13 write-burst headroom
-- innodb_flush_method=O_DIRECT (9.8), innodb_doublewrite=ON (9.9), innodb_io_capacity=… (9.13)
```

**⚠️ Failure modes & gotchas.**
- **Cargo-cult tuning** (copying values) instead of reasoning from the mechanism/tradeoff.
- **Wrong tuning**: relaxed flush on money (loss), undersized redo (stalls), buffer pool too big (swapping).
- **Over-tuning minor knobs** — focus on buffer pool, durability matrix, redo size.

**💰 Fintech lens.** Payments config: buffer pool sized to the hot working set; (1,1) durable flush; generous redo log; O_DIRECT; doublewrite ON; IO capacity = the honest SSD's real throughput. Derived by reasoning, not copying.

**🎯 Interview / SD angle.** "Know the few knobs that dominate (buffer pool, durability matrix, redo size), understand what each trades, tune those from first principles, leave the rest at defaults." Same discipline as profile-before-optimize (M06/6.1).

**✅ Self-check.**
1. Name the handful of knobs that actually matter and what each controls.
2. Why tune from understanding rather than copied values?
3. Three examples of *wrong* tuning and their consequences.

---

## 9.16 · Fintech capstone — the durability posture of a money system ★

**🔧 Code-specifics.**
```sql
-- the money durability posture (the (1,1) corner + protections):
SET GLOBAL innodb_flush_log_at_trx_commit = 1;   -- 9.10 power-loss durable redo
SET GLOBAL sync_binlog = 1;                       -- 9.10 durable binlog → replicas/PITR (M10/M13)
-- innodb_doublewrite=ON (9.9, torn pages) · innodb_flush_method=O_DIRECT (9.8)
-- + honest storage (9.7, non-volatile/capacitor-backed write cache)
-- + replication (M10) + tested backups/PITR (M13)
SHOW ENGINE INNODB STATUS\G   -- health: hit rate, history list, checkpoint age, LSN
```

**⚠️ Failure modes & gotchas.**
- **A single weak link** (relaxed flush, lying disk 9.7, doublewrite off 9.9, no replication) → a failure mode survives nothing.
- **Untested backups** → "durable" until you need to restore and can't (M13/M15).
- **Multiple/catastrophic failures + misconfiguration** → M15.

**💰 Fintech lens (★).** With the posture, a committed payment survives **every single failure**: process crash (redo replay), power loss (fsync to honest storage), torn page (doublewrite), node loss (replica). Money-never-lies delivered at the storage layer.

**🎯 Interview / SD angle.** "Durability is a POSTURE, not a setting — close each failure mode with a specific mechanism (strict flush → power loss, doublewrite → torn write, honest storage → lying disk, replication → node loss), and state exactly what survives each." Durability you can't articulate failure-mode-by-failure-mode is durability you don't have.

**✅ Self-check.**
1. State the money durability posture (the settings + protections).
2. For each failure mode (process crash, power loss, torn page, node loss), what mechanism makes the payment survive?
3. Why is durability a "posture," not a single setting?

---

*Enrichment for 9.11–9.16 complete. **M09 Pass D is fully drafted (all 16 concepts) — M09 is now content-complete across Passes A–D. This completes Track C (M07 Transactions & ACID + M08 Locking & MVCC + M09 InnoDB Internals & Disk Durability).***
