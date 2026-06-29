# M13 · Pass D — Enrichment · Concepts 13.1–13.5

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL/config appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-why-ops-backups-pitr-rpo-rto.md` + `04-passC-…`. Domain: payments/wallet, the ledger.

---

## 13.1 · Why operations matters (the production reality)

**🔧 Code-specifics.**
```sql
-- operations is config + tooling + discipline, not one command. The four pillars map to:
-- backups/recovery (13.2/13.3/13.5) · online DDL (13.6) · observability (13.9) · security (13.14)
-- a correct+scalable DB (M01–M12) is necessary but NOT sufficient — operability is the rest
SHOW ENGINE INNODB STATUS\G   -- the operator's window (history list, checkpoint age, lock waits)
```

**⚠️ Failure modes & gotchas.**
- **Lost data** (no tested backup/PITR) · **locked migration** (naive ALTER) · **blind degradation** (no monitoring) · **breach** (weak security) — a *correct* system still dies these ways.
- **Assuming "correct + scalable" = "production-ready"** — operability is the missing half.

**💰 Fintech lens.** For money, each missing pillar is a money/trust catastrophe: an unrestorable backup loses the ledger; a locking migration stops payments; an unmonitored degradation becomes an outage; a breach drains accounts. Operations keeps the correct system correct *in production*.

**🎯 Interview / SD angle.** "A correct, scalable database still fails in production without operational discipline — recoverability (tested backups + PITR), safe change (online DDL), observability (early-warning), and security. Building it right is half the job; operating it is the other half." SRE's four concerns.

**✅ Self-check.**
1. Name the four operational pillars.
2. Give a way a *correct* DB still dies for each.
3. Why isn't "correct + scalable" enough for production?

---

## 13.2 · Backup types: logical, physical, snapshot ★

**🔧 Code-specifics.**
```bash
# logical (portable, slow restore):
mysqldump --single-transaction --source-data=2 payments > dump.sql   # consistent via MVCC
mydumper --threads 8 ...                                             # parallel
# physical (fast restore, the production base):
xtrabackup --backup --target-dir=/bak/full      # hot; --incremental for low RPO
xtrabackup --prepare --target-dir=/bak/full      # apply redo (M09) before restore
# snapshot: LVM / cloud EBS (flush+lock OR crash-consistent + redo recovery)
# ALL combine with the binlog for PITR (13.3); take from a REPLICA; ENCRYPT (13.14)
```

**⚠️ Failure modes & gotchas.**
- **Logical-only on a large DB** → catastrophic restore time (bad RTO).
- **Backing up the primary** (not a replica) → loads the transactional node.
- **Snapshot without consistency care** → an inconsistent image.
- **Un-tested** (13.5) — the silent killer.

**💰 Fintech lens.** Payments: **physical/snapshot base** (fast RTO) + **incrementals + continuous binlog** (low RPO via PITR) + **periodic logical** (portability/archive), from a replica, **encrypted**, **restore-tested** (13.5).

**🎯 Interview / SD angle.** "Logical (portable, slow restore) vs physical (fast restore, less portable) vs snapshot (fast, storage-level) — choose by RESTORE speed (RTO), size, portability; layer a change log for PITR. A backup's value is its restore." Universal taxonomy.

**✅ Self-check.**
1. Why is logical's restore slow, and when does that disqualify it?
2. Why is physical the typical production base?
3. Why take backups from a replica?

---

## 13.3 · Point-in-time recovery (PITR) via the binlog ★

**🔧 Code-specifics.**
```bash
# restore base backup, then replay the binlog forward to JUST BEFORE the disaster:
mysqlbinlog --stop-datetime='2026-06-28 14:29:59' binlog.000123 binlog.000124 | mysql
# or to a precise GTID (M10/10.7): --exclude-gtids / --stop-position
# requires: binlog RETAINED + DURABLE:
SET GLOBAL binlog_expire_logs_seconds = 1209600;   -- 14 days retention (≥ recovery window)
SET GLOBAL sync_binlog = 1;                         -- durable binlog (M09/9.10)
```

**⚠️ Failure modes & gotchas.**
- **Binlog not retained / not durable** → a **PITR gap** (can't rewind — *the* M15 catastrophe).
- **Infrequent base backups** → long replay → bad RTO.
- **No GTIDs** → fragile position math on replay.

**💰 Fintech lens.** A bad deploy at 14:30 (a `DELETE` missing `WHERE`) → restore the base + replay binlog to **14:29:59** → ledger recovered to one second before, every legitimate transfer kept, the bad change excluded. RPO≈0 with continuous durable binlog.

**🎯 Interview / SD angle.** "Full backup + change-log replay forward = recover to ANY moment, especially just before a disaster. The binlog's third use (after replicas, CDC). The log is primary — replay it to reconstruct any past state." Universal PITR.

**✅ Self-check.**
1. How does PITR recover to one second before a disaster?
2. What two binlog requirements make PITR possible?
3. Why do frequent base backups help RTO?

---

## 13.4 · RPO & RTO: the recovery objectives

**🔧 Code-specifics.**
```sql
-- RPO≈0 (no data loss): semi-sync (M10/10.4) + continuous durable binlog (sync_binlog=1) + PITR
SET GLOBAL rpl_semi_sync_source_enabled = 1;       -- committed transfer durable on a replica immediately
-- RTO≈seconds (low downtime): automated fenced failover to a hot standby (M10/10.10)
-- RTO≈minutes: fast physical/snapshot restore (13.2). measure REAL restore time (13.5) to validate
```

**⚠️ Failure modes & gotchas.**
- **Claiming an RTO you've never measured** (13.5 — only a real restore validates it).
- **Forgetting logical disasters replicate** — a bad `DELETE` reaches the standby; failover doesn't fix it, only backup-based PITR does.
- **Over-buying** near-zero RPO/RTO for low-value data.

**💰 Fintech lens.** A payments ledger: **RPO≈0** (no committed transfer lost) + **RTO≈seconds-minutes** (downtime stops payments) → semi-sync + automated failover (node loss) *plus* tested PITR (logical disasters/corruption that failover can't fix).

**🎯 Interview / SD angle.** "RPO = data-loss tolerance (drives capture frequency); RTO = downtime tolerance (drives restore speed + automation). Set from business cost, derive the strategy, VERIFY it meets them. Recovery is engineering, not hope." Universal DR framework.

**✅ Self-check.**
1. RPO vs RTO — what each drives?
2. Why does failover not cover a bad `DELETE` (and what does)?
3. Why must RTO be measured, not claimed?

---

## 13.5 · The backup you can't restore (tested restores) ★

**🔧 Code-specifics.**
```bash
# automated nightly restore DRILL → prove recoverability:
xtrabackup --copy-back --target-dir=/bak/full   # restore to a SCRATCH instance
mysqlbinlog ... | mysql                          # apply PITR to a target (13.3)
# VERIFY: checksums + RECONCILIATION (the data is CORRECT, not just present):
SELECT a.account_id FROM account a
JOIN (SELECT account_id, SUM(amount_minor) d FROM ledger_entry GROUP BY account_id) e
  ON e.account_id=a.account_id WHERE a.balance_minor <> e.d;   -- must be EMPTY (M12/12.14)
