# M15 · Pass D — Enrichment · Scenarios 15.7–15.11

> Pass D scope: **🔧 Recovery code-specifics · 💰 Money verdict · 🎯 Interview/SD angle · ✅ Self-check.** Pairs with `02-…` + `05-passC-…`. Domain: payments/wallet, the ledger.

---

## 15.7 · Binlog / redo loss & PITR gaps ★

**🔧 Code-specifics (prevention).**
```sql
SET GLOBAL sync_binlog = 1;                          -- durable binlog — no crash gap (the money setting)
SET GLOBAL binlog_expire_logs_seconds = 1209600;     -- retention ≥ recovery window (14 days)
-- archive binlogs OFF-HOST · frequent base backups · TESTED PITR DRILLS (M13/13.5 — reveal the gap)
```

**💰 Money verdict.** **Money UNRECOVERABLE in the gap** (coarse restore loses the window) — a RECOVERY catastrophe. Prevention: `sync_binlog=1` + retention + tested drills.

**🎯 Interview / SD angle.** "PITR needs the binlog RETAINED + DURABLE — a gap (short retention, sync_binlog=0, corruption) means that window is gone. The binlog's durability (M09) + retention (M13) gate recoverability. A tested drill reveals the gap before disaster." Universal.

**✅ Self-check.** 1. Four ways a PITR gap happens? 2. Why does a tested drill matter? 3. What gates recoverability?

---

## 15.8 · Recovering a dropped table / database

**🔧 Code-specifics (recovery).**
```bash
# restore base backup, then replay binlog EXCLUDING the DROP:
mysqlbinlog --stop-position=<just before DROP> binlog.000123 | mysql   # or --exclude-gtids the DROP's GTID
# PREVENT: REVOKE DROP from app accounts (least privilege, M13/13.14); distinct prod/staging creds
```

**💰 Money verdict.** **Money RECOVERABLE** (PITR to just before the DROP) — *if* you have the prerequisites; UNRECOVERABLE without them.

**🎯 Interview / SD angle.** "A DROP replicates (failover useless — it's a logical error everywhere). Recover via backup + binlog-replay-excluding-the-DROP. Prevent with DDL least-privilege + the PITR prereqs." Universal.

**✅ Self-check.** 1. Why doesn't failover recover a DROP? 2. The recovery procedure? 3. The two preventions?

---

## 15.9 · App-level loss the DB faithfully persists ★

**🔧 Code-specifics (prevention).**
```sql
-- atomic conditional UPDATE — no read-then-write gap (the fix):
UPDATE account SET balance_minor = balance_minor - :amt
WHERE account_id = :a AND balance_minor >= :amt;     -- second transfer's WHERE fails → correctly rejected
-- OR SELECT … FOR UPDATE (M08) · OR optimistic version column · + idempotency (M12/12.9)
-- RECOVER: re-derive from the immutable ledger (balance_minor = Σ amount_minor, M01/1.17, M12/12.14)
```

**💰 Money verdict.** **Money LOST by the app** (a lost update = wrong balance; the DB is correct, the app is wrong) — invisible to DB integrity checks. Recover: re-derive from the immutable ledger.

**🎯 Interview / SD angle.** "The DB does exactly what it's told — but a read-modify-write race (two transfers reading the same balance, each writing) loses an update. Invisible to CHECK TABLE/checksums (logical, not physical). Fix: atomic conditional UPDATE / FOR UPDATE / optimistic; reconcile against the immutable ledger." THE classic concurrency bug.

**✅ Self-check.** 1. Walk the lost-update race. 2. Why is it invisible to DB integrity checks? 3. The three prevention options + the recovery?

---

## 15.10 · The backup that won't restore ★

**🔧 Code-specifics (prevention).**
```bash
# automated nightly restore DRILL (the only prevention):
xtrabackup --copy-back --target-dir=/bak  # → scratch instance
mysqlbinlog … | mysql                      # apply PITR
# VERIFY: checksums + reconciliation (balance_minor = Σ amount_minor) · ALERT on failure
# + multiple backup types · off-site · key management (don't lose the encryption key, 15.6/13.14)
```

**💰 Money verdict.** **Money PERMANENTLY LOST** (data gone AND backup can't restore) — the operational catastrophe, ENTIRELY preventable by tested restores.

**🎯 Interview / SD angle.** "'Backup succeeded' (it ran) ≠ 'restore works'. Silent failures (corruption, incompleteness, key loss, missing binlog) accumulate, discovered during the disaster. Automated restore drills + reconciliation are the only prevention. 'You don't have backups, you have restores.'" THE cautionary tale.

**✅ Self-check.** 1. Four silent ways a backup fails to restore? 2. Why does "backup succeeded" tell you nothing? 3. The only prevention?

---

## 15.11 · Disk-full / out-of-space mid-write

**🔧 Code-specifics (recovery + prevention).**
```sql
PURGE BINARY LOGS TO 'binlog.000200';   -- free space (AFTER replicas/CDC consumed them, M10/M12)
-- PREVENT: the disk-space early-warning signal (M13/13.11 — alert at 80%!) + replica-health monitoring
-- (a down replica holds binlogs → they pile up → disk fills) + HLL monitoring (15.13)
```

**💰 Money verdict.** **Money movement STOPS (outage), possible corruption** at the failure point — a predictable, preventable catastrophe.

**🎯 Interview / SD angle.** "Disk fills (un-purged binlogs from a down replica, undo bloat, runaway temp files) → writes fail → crash/hang/replication-stop. A PREDICTABLE failure — watch disk space (M13/13.11), and it's never a surprise." Universal capacity monitoring.

**✅ Self-check.** 1. What fills the disk (name a few)? 2. The three consequences of a full disk? 3. The prevention?

---

*Enrichment for 15.7–15.11 complete. Next Pass D file: 15.12–15.16.*
