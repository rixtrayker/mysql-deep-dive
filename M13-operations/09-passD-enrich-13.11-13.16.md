# M13 · Pass D — Enrichment · Concepts 13.11–13.16

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-earlywarning-pooling-config-security-capstone.md` + `06-passC-…`. Domain: payments/wallet, the ledger. These close out M13.

---

## 13.11 · Early-warning signals (predict, don't react) ★

**🔧 Code-specifics.**
```sql
-- the leading indicators (alert at actionable thresholds, with runbooks M14):
SHOW ENGINE INNODB STATUS\G          -- "History list length" (M08/M09) · checkpoint age (M09)
SHOW REPLICA STATUS\G                 -- Seconds_Behind_Source / GTID gap (M10/10.5)
SHOW GLOBAL STATUS LIKE 'Threads_connected';            -- vs max_connections (13.12)
SHOW GLOBAL STATUS LIKE 'Rpl_semi_sync_source_status';  -- 0 = degraded! (M10/10.12 money gotcha)
-- + disk space / I/O (OS)
```

**⚠️ Failure modes & gotchas.**
- **Watching only lagging indicators** (the outage) instead of leading ones (the buildup).
- **Alert fatigue** (thresholds too tight) or **missed warnings** (too loose).
- **Un-watched signals become the M15 incident** (HLL → read stall, disk → crash, semi-sync 0 → silent durability loss).

**💰 Fintech lens.** Alert on a **growing HLL** (kill the long txn before bloat), **growing lag** (before a money bug / bad failover), **high checkpoint age** (before a flush stall), **connection saturation** (before a storm), **semi-sync degraded** (before silent durability loss, M10/10.12), **filling disk** (before a crash).

**🎯 Interview / SD angle.** "Watch the LEADING indicators that climb before failure (saturation building), not just the LAGGING ones — intervene during the buildup, while preventable. The M08/M09/M10 internals ARE the early-warning signals. The best incident is the one you prevented." Universal (SRE).

**✅ Self-check.**
1. Name three early-warning signals and what each predicts.
2. Leading vs lagging indicators — why watch leading?
3. Why is semi-sync status special (reveals, not predicts)?

---

## 13.12 · Connection management & pooling

**🔧 Code-specifics.**
```sql
SHOW VARIABLES LIKE 'max_connections';
SHOW GLOBAL STATUS LIKE 'Threads_connected';   -- saturation → outage if near max
-- pool: app-side (HikariCP) sized conservatively, OR ProxySQL (multiplex many app conns → few DB conns)
-- a SMALLER pool is often FASTER (DB handles bounded concurrency best, M04/M08)
```

**⚠️ Failure modes & gotchas.**
- **Connection storm** (unbounded growth on a spike + retries) → "Too many connections" → outage.
- **Too-large pool** → exhausts the server (defeats the purpose).
- **No pooling** → connection-storm crash + open/close cost.

**💰 Fintech lens.** ProxySQL pooling keeps the per-shard connection count stable/bounded → a traffic spike (or a retry storm from M12's idempotent retries) is *absorbed by queuing*, not amplified into a "too many connections" outage that stops payments.

**🎯 Interview / SD angle.** "Connections are finite/expensive → pool them (reuse a bounded set, queue excess) so spikes are ABSORBED (queued) not AMPLIFIED (unbounded creation → exhaustion). Bound concurrency, queue the excess. A smaller pool is often faster." Universal resource pooling.

**✅ Self-check.**
1. How does a connection storm cause an outage?
2. How does pooling absorb (not amplify) a spike?
3. Why is a smaller pool sometimes faster?

---

## 13.13 · Config tuning that actually matters

**🔧 Code-specifics.**
```sql
SET GLOBAL innodb_buffer_pool_size = 100*1024*1024*1024;   -- ~70-80% RAM (M09 — the biggest lever)
SET GLOBAL innodb_flush_log_at_trx_commit = 1;             -- full durability (M09 — money setting)
SET GLOBAL sync_binlog = 1;                                -- durable binlog (M09 — money setting)
SET GLOBAL rpl_semi_sync_source_enabled = 1;              -- node-loss durability (M10 — money setting)
-- redo log size (innodb_redo_log_capacity) large enough (M09); max_connections bounded (13.12)
-- everything else: sensible defaults — change only with MEASUREMENT
```

**⚠️ Failure modes & gotchas.**
- **Cargo-culting** an internet config → breaks durability or hurts perf.
- **`flush_log_at_trx_commit=2` for "speed"** → silently risks losing committed transfers (a *correctness* bug, M09).
- **Tuning blindly** without measuring one-change-at-a-time.

**💰 Fintech lens.** The durability settings (`flush_log_at_trx_commit=1`, `sync_binlog=1`, semi-sync) are **correctness settings** for money — getting them wrong silently loses transfers. Tune buffer pool for speed; set durability for money; leave the rest alone.

**🎯 Interview / SD angle.** "A few settings dominate (buffer pool, durability, sync mode, connections, redo size); most defaults are fine. Tune the impactful few WITH measurement; never cargo-cult. Never trade correctness (durability) for performance without knowing what you're risking." Universal (80/20 tuning).

**✅ Self-check.**
1. The handful of settings that matter?
2. Why are the durability settings *correctness* settings for money?
3. Why never cargo-cult an internet config?

---

## 13.14 · Security: auth, TLS, encryption, least privilege, audit ★

**🔧 Code-specifics.**
```sql
CREATE USER 'transfer_svc'@'%' IDENTIFIED BY '...' REQUIRE SSL;   -- per-service, TLS
GRANT SELECT, INSERT, UPDATE ON payments.ledger_entry TO 'transfer_svc'@'%';  -- LEAST PRIVILEGE
GRANT SELECT ON payments.* TO 'reporting_svc'@'%';   -- read-only (replicas) — no DROP/SUPER
SET GLOBAL require_secure_transport = ON;            -- TLS everywhere
-- InnoDB tablespace encryption (ENCRYPTION='Y') + encrypted backups (KMS) + audit plugin
```

**⚠️ Failure modes & gotchas.**
- **Shared superuser / `root` in apps** → a leak is catastrophic (no blast-radius bound).
- **Plaintext connections** → sniffable credentials/data.
- **Lost encryption key** → un-restorable backups (13.5 — self-inflicted M15).
- **No audit** → no compliance, no forensics.

**💰 Fintech lens (★).** Per-service least-privilege accounts (transfer svc can write the ledger, not drop it; reporting reads replicas only; no root), TLS everywhere, encrypted data + backups (rigorous KMS), column encryption for card/PII (M03), full audit trail. Non-negotiable + regulated (PCI-DSS).

**🎯 Interview / SD angle.** "Defense in depth: authenticate (per-service), encrypt in transit (TLS) + at rest, least privilege (bound the blast radius), audit. Assume any single control fails; layer so the system stays secure. Least privilege is highest-leverage. A correct DB that's insecure is still a catastrophe." Universal.

**✅ Self-check.**
1. Name the five security layers.
2. Why is least privilege the highest-leverage control?
3. What's the encryption-key-loss hazard?

---

## 13.15 · Choosing the operational posture (the decision)

**🔧 Code-specifics.**
```sql
-- the posture is DERIVED from requirements (not one knob):
-- RPO/RTO (13.4) → backup/DR · scale (M11) → per-shard ops · change freq → online DDL (13.6)
-- risk/value → monitoring depth (13.11) · compliance → security (13.14)
-- payments: RPO≈0 + fast RTO + PCI-DSS + high value + sharded → the FULL posture (every dim high-end)
```

**⚠️ Failure modes & gotchas.**
- **Under-investing for high-value** (untested backups on a payments platform = catastrophe).
- **Over-investing for low-stakes** (gold-plating a throwaway app).
- **Cargo-culting a posture** instead of deriving from requirements.

**💰 Fintech lens.** Payments derives the *full* posture: tested PITR, automated failover, online DDL, deep monitoring + early-warning, reconciliation, strong security — *each justified by a specific requirement* (RPO≈0, fast RTO, PCI-DSS, high value, sharded).

**🎯 Interview / SD angle.** "Derive the operational posture from RPO/RTO + scale + risk + compliance — full rigor where failure is catastrophic (money), modest where it isn't. Match investment to cost of failure; derive, don't guess." Same requirements-driven right-sizing as M07/M09/M12.

**✅ Self-check.**
1. What requirements drive the posture?
2. Why full posture for money, modest for low-stakes?
3. Derive vs guess — why does it matter?

---

## 13.16 · Fintech capstone: the operable payments platform ★

**🔧 Code-specifics.**
```sql
-- the full operational posture (the pieces together, per shard M11):
-- XtraBackup/snapshot (from replicas, encrypted) + continuous durable binlog → PITR (13.3)
-- + automated restore drills + reconciliation (13.5) + automated fenced failover (M10)
-- + online DDL gh-ost/native (13.6) + ProxySQL pooling (13.12) + tuned config (money settings, M09/M10)
-- + golden signals + early-warning (13.11) + reconciliation watchdog (M12/12.14)
-- + least privilege + TLS + encryption + audit (13.14); money = *_minor BIGINT (never FLOAT)
SHOW GLOBAL STATUS LIKE 'Rpl_semi_sync_source_status';   -- verify durability per shard (M10/10.12)
```

**⚠️ Failure modes & gotchas.**
- **The backup that won't restore · the migration that locks the ledger · the unmonitored degradation · the breach** — the catastrophic failures of each operational topic (all → M15).
- **Operational posture absent or failing** = a correct, scaled system still dies in production.

**💰 Fintech lens (★).** The correct (M01–M09), scaled (M10–M12) ledger is **backed up + proven-recoverable, evolvable without downtime, watched for trouble before it's an outage, resilient to load, secured in depth, and continuously reconciled** — so it *stays* correct and available in production.

**🎯 Interview / SD angle.** "Operability = recoverability (tested) + safe change + observability (leading indicators) + resilience + security + verification, sized to value — full for money. Correctness + scalability are necessary but NOT sufficient; a high-value system is trustworthy only if operable." The operational culmination (M01→M13); sets up M15/M16.

**✅ Self-check.**
1. For each pillar (recover, change, observe, secure), what does the platform do?
2. Why are correctness + scalability not sufficient?
3. What's the relationship between this module and M15?

---

*Enrichment for 13.11–13.16 complete. **M13 Pass D is fully drafted (all 16 concepts) — M13 is now content-complete across Passes A–D.***
