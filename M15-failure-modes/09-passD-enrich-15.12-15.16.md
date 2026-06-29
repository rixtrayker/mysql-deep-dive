# M15 · Pass D — Enrichment · Scenarios 15.12–15.16

> Pass D scope: **🔧 Recovery code-specifics · 💰 Money verdict · 🎯 Interview/SD angle · ✅ Self-check.** Pairs with `03-…` + `06-passC-…`. Domain: payments/wallet, the ledger. These close out M15.

---

## 15.12 · OOM-killer victimizing mysqld

**🔧 Code-specifics (prevention).**
```sql
-- right-size: buffer pool + (max_connections × per-conn buffers) + OS < RAM (headroom!)
SET GLOBAL innodb_buffer_pool_size = 100*1024*1024*1024;   -- NOT 90%+ of RAM (leave headroom, M13/13.13)
-- + connection pooling/limits (M13/13.12) so per-connection memory is bounded
-- stopgap: echo -500 > /proc/$(pidof mysqld)/oom_score_adj   # de-prioritize mysqld for OOM
```

**💰 Money verdict.** **Money movement STOPS (outage)**; the crash itself recoverable if 1/1 (15.2). A capacity-planning catastrophe.

**🎯 Interview / SD angle.** "OOM-kill = memory over-commit: an over-sized buffer pool + a connection storm + per-connection buffers > RAM. Right-size with headroom + bound connections. A mis-sizing, not a bug." Universal Linux ops.

**✅ Self-check.** 1. What combines to cause OOM? 2. Why does a connection storm worsen it? 3. The prevention?

---

## 15.13 · Undo / history-list bloat from a forgotten long transaction

**🔧 Code-specifics (recovery + prevention).**
```sql
-- FIND + KILL the culprit:
SELECT trx_id, trx_started, trx_mysql_thread_id FROM information_schema.innodb_trx ORDER BY trx_started LIMIT 1;
KILL <thread_id>;   -- purge resumes → HLL drops → recovers (NO data loss)
-- PREVENT: the HLL early-warning signal (M13/13.11) + transaction timeouts + reporting on REPLICAS (M10)
```

**💰 Money verdict.** **Money movement DEGRADES then STOPS (outage)** — but NO data lost/duplicated (fully recoverable by killing the txn).

**🎯 Interview / SD angle.** "One forgotten long transaction pins undo (MVCC must preserve old versions) → HLL explodes → reads slow (long version chains) → outage. A trivial cause, a database-wide effect. Watch HLL (M13/13.11), enforce timeouts, keep txns short." Universal MVCC-bloat (Postgres VACUUM parallel).

**✅ Self-check.** 1. Why does a long txn bloat the HLL? 2. Why is no data lost? 3. The prevention?

---

## 15.14 · Replication breaks on a non-deterministic statement / data drift

**🔧 Code-specifics (prevention + detection).**
```sql
SET GLOBAL binlog_format = ROW;   -- PREVENT: ship the exact row result, no re-execution divergence (M10/10.3)
-- DETECT drift: pt-table-checksum (source vs replica row-by-row)
-- FIX a stopped applier: SHOW REPLICA STATUS (Last_SQL_Error) → fix the row, resume — OR re-sync (rebuild)
```

**💰 Money verdict.** **Money copy DIVERGES (wrong replica ledger) or HA LOST (stopped applier)** — a self-inflicted, preventable catastrophe.

**🎯 Interview / SD angle.** "SBR + a non-deterministic statement (UUID/NOW/RAND, LIMIT without ORDER BY) → replica diverges or the applier stops. ROW format prevents it (ship the result, not the operation). Never use SBR for money; verify with pt-table-checksum." Universal (deterministic-state-machine replication).

**✅ Self-check.** 1. Why does SBR + non-determinism diverge? 2. The two failure modes? 3. The prevention + detection?

---

## 15.15 · The "I lost data — now what?" triage tree ★

**🔧 Code-specifics (the runbook's commands).**
```sql
-- CONTAIN: halt the deploy/script; fence a diverging node (infra); freeze writes
-- ASSESS: reconcile to quantify — SELECT … WHERE balance_minor <> (SELECT SUM(amount_minor) …)
-- RECOVER (per scenario): PITR (mysqlbinlog --stop-position) / failover / force_recovery / re-derive from ledger
-- VERIFY: reconcile again (balance = Σ entries, internal = external) — PROVE correctness
```

**💰 Money verdict.** The meta-runbook: the discipline (contain → recover → VERIFY/reconcile) makes the money verdict answerable + the recovery trustworthy.

**🎯 Interview / SD angle.** "Incident response: CONTAIN first (before investigating — it worsens while you diagnose) → ASSESS (classify + quantify via reconciliation) → RECOVER (the right path) → VERIFY (reconcile — 'recovered' without reconciliation isn't recovered) → POST-MORTEM. The order is sacred for money." SRE incident management.

**✅ Self-check.** 1. Why contain BEFORE investigating? 2. Why is verify (reconcile) non-negotiable? 3. Walk the five steps.

---

## 15.16 · The prevention checklist (so none of this happens) ★

**🔧 Code-specifics (the consolidated posture).**
```sql
-- the prevention posture (the money settings + the universals):
-- flush_log_at_trx_commit=1 + sync_binlog=1 + semi-sync (15.2) · fencing/quorum (15.3) · super_read_only (15.4)
-- checksums + doublewrite + honest fsync (15.5) · tested backups + durable retained binlog + PITR drills (15.6/15.7/15.10)
-- DDL least-privilege (15.8) · atomic UPDATE/FOR UPDATE + idempotency (15.9) · early-warning signals (15.11-13)
-- binlog_format=ROW + pt-table-checksum (15.14) · RECONCILIATION the universal backstop (all) · money = *_minor BIGINT
```

**💰 Money verdict (★).** **Money SAFE** — if the checklist is followed (every catastrophe prevented or cleanly recoverable + verified). The money-never-lies posture *against catastrophe*.

**🎯 Interview / SD angle.** "Three universals underpin all prevention: durability config (no lost commit + durable binlog), reconciliation (detect anything that slipped through), tested recovery + early-warning (proven recoverable + catch the buildups). Catastrophes are SURVIVABLE — that's what 'zero data loss' costs (M16's DR)." The chapter's synthesis.

**✅ Self-check.** 1. Match three catastrophes to their preventions. 2. The three universals? 3. What does "zero data loss really cost" mean here?

---

*Enrichment for 15.12–15.16 complete. **M15 Pass D is fully drafted (all 16 scenarios) — M15 is now content-complete across Passes A–D.** This completes the critical Failure Modes & Data Loss chapter.*
