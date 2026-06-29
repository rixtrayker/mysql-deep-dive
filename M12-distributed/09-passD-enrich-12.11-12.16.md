# M12 · Pass D — Enrichment · Concepts 12.11–12.16

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `03-outbox-cdc-reconciliation-capstone.md` + `06-passC-…`. Domain: payments/wallet, the ledger. These close out M12 and Track D.

---

## 12.11 · The outbox pattern ★

**🔧 Code-specifics.**
```sql
CREATE TABLE outbox (
  event_id BINARY(16) PRIMARY KEY, event_type VARCHAR(64), payload JSON,
  published TINYINT DEFAULT 0, created_at DATETIME );
-- write the event IN the business transaction (atomic with the state change):
BEGIN; /* debit/credit/ledger */ INSERT INTO outbox (event_id, event_type, payload) VALUES (…); COMMIT;
-- relay: poll (SELECT … WHERE published=0) OR (better) Debezium CDC on the binlog (12.12) → Kafka
```

**⚠️ Failure modes & gotchas.**
- **Relay is at-least-once** (republishes on restart) → consumers must be idempotent (12.13).
- **Outbox table grows** → purge published rows.
- **Polling latency/load** → prefer CDC-driven publishing.

**💰 Fintech lens.** Every money event ("TransferCompleted") is written to the **outbox in the transfer's transaction** (M11/11.9, atomic) → guaranteed never lost; CDC/relay publishes to fraud/notifications/warehouse. The backbone of reliable event propagation.

**🎯 Interview / SD angle.** "Make the event part of the state-change transaction (outbox table), then relay async + reliably — event can't be lost or phantom, no distributed transaction. One atomic write = source of truth; the event is derived reliably." Standard reliable-event-publishing pattern (+ at-least-once → idempotent consumers).

**✅ Self-check.**
1. How does the outbox prevent lost/phantom events?
2. Why must consumers be idempotent despite the outbox?
3. Poll vs CDC for the relay — the tradeoff?

---

## 12.12 · Change Data Capture (CDC) ★

**🔧 Code-specifics.**
```sql
-- CDC = Debezium reads the binlog as a replica → Kafka. Requirements:
SET GLOBAL binlog_format = ROW;   -- exact before/after images (M10/10.3)
SET GLOBAL sync_binlog = 1;       -- durable binlog (M09/9.10)
-- Debezium tracks GTID (M10/10.7) → resumes exactly (no loss/skip); one topic per table, commit order
-- consumers: fraud · search · warehouse (M02/2.17) · outbox relay (12.11) — all idempotent (12.13)
```

**⚠️ Failure modes & gotchas.**
- **STATEMENT binlog format** → CDC can't get exact row images (needs ROW).
- **Schema changes (DDL)** on the source must be handled/propagated.
- **Consumers lag** the source (eventual) — fine for propagation, not for money decisions.
- **Per-shard binlogs** (M11) → CDC runs per shard.

**💰 Fintech lens.** The ledger's binlog is streamed via CDC to fraud (real-time), search, the reporting warehouse (M02/2.17), and the outbox relay — reliable, ordered, low-latency, *without dual-writes*. The integration backbone (M16).

**🎯 Interview / SD angle.** "The replication log is a reliable, ordered, durable stream of every committed change — capture it (Debezium) and publish (Kafka) for integration without dual-writes. The log is primary; replicas, backups, search, cache, analytics, services are all *derived* consumers. 'Turning the database inside-out.'" Universal CDC.

**✅ Self-check.**
1. Why does CDC need ROW format + durable binlog?
2. How does Debezium guarantee no lost/skipped changes?
3. State the "log is primary, derive the rest" principle.

---

## 12.13 · Idempotent consumers & exactly-once (the truth)

**🔧 Code-specifics.**
```sql
-- consumer-side dedup = idempotency (12.9) in the consumer role:
BEGIN;
  INSERT INTO processed_event (event_id) VALUES (:event_id);  -- UNIQUE → duplicate = "seen" → skip
  /* apply the effect (e.g., update a balance read-model) — SAME txn */
COMMIT;   -- at-least-once delivery + this idempotent processing = exactly-once EFFECT
```

**⚠️ Failure modes & gotchas.**
- **Chasing "exactly-once delivery"** — a myth for external effects; engineer at-least-once + idempotency.
- **At-most-once** (no dedup, no retry) → *loses* messages → unacceptable for money.
- **Recording the event_id separately from the effect** → a crash between → re-apply on redelivery.

**💰 Fintech lens.** A CDC/outbox "credit" event delivered twice (relay restart) → the second hits the `processed_event` unique constraint → **no-op** → no double-credit. Every consumer (fraud, notifications, warehouse, balance read-model) is idempotent.

**🎯 Interview / SD angle.** "Exactly-once *delivery* is impossible (the network forces redeliver-or-lose); exactly-once *effect* = at-least-once delivery + idempotent processing. Never lose (at-least-once), make duplicates harmless (idempotency)." Corrects the common misconception.

**✅ Self-check.**
1. Why is exactly-once delivery a myth (for external effects)?
2. What two things combine to give exactly-once effect?
3. Why is at-most-once unacceptable for money?

---

## 12.14 · Reconciliation as the distributed backstop

**🔧 Code-specifics.**
```sql
-- re-derive the truth independently and compare (run on a replica/warehouse, M02/2.17):
SELECT a.account_id
FROM account a
JOIN (SELECT account_id, SUM(amount_minor) AS derived FROM ledger_entry GROUP BY account_id) e
  ON e.account_id = a.account_id
WHERE a.balance_minor <> e.derived;   -- DRIFT → alert + investigate + repair (compensating entry + audit)
-- also: match internal ledger vs external processor settlement records
```

