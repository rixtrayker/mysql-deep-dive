# M15 · Pass D — Enrichment · Scenarios 15.1–15.6

> **Pass D scope:** **🔧 Recovery code-specifics** (the exact commands), **💰 Money verdict** (reinforced), **🎯 Interview / SD angle**, **✅ Self-check** — per scenario. Pairs with `01-…` + `04-passC-…`. Domain: payments/wallet, the ledger. Money is `*_minor BIGINT` / `DECIMAL` — never FLOAT; reserved word `transaction` → `transaction_`.

---

## 15.1 · How to think about failure (the discipline) ★

**🔧 Code-specifics (the discipline's tools).**
```sql
-- WATCH (early-warning, M13/13.11): SHOW ENGINE INNODB STATUS (HLL, checkpoint age) · SHOW REPLICA STATUS (lag)
-- TEST (M13/13.5): automated restore drill + reconciliation
-- RECONCILE (M12/12.14): SELECT … WHERE balance_minor <> (SELECT SUM(amount_minor) …)  -- detect drift
```

**💰 Money verdict.** For money, "did it get lost/duplicated?" must be *answerable* (reconciliation as detector + tested recovery as remedy). A system that can't answer has *already* failed money-never-lies.

**🎯 Interview / SD angle.** "The worst failures are silent (wrong data, no error) and rare (strike when unprepared) — so know them, watch early-warning, test recovery, reconcile. Assume failures happen; design to detect/recover/prevent." Chaos-engineering/SRE mindset.

**✅ Self-check.** 1. Why are silent + rare failures uniquely dangerous for money? 2. The four-part discipline? 3. Why must "did money get lost?" be answerable?

---

## 15.2 · Lost transactions on crash (the durability window) ★

**🔧 Code-specifics (prevention + recovery).**
```sql
-- PREVENT (the money settings): SET GLOBAL innodb_flush_log_at_trx_commit=1; SET GLOBAL sync_binlog=1;
SET GLOBAL rpl_semi_sync_source_enabled=1;   -- + semi-sync → survives total primary loss (M10)
-- RECOVER (after loss): reconcile vs external records → re-drive lost transfers IDEMPOTENTLY (M12/12.9)
-- choose the freshest replica on failover: largest gtid_executed (M10/10.10)
```

**💰 Money verdict.** **Money LOST** (confirmed transfers vanish silently) — *unless* 1/1 + semi-sync (then nothing lost). Detection: reconciliation.

**🎯 Interview / SD angle.** "Durability = fsync before ack; any acks-before-fsync config has a crash-loss window. flush_log=2 loses ~1s on OS/power crash; promote-before-apply loses the replica's lag. Money = 1/1 + semi-sync closes it (group commit amortizes)." Universal.

**✅ Self-check.** 1. What does each config lose on a crash? 2. How do 1/1 + semi-sync close the window? 3. How do you recover lost transfers?

---

## 15.3 · Source/replica divergence & split-brain ★

**🔧 Code-specifics (prevention + recovery).**
```sql
-- PREVENT: fencing/STONITH (infra: power-off/network-ACL the old primary BEFORE promote) OR quorum (group replication)
SET GLOBAL super_read_only=ON;   -- replicas can't accidentally become a 2nd writer
-- RECOVER: stop both → pick authoritative → GTID set-diff (SELECT @@global.gtid_executed on each)
--   → manually reconcile each conflict vs external records (M12/12.14) — slow, lossy
```

**💰 Money verdict (★).** **Money DUPLICATED/FORKED & effectively LOST** — the WORST catastrophe, UNRECOVERABLE cleanly. Prevention (fencing/quorum) is the ONLY acceptable strategy.

**🎯 Interview / SD angle.** "Two writers → the ledger forks irreconcilably (both have real money, no auto-merge). Fencing BEATS reconciliation — prevent it (STONITH/quorum), never fail over without fencing. Why consensus algorithms exist." THE canonical distributed catastrophe.

**✅ Self-check.** 1. Why is a forked ledger worse than data loss? 2. The two prevention strategies? 3. Why "fence before promote, always"?

---

## 15.4 · Errant transactions & GTID drift

**🔧 Code-specifics.**
```sql
SET GLOBAL super_read_only=ON;   -- PREVENT (even SUPER users can't write the replica, M10/10.7)
-- DETECT: compare gtid_executed (replica has GTIDs the source lacks)
-- FIX: inject empty transactions on the source for the errant GTIDs (reconcile sets) OR rebuild the replica
```

**💰 Money verdict.** **Money at RISK indirectly** — breaks failover (HA loss) or seeds divergence (split-brain). Prevention: `super_read_only`.

**🎯 Interview / SD angle.** "A replica-local write creates a GTID the source lacks → breaks GTID failover/re-pointing later (the worst time). A latent, silent failure. Followers must be STRICTLY read-only — super_read_only." Universal log-shipping lesson.

**✅ Self-check.** 1. What's an errant transaction and why latent? 2. How does it break failover? 3. The prevention + the repair?

---

## 15.5 · Silent corruption (bit rot, lying disks, torn pages) ★

**🔧 Code-specifics.**
```sql
-- PREVENT: page checksums + doublewrite ON (M09); honest fsync (M09/9.7 — disable volatile disk caches)
SET GLOBAL innodb_doublewrite=ON;   -- torn-page protection
CHECK TABLE ledger_entry;            -- scan for corruption
-- DETECT logical corruption: reconciliation (M12/12.14). RECOVER: restore + PITR (15.7) / extract + rebuild
```

**💰 Money verdict.** **Money silently WRONG** (corrupt balances acted on as truth) — the SILENT catastrophe. Defend (checksums/doublewrite) AND detect (reconcile) — no error otherwise.

**🎯 Interview / SD angle.** "Data corrupts silently (bit rot, lying disks, torn pages) — no error. Page checksums DETECT on read; the doublewrite buffer PREVENTS torn pages; honest fsync + reconciliation. Corruption replicates + gets into backups." Universal storage reality.

**✅ Self-check.** 1. Three corruption sources? 2. How do checksums + doublewrite defend? 3. Why is reconciliation needed beyond checksums?

---

## 15.6 · innodb_force_recovery: the last resort (levels 1–6) ★

**🔧 Code-specifics (the procedure).**
```ini
# my.cnf — lowest level that starts (1→6, each MORE dangerous):
innodb_force_recovery = 3
```
```sql
-- then: go READ-ONLY → mysqldump (extract the ledger) → build a FRESH server, reload → RECONCILE (M12/12.14)
-- NEVER run production on a forced server
```

**💰 Money verdict.** **Money at RISK of being WRONG** (may extract inconsistent data) → MUST reconcile before trust. Real prevention: tested backups + healthy replicas (restore-clean).

**🎯 Interview / SD angle.** "When InnoDB won't start, force_recovery 1–6 disables recovery features to extract data — each higher level more dangerous (can corrupt further). A SALVAGE: lowest level → dump → rebuild → reconcile. Tested backups mean you never need it." Universal emergency-salvage discipline.

**✅ Self-check.** 1. When/why use force_recovery, and why is higher more dangerous? 2. The correct procedure? 3. Why reconcile the extracted data?

---

*Enrichment for 15.1–15.6 complete. Next Pass D file: 15.7–15.11.*
