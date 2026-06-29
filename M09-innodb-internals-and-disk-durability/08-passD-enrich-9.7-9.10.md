# M09 · Pass D — Enrichment · Concepts 9.7–9.10

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-disk-sync-deep-dive.md` + `05-passC-…`. Domain: payments/wallet. **The disk-sync / data-loss material.** Catastrophic failures → M15.

---

## 9.7 · The durability chain (disk sync, in depth) ★

**🔧 Code-specifics.**
```sql
-- InnoDB's fsync behavior (the chain's software end):
SHOW VARIABLES LIKE 'innodb_flush_method';            -- O_DIRECT, fsync, … (9.8)
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit'; -- =1: fsync redo each commit
-- the chain BELOW MySQL must be honest (OS-level, not SQL):
--   Linux: `hdparm -W 0 /dev/sdX` (disable volatile drive write cache) OR use battery/capacitor-backed cache
--   verify cloud-storage durability semantics (EBS etc.) — fsync ack ≠ persisted/replicated
```

**⚠️ Failure modes & gotchas.**
- **Lying disk** — drive acks fsync from volatile cache → power loss loses "durable" data (M15).
- **"COMMIT returned = safe"** — false unless every chain layer honored the sync.
- **Cloud/network storage** adds layers + its own fsync semantics — "fast" ≠ durable; verify.
- **Drive write cache enabled + volatile** → silent power-loss data loss.

**💰 Fintech lens.** A "confirmed" payment is silently lost on power loss if any chain layer lied (volatile drive cache acking early). For money: honest storage (disabled/non-volatile write cache, capacitor-backed) + verified cloud durability — the foundation under (1,1) (9.10).

**🎯 Interview / SD angle.** "Durability is a chain (app → OS cache → drive cache → platter); fsync forces it down but each layer can LIE; trust durability only as far as the last honest layer." The lying-disk problem. Universal (OS/drive/RAID/network caches, replication acks).

**✅ Self-check.**
1. Name the layers of the durability chain and which are volatile.
2. What is the "lying disk" problem?
3. Why isn't "I called fsync" enough for durability?

---

## 9.8 · fsync, fdatasync, O_DIRECT & write barriers

**🔧 Code-specifics.**
```sql
SHOW VARIABLES LIKE 'innodb_flush_method';
--   O_DIRECT       → bypass OS cache for DATA files (avoid double-buffering) — common prod choice
--   fsync          → buffered + fsync
--   O_DIRECT_NO_FSYNC → O_DIRECT, skip fsync where storage guarantees durability (careful)
-- the redo log can use fdatasync semantics (fixed-size files).
-- fsync is the biggest per-commit cost → amortized by group commit (9.11).
```

**⚠️ Failure modes & gotchas.**
- **`O_DIRECT_NO_FSYNC` without true storage durability** → data loss.
- **Double-buffering** (no O_DIRECT) → wasted RAM + a copy (OS cache duplicates the buffer pool).
- **Expecting to optimize away fsync latency** — it's fundamental (synchronous physical I/O).

**💰 Fintech lens.** Payments config: `innodb_flush_method=O_DIRECT` (no double-buffering the large data files) + `flush_log_at_trx_commit=1` (fsync redo each commit) + group commit (9.11) + fast honest SSD → durable AND high-throughput.

**🎯 Interview / SD angle.** "fsync forces data+metadata to the device (the biggest per-commit cost); fdatasync skips non-essential metadata; O_DIRECT bypasses the OS cache to avoid double-buffering." Durability bottoms out in a slow synchronous primitive → batch it (group commit).

**✅ Self-check.**
1. fsync vs fdatasync vs O_DIRECT — what does each do?
2. Why is fsync the biggest per-commit cost?
3. What waste does O_DIRECT avoid?

---

## 9.9 · Torn / partial page writes & the doublewrite buffer ★

**🔧 Code-specifics.**
```sql
SHOW VARIABLES LIKE 'innodb_doublewrite';        -- ON (default) — torn-page protection
SHOW VARIABLES LIKE 'innodb_checksum_algorithm'; -- crc32 — detects torn pages on recovery
-- disable ONLY with verified atomic 16KB writes (some NVMe / ZFS):
--   innodb_doublewrite=OFF   -- removes torn-page protection — verify atomic writes first!
```

**⚠️ Failure modes & gotchas.**
- **Doublewrite OFF without atomic-write storage** → a crash mid-flush corrupts the page (silent corruption — worse than loss).
- **Assuming the redo log fixes torn pages** — it can't (it applies Δ to a *valid* page, 9.4).
- **Confusing torn-page protection (write-twice) with durability (WAL)** — different guarantees.

**💰 Fintech lens.** A crash during a `ledger_entry` page flush would tear it (corruption); recovery restores the intact copy from the doublewrite buffer (detected by bad checksum). Keep doublewrite ON — cheap insurance against ledger corruption.

**🎯 Interview / SD angle.** "A 16KB page write isn't atomic; a crash mid-write tears the page (redo can't fix it); the doublewrite buffer writes pages twice so a torn write is always recoverable." Durability ≠ torn-write protection (different mechanisms). "WAL ≠ safe from all crash corruption."

**✅ Self-check.**
1. What is a torn page, and why can't the redo log fix it?
2. How does the doublewrite buffer recover it?
3. When is it safe to disable doublewrite?

---

## 9.10 · The durability tradeoff matrix (flush_log_at_trx_commit × sync_binlog) ★

**🔧 Code-specifics.**
```sql
-- MONEY: (1, 1) — fully durable, consistent replicas/PITR:
SET GLOBAL innodb_flush_log_at_trx_commit = 1;   -- redo fsync'd every commit → lose nothing
SET GLOBAL sync_binlog = 1;                       -- binlog fsync'd every commit → replicas/PITR never miss
-- relax ONLY for loss-tolerant data:
--   innodb_flush_log_at_trx_commit = 2  -- power loss loses ~1s · sync_binlog = 0  -- replicas can miss
SHOW VARIABLES WHERE Variable_name IN ('innodb_flush_log_at_trx_commit','sync_binlog');
```

**⚠️ Failure modes & gotchas.**
- **Relaxed flush on money** (`=2`/`=0`, `sync_binlog=0`) → lose committed payments on power loss (M15).
- **(1,1) undermined by a lying disk** (9.7) — the setting alone isn't enough.
- **Low concurrency** → group commit can't amortize → (1,1) fsync cost is more visible.

**💰 Fintech lens (★).** **(1,1) is mandatory for money** — nothing lost on crash, replicas/backups consistent. Affordable via group commit (9.11) under concurrency. Relaxing to (2,0) is for reconstructible data only — never the ledger.

**🎯 Interview / SD angle.** "Two flush knobs form a matrix; each setting has a PRECISE loss window. (1,1) = nothing lost; (2,*) = power loss loses ~1s; sync_binlog=0 = replicas can miss." Durability is a dial, not binary — set it by "what can I afford to lose?" Money → (1,1).

**✅ Self-check.**
1. What exactly does each value of `innodb_flush_log_at_trx_commit` lose on a crash?
2. What does `sync_binlog=0` risk?
3. Why is (1,1) affordable at scale despite the fsyncs?

---

*Enrichment for 9.7–9.10 complete. Next Pass D file: 9.11–9.16.*