# measure restore time vs RTO · ALERT on any failure
```
> Money is `*_minor BIGINT` (integer minor units) — never FLOAT/DOUBLE.

**⚠️ Failure modes & gotchas.**
- **Untested backup** — corrupt / incomplete / un-decryptable (lost key, 13.14) / missing binlog — discovered *during* the disaster.
- **"Backup succeeded" status** tells you nothing about restorability.
- **Verifying presence but not correctness** — reconcile (M12/12.14), don't just count rows.

**💰 Fintech lens (★).** Automate nightly restore drills + reconciliation → *prove* the ledger is recoverable, *correctly*, within RTO, every night. "You don't have backups, you have restores." The backup that wouldn't restore when needed = *the* M15 cautionary tale.

**🎯 Interview / SD angle.** "A backup is worthless until a restore is tested — backups fail silently (corruption, incompleteness, key loss, missing binlog); only a verified restore proves recoverability and validates RPO/RTO. Automate the drill. 'Verify, don't assume.'" Hard-won SRE truth.

**✅ Self-check.**
1. Name three silent ways a backup fails.
2. Why verify by reconciliation, not just row counts?
3. Why is the deliverable "recoverability," not "backups"?

---

*Enrichment for 13.1–13.5 complete. Next Pass D file: 13.6–13.10.*