**⚠️ Failure modes & gotchas.**
- **No independent source** — re-deriving from the same source just re-confirms the bug.
- **No reconciliation** → distributed inconsistencies go undetected → unrecoverable loss.
- **Reconciling on the primary** → load; run on replicas/warehouse.

**💰 Fintech lens (★).** The money-never-lies backstop: re-derive balances from the **immutable ledger**, match **external processor** records, daily → catches a half-completed Saga (12.8), a missed event (12.10), a bug → repair with a compensating entry + audit trail (M01/1.17). Eventual consistency + the patterns are safe *because* reconciliation catches residual drift.

**🎯 Interview / SD angle.** "No distributed system is perfectly consistent → independently re-derive the truth and compare to detect/repair drift. Design invariants to be *checkable* (balance derived from entries) and verify continuously. The final answer to 'did money get lost?' is 'reconciliation would catch it.'" The money-never-lies safety net.

**✅ Self-check.**
1. Why must the re-derivation use an *independent* source?
2. What invariants does it check (debit=credit, balance=Σentries, internal=external)?
3. Why does it make eventual consistency safe for money?

---

## 12.15 · Choosing consistency per operation (the decision)

**🔧 Code-specifics.**
```sql
-- the per-operation map (compose routing + sync + patterns):
-- authorize/transfer → read PRIMARY (strong) · single-shard ACID (M11/11.9) or Saga+idempotency · semi-sync
-- own post-write read → WAIT_FOR_EXECUTED_GTID_SET (read-your-writes, M10/10.6)
-- propagation        → outbox + CDC + idempotent consumers (12.11/12.12/12.13)
-- reporting/display  → ASYNC replica / warehouse (eventual, M10/10.5)
-- every money op backed by reconciliation (12.14)
```

**⚠️ Failure modes & gotchas.**
- **One global level** — all-strong (slow/unavailable/expensive) or all-eventual (loses money).
- **Applying patterns blindly** — a Saga where co-location would do (M11/11.9); strong where eventual is fine.
- **Mis-classifying** an operation's cost-of-being-wrong.

**💰 Fintech lens.** Bulletproof the money path (strong + atomic + small via co-location), make everything else reliable-but-eventual (idempotent + reconciled). Heterogeneous by design — correctness where critical, scale/availability where affordable.

**🎯 Interview / SD angle.** "Consistency is chosen per operation by cost-of-being-wrong — strong+atomic for irreversible/critical, eventual+idempotent+reconciled for propagation, weakest-correct everywhere. A well-designed distributed system is *heterogeneous* in consistency, never one-size-fits-all." The synthesis skill.

**✅ Self-check.**
1. Walk the per-operation map for payments.
2. Why is one global level always wrong?
3. What two failure modes does the framework prevent?

---

## 12.16 · Fintech capstone: the consistent-enough payments platform ★

**🔧 Code-specifics.**
```sql
-- the composed distributed design (the pieces together):
-- money path: co-located transfer = single-shard ACID (debit+credit+ledger+idempotency_key+outbox, M07–M09)
--   cross-shard = Saga + idempotency (12.8/12.9); reads: primary (strong) / GTID-wait (RYW, M10/10.6)
-- substrate: each shard replicated — semi-sync (node-loss durable, M10/10.4) + CP under partition (quorum/fencing)
-- propagation: outbox (12.11) → Debezium CDC (12.12, ROW + sync_binlog=1) → idempotent consumers (12.13)
-- backstop: reconciliation (12.14) re-derives from the immutable ledger, matches external records, daily
-- money = *_minor BIGINT (never FLOAT); per-operation consistency (12.15)
```

**⚠️ Failure modes & gotchas.**
- **Per-shard async failover losing transfers · split-brain forking a shard · Saga stuck mid-flight · dual-write loss · stale-replica money read** — the catastrophes (M10/10.12, 12.8, 12.10, M15).
- **No reconciliation** → residual distributed drift undetected.
- **Over-distributing** — minimize the distributed surface (co-locate, M11/11.9).

**💰 Fintech lens (★).** A payment is **atomic** (single-shard ACID / compensated Saga), **durable beyond node loss** (semi-sync, M10), **never double-applied** (idempotency, 12.9), **never lost in propagation** (outbox + CDC, 12.11/12.12), **exactly-once in effect** (idempotent consumers, 12.13), and **independently verified** (reconciliation, 12.14). Money-never-lies across the *whole* distribution.

**🎯 Interview / SD angle.** "Distributed correctness is a *composition*: keep the critical path strong+atomic and *small* (co-locate), handle the distributed minority with compensation+idempotency (Saga, not 2PC), propagate reliably from atomic writes (outbox/CDC, not dual-write), make consumers idempotent, choose consistency per operation, verify with reconciliation. Minimize the distributed surface." The culmination of the journey (M01→M12); sets up M15/M16.

**✅ Self-check.**
1. For each guarantee (atomic, durable, no-double-apply, no-loss, exactly-once, verified), which pattern delivers it?
2. How does this compose M09→M10→M11→M12 (durable→node-loss-durable→write-scaled→distributed-correct)?
3. State the universal recipe for distributed money correctness.

---

*Enrichment for 12.11–12.16 complete. **M12 Pass D is fully drafted (all 16 concepts) — M12 is now content-complete across Passes A–D, completing Track D.***
