# M12 · Pass D — Enrichment · Concepts 12.1–12.5

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL/config appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-cap-pacelc-consistency.md` + `04-passC-…`. Domain: payments/wallet, the ledger.

---

## 12.1 · Why distributed data is hard (the shift)

**🔧 Code-specifics.**
```sql
-- the shift is config + routing, not one knob. The decisions you now own:
-- consistency: where do I read? (primary = strong, replica = eventual — M10/10.5/10.6)
-- atomicity:   is this operation single-shard (ACID) or cross-shard (needs Saga, 12.8)?
SELECT @@global.gtid_executed;   -- "which copy has what" — the question distribution forces
```

**⚠️ Failure modes & gotchas.**
- **Applying single-node intuitions to distributed data** → stale-read double-spends, dual-write loss, Sagas in limbo.
- **Assuming "the database" is one consistent place** when it's replicated + sharded + integrated.
- **Distributing what didn't need to be** (M11/11.15 — shard last).

**💰 Fintech lens.** Keep money operations single-node/single-shard where possible (M11/11.9 — ACID is free there); for the genuinely-distributed parts, choose consistency consciously + add idempotency/outbox/reconciliation. Distribution is where money is silently lost if you don't decide deliberately.

**🎯 Interview / SD angle.** "Distribution converts implicit single-node guarantees (consistency, atomicity, one source of truth) into explicit per-operation tradeoffs — you now *choose* consistency rather than *assume* it." The first move in all distributed design.

**✅ Self-check.**
1. Name the three single-node guarantees distribution breaks.
2. Which earlier module broke each (consistency/atomicity/single-truth)?
3. What's the discipline (distribute what, keep what single-node)?

---

## 12.2 · CAP theorem ★

**🔧 Code-specifics.**
```sql
-- MySQL's CAP stance = the replication/HA mode (M10):
--   async        → AP-ish (replicas available but stale; failover can lose un-replicated writes)
--   group replication / InnoDB Cluster → CP (majority quorum; partitioned MINORITY is unavailable for writes)
SELECT * FROM performance_schema.replication_group_members;   -- quorum/member states (CP behavior)
-- per-operation: money write/read → CP path (primary/quorum); display → AP path (async replica)
```

**⚠️ Failure modes & gotchas.**
- **Assuming "CA"** (consistent + available, no P) — only means you haven't hit a partition *yet*.
- **AP for a money decision** → authorize against stale/divergent data → overdraft/double-spend.
- **No fencing/quorum** → an AP-style partition forks the ledger (split-brain, M10/10.11).

**💰 Fintech lens.** Money-critical ops are **CP** (reject during a partition rather than authorize against stale data; group-replication quorum + fencing prevent a forked ledger, M10/10.11); non-critical reads can be **AP** (serve stale display). Choose per operation.

**🎯 Interview / SD angle.** "Under a partition you must choose Consistency or Availability — P isn't optional, so it's C-vs-A-when-partitioned, per operation. 'Reject vs serve-stale.' Spanner/etcd = CP; Dynamo/Cassandra = AP; MySQL's mode sets the dial." Foundational.

**✅ Self-check.**
1. Why is "pick two of CAP" misleading?
2. CP vs AP — what each sacrifices during a partition?
3. Which payments operations want CP vs AP?

---

## 12.3 · PACELC: the fuller picture

**🔧 Code-specifics.**
```sql
-- PACELC "else" knob = the semi-sync dial (M10/10.4): how many nodes ack before commit returns
SET GLOBAL rpl_semi_sync_source_enabled = 1;   -- EC: wait for a replica (consistent/durable, +latency)
-- async (default)                              -- EL: don't wait (fast, replicas stale)
SHOW STATUS LIKE 'Rpl_semi_sync_source_status'; -- verify it's actually EC (not silently degraded, M10/10.12)
```

**⚠️ Failure modes & gotchas.**
- **Over-focusing on CAP** (the rare partition case) and ignoring the *constant* latency-vs-consistency tradeoff.
- **Semi-sync silently degrading to async** (M10/10.12) → you think you're EC but you're EL.
- **One global EL/EC setting** instead of per-operation.

**💰 Fintech lens.** Money writes lean **EC** (semi-sync — pay latency for node-loss-durable consistency, M10/10.4); reports lean **EL** (async replicas — fast, stale-tolerant). The everyday dial, chosen per operation (12.15).

**🎯 Interview / SD angle.** "PACELC: if-Partition (A/C) else (Latency/Consistency). CAP omits the common case — consistency costs latency even when the network's fine. The 'else' knob (semi-sync / acks / quorum W) is what you actually tune." More complete than CAP.

**✅ Self-check.**
1. What does PACELC add to CAP?
2. What *is* the "else" knob in MySQL?
3. Why does the everyday tradeoff matter more than CAP's?

---

## 12.4 · The consistency spectrum ★

**🔧 Code-specifics.**
```sql
-- compose the level from read-routing + sync-mode (no single "consistency level" knob in MySQL):
-- STRONG (money decision)      → read the PRIMARY
-- READ-YOUR-WRITES (own data)  → SELECT WAIT_FOR_EXECUTED_GTID_SET('…', 1); then read replica  (M10/10.6)
-- EVENTUAL (reports/display)   → read an ASYNC replica  (M10/10.5)
```

**⚠️ Failure modes & gotchas.**
- **Reading an async replica for a money decision** → stale → double-spend (use the primary).
- **All-strong** (everything to the primary) → wastes the read-scaling replicas, hurts latency.
- **Forgetting read-your-writes** → user doesn't see their own payment → panic-retry (M10/10.6).

**💰 Fintech lens.** Balance-for-authorization → **strong** (primary); user's own history → **read-your-writes** (GTID-wait); reporting → **eventual** (async replica). Weakest-correct level per operation; eventual for money only with idempotency (12.9) + reconciliation (12.14).

**🎯 Interview / SD angle.** "Consistency is a ladder — linearizable → causal → read-your-writes → eventual — each weaker/cheaper/more-available. Pick the weakest level that's still correct per operation. Most data doesn't need strong; recognizing which does (money) is the skill." Universal.

**✅ Self-check.**
1. Name the ladder top to bottom.
2. Which level for a balance-for-authorization vs a report, and why?
3. How do you compose a level in MySQL (no single knob)?

---

## 12.5 · Eventual consistency & convergence

**🔧 Code-specifics.**
```sql
-- async replication IS eventual consistency (M10/10.5): replicas diverge, then converge via the binlog
SHOW REPLICA STATUS\G   -- Seconds_Behind_Source = the convergence window
-- single-primary = no write conflicts (one writer → just "catch up"); multi-primary group repl
--   resolves conflicts by CERTIFICATION (conflicting concurrent txn is ROLLED BACK, not silently merged)
```

**⚠️ Failure modes & gotchas.**
- **Reading eventually-consistent data for an irreversible decision** → money bug (use strong/RYW).
- **Last-write-wins conflict resolution** → silently loses an update (avoid for money).
- **Assuming convergence = correctness** — it means copies *agree*, not that they're *right*.

**💰 Fintech lens.** Eventual is fine for **display/reporting/propagation** (paired with idempotency 12.9 + reconciliation 12.14), a **double-spend bug for a money decision**. MySQL's single-primary eventual consistency is the easy kind (no write conflicts — just catch-up).

**🎯 Interview / SD angle.** "Stop writing → all copies eventually agree; meanwhile reads can be stale/out-of-order and concurrent writes need resolution. BASE vs ACID. Safe when staleness is tolerable + conflicts resolvable; convergence guarantees *agreement*, not *correctness*." Universal (Dynamo, CRDTs).

**✅ Self-check.**
1. What does "eventual" actually promise (and not)?
2. Why is single-primary MySQL's eventual consistency the "easy" kind?
3. When is eventual safe for money, when not?

---

*Enrichment for 12.1–12.5 complete. Next Pass D file: 12.6–12.10.*
