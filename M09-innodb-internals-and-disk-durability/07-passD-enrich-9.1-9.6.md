# M09 · Pass D — Enrichment · Concepts 9.1–9.6

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL/config appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-wal-foundation.md` (Pass B) and `04-passC-…` (Pass C, with ★ SVGs). Domain: payments/wallet, the ledger.

---

## 9.1 · The fast-and-durable problem (why WAL exists) ★

**🔧 Code-specifics.**
```sql
-- WAL is the mechanism, not a setting — but you SEE it in the redo log + flush behavior:
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit';   -- =1: fsync redo each commit (9.10)
SHOW ENGINE INNODB STATUS\G                              -- "Log sequence number" vs "Last checkpoint at"
-- commit = sequential redo write + fsync (durable); data pages flushed lazily (9.6/9.13).
```

**⚠️ Failure modes & gotchas.**
- **Thinking commit writes data pages** — it writes the *redo log* sequentially; pages flush lazily.
- **Assuming durability without checking flush settings** (9.10) — WAL is only durable if the redo is actually fsync'd.
- **Confusing redo (crash recovery) with binlog (replication)** — different logs (9.4/M10).

**💰 Fintech lens.** WAL is *why* a payments system commits thousands of durable transfers/sec — one sequential fsync, not a random-write storm. The transfer is durable the instant its redo is fsync'd.

**🎯 Interview / SD angle.** "Log the change sequentially + fsync, apply to scattered pages lazily, replay on crash." Sequential writes are cheap + a log is replayable → durability without per-commit random I/O. Universal: journals, Kafka, Raft, event sourcing.

**✅ Self-check.**
1. Why is flushing data pages on every commit too slow?
2. How does WAL make a commit durable cheaply?
3. What happens on a crash before the dirty pages are flushed?

---

## 9.2 · The buffer pool: caching pages in RAM ★

**🔧 Code-specifics.**
```sql
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';        -- the dominant perf knob (~50–75% RAM dedicated)
SHOW VARIABLES LIKE 'innodb_buffer_pool_instances';   -- split to reduce mutex contention
-- hit rate + dirty ratio:
SELECT * FROM information_schema.INNODB_BUFFER_POOL_STATS\G
SHOW ENGINE INNODB STATUS\G   -- "Buffer pool hit rate", "Modified db pages" (dirty)
-- scan resistance tuning: innodb_old_blocks_pct / innodb_old_blocks_time
```

**⚠️ Failure modes & gotchas.**
- **Buffer pool too small** → working set spills → disk-bound (low hit rate).
- **Too large** → starves OS/connections → swapping (catastrophic).
- **A big scan polluting the cache** — mitigated by the young/old LRU split (verify `old_blocks` tuning).

**💰 Fintech lens.** Hot accounts' pages stay in the young sublist (memory-speed balance reads); a nightly full-ledger reconciliation scan enters the old sublist and is evicted without polluting the hot set (scan resistance). Hit rate is the #1 health metric.

**🎯 Interview / SD angle.** "Caches *pages* (not results) in RAM; the hit rate is performance; young/old LRU gives scan resistance." Memory-hierarchy/caching principle. Why compact rows (M03/3.2) raise the hit rate. Not the removed query cache (M04/4.14).

**✅ Self-check.**
1. What does the buffer pool cache, and why is the hit rate the key metric?
2. How does the young/old LRU split give scan resistance?
3. How big should it be, and what's the danger of too big?

---

## 9.3 · Pages, tablespaces & the on-disk layout

**🔧 Code-specifics.**
```sql
SHOW VARIABLES LIKE 'innodb_page_size';          -- 16384 (16KB)
SHOW VARIABLES LIKE 'innodb_file_per_table';     -- ON (modern default → per-table .ibd)
SELECT name, file_size FROM information_schema.INNODB_TABLESPACES WHERE name LIKE '%ledger_entry%';
SELECT * FROM information_schema.FILES LIMIT 5;  -- physical files (data, undo, redo)
```

**⚠️ Failure modes & gotchas.**
- **Shared tablespace (`ibdata1`) never shrinks** — deleted data leaves holes (prefer file-per-table).
- **Many tiny tables file-per-table** → many file handles (rarely an issue).
- **Over-thinking page size** — 16KB is the right default for almost everyone.

**💰 Fintech lens.** `ledger_entry.ibd` (file-per-table) is a tree of 16KB pages (the clustered index, M01/1.3); the buffer pool caches its hot pages, redo records changes to them, undo holds old versions, recovery restores them — the ground-truth physical picture.

**🎯 Interview / SD angle.** "16KB pages → extents → tablespaces (file-per-table .ibd); separate sequential logs (redo/undo) from random-access data files by access pattern." File-per-table eases space reclamation, backup, per-table compression.

**✅ Self-check.**
1. What's the unit of I/O, and how do pages roll up to files?
2. Why separate the logs from the data files?
3. File-per-table vs shared tablespace — a benefit of each?

---

## 9.4 · The redo log (WAL): how commits become durable ★

**🔧 Code-specifics.**
```sql
-- size the redo log generously for write-heavy workloads (8.0.30+):
SHOW VARIABLES LIKE 'innodb_redo_log_capacity';   -- e.g. several GB for a busy ledger
SHOW VARIABLES LIKE 'innodb_log_buffer_size';     -- in-memory buffer before the files
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit';  -- =1: fsync redo each commit (9.10)
SHOW ENGINE INNODB STATUS\G   -- "Log sequence number" / "Last checkpoint at" (checkpoint age, 9.6)
```

**⚠️ Failure modes & gotchas.**
- **Undersized redo log** → checkpoint-age write stalls under bursts (9.13).
- **Oversized redo log** → longer crash recovery (9.6/9.14).
- **Confusing redo (physical, crash recovery) with binlog (logical, replication, M10).**

**💰 Fintech lens.** A transfer's COMMIT fsyncs its redo before returning "durable" (at `=1`) — so a power loss a microsecond later can't lose it (recovery replays). Sizing the redo log for the transfer rate prevents write stalls (9.13).

**🎯 Interview / SD angle.** "A sequential, circular, fsync'd log of physical page changes; commit durable once redo is on stable storage; replay on recovery." Bigger redo = smoother writes but longer recovery. Redo ≠ binlog (M10).

**✅ Self-check.**
1. When is a commit durable, relative to the data pages reaching disk?
2. What does redo log *size* trade?
3. Redo log vs binlog — physical/logical, and what each is for?

---

## 9.5 · The undo log: old versions for rollback & MVCC

**🔧 Code-specifics.**
```sql
-- undo lives in undo tablespaces (auto-managed, truncatable):
SELECT name FROM information_schema.INNODB_TABLESPACES WHERE name LIKE 'innodb_undo%';
SHOW VARIABLES LIKE 'innodb_undo_tablespaces';
-- the KEY metric — history list length (undo not yet purged, 9.12):
SHOW ENGINE INNODB STATUS\G   -- "History list length"
-- the long-txn culprit that pins undo:
SELECT trx_id, trx_started FROM information_schema.INNODB_TRX ORDER BY trx_started LIMIT 5;
```

**⚠️ Failure modes & gotchas.**
- **A long transaction pins undo** → blocks purge → history-list blowup (9.12, M07/7.15).
- **Frequently-updated hot row** → long version chain → slower MVCC reads (M08/8.2).
- **Conflating undo (old versions/rollback) with redo (durability)** — opposite jobs.

**💰 Fintech lens.** The undo that rolls back a failed transfer is the *same* undo a concurrent reconciliation read walks for the pre-transfer balance (M08/8.2). One structure → atomicity + MVCC.

**🎯 Interview / SD angle.** "Undo = the previous version → powers BOTH rollback (atomicity, M07/7.2) AND MVCC version chains (M08/8.2). The 'undo value' and the 'old version' are the same information." Long txn pins undo → bloat.

**✅ Self-check.**
1. What two purposes does the undo log serve, and why are they the same data?
2. What pins undo and causes history-list blowup?
3. Undo vs redo — opposite jobs?

---

## 9.6 · The LSN, checkpointing & flushing

**🔧 Code-specifics.**
```sql
SHOW ENGINE INNODB STATUS\G
--   Log sequence number  N        (newest LSN)
--   Last checkpoint at   M        (checkpoint LSN)
--   → checkpoint age = N − M = un-flushed work / redo fullness (9.13)
SHOW VARIABLES LIKE 'innodb_io_capacity';       -- guides adaptive flushing (9.13)
SHOW VARIABLES LIKE 'innodb_io_capacity_max';
```

**⚠️ Failure modes & gotchas.**
- **Checkpoint age approaching redo capacity** → forced flush + write throttle (stall, 9.13).
- **Large checkpoint age** → longer crash recovery (9.14).
- **Mis-set IO capacity** → adaptive flushing too slow (stalls) or too aggressive (wasted I/O).

**💰 Fintech lens.** Under a transfer burst, checkpoint age climbs; InnoDB flushes oldest-dirty pages first to advance the checkpoint and keep the redo log from filling. A too-small redo log → a checkpoint-age stall mid-burst (9.13/9.15).

**🎯 Interview / SD angle.** "LSN orders all changes (idempotent replay via per-page LSN); the checkpoint marks 'applied to data files'; checkpoint age bounds recovery time + redo reuse." Monotonic-sequence + checkpoint = replayable, bounded, idempotent log — same in replication (M10).

**✅ Self-check.**
1. What is the checkpoint age, and what two things does it govern?
2. How does the per-page LSN make redo replay idempotent?
3. What advances the checkpoint?

---

*Enrichment for 9.1–9.6 complete. Next Pass D file: 9.7–9.10.*
