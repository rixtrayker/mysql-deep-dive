# M16 · Pass D — Enrichment · Challenges 16.9–16.16

> Pass D scope: **🔧 Code-specifics · 💰 Money-never-lies guarantee · 🎯 Interview/SD angle · ✅ Self-check.** Pairs with `02/03-…` + `05/06-passC-…`. Domain: payments/wallet. These close out M16 — and the entire resource.

---

## 16.9 · Multi-currency & FX ★

**🔧 Code-specifics.**
```sql
-- per-currency minor units + balances per (account, currency):
amount_minor BIGINT, currency CHAR(3)   -- never FLOAT; never mix currencies
PRIMARY KEY (account_id, currency)       -- balance per (account, currency)
-- FX = two movements at a recorded rate snapshot (immutable):
INSERT INTO fx_rate_snapshot (rate_id, base, quote, rate, captured_at) VALUES (…);  -- immutable
-- debit source-currency, credit dest-currency = ROUND(amount × rate) [round-half-even]; residual → rounding account
```

**💰 Guarantee.** Per-currency minor units (no precision loss) + rate snapshots (exact, auditable) + rounding-residual accounting (no silent loss); conservation per currency.

**🎯 Interview / SD angle.** "Per-currency minor units (never FLOAT, never mix); FX records an immutable RATE SNAPSHOT (exact, auditable); rounding = defined rule + residual accounting (sloppy rounding loses real money at scale). Each currency = its own money." Subtle correctness.

**✅ Self-check.** 1. Why per-currency minor units + separate balances? 2. Why snapshot the rate? 3. Why account for rounding residuals?

---

## 16.10 · Scaling the platform

**🔧 Code-specifics.**
```sql
-- up first (M09/M13): big buffer pool. then replicas (M10) + read/write split (16.5).
-- then shard (Vitess, M11) by tenant_id — CO-LOCATE transfers single-shard ACID (M11/11.9).
-- analytics offload: CDC (M12/12.12) → warehouse; NOT on the OLTP ledger (M14/14.15)
SHOW ENGINE INNODB STATUS\G   -- diagnose write-bound (→ shard) vs read-bound (→ replicas)
```

**💰 Guarantee.** Scaling divides the DATA, not the GUARANTEES — a transfer is single-shard ACID on 16 shards as on 1; each shard durable + node-loss-survivable; reconciliation still works.

**🎯 Interview / SD angle.** "Up → replicas (reads) → shard by tenant co-locating transfers (writes) → analytics offload (HTAP). Money path single-shard ACID throughout. Shard LAST. Scaling divides data, not guarantees." Composed topology.

**✅ Self-check.** 1. The scaling order? 2. Why does co-location preserve correctness? 3. Why offload analytics off the ledger?

---

## 16.11 · Failure & DR ★

**🔧 Code-specifics.**
```sql
-- RPO≈0: flush_log_at_trx_commit=1 + sync_binlog=1 + semi-sync (M10) + cross-region replica + tested PITR (M13)
-- RTO fast: automated fenced failover (M10) + fast restore (M13). + the M15 prevention checklist + reconciliation
SHOW STATUS LIKE 'Rpl_semi_sync_source_status';   -- VERIFY durability per shard (M10/10.12)
```

**💰 Guarantee.** A committed transfer survives crash + node loss + region loss + logical disaster — reconciled correct after recovery. Money never lost EVEN WHEN THE SYSTEM FAILS.

**🎯 Interview / SD angle.** "RPO≈0 (semi-sync + cross-region + tested PITR) + fast RTO (fenced failover). NAME what zero-data-loss costs: latency (semi-sync round-trip) + infrastructure + operational rigor. Quantify + justify vs the cost of losing money." The honest accounting.

**✅ Self-check.** 1. What gives RPO≈0 vs fast RTO? 2. Why does tested PITR matter beyond failover? 3. What does zero-data-loss cost?

---

## 16.12 · The outbox/CDC integration backbone

**🔧 Code-specifics.**
```sql
-- outbox event ATOMIC with the money movement (M12/12.11):
BEGIN; /* transfer */ INSERT INTO outbox (event_id, event_type, payload) VALUES (…, 'TransferCompleted', …); COMMIT;
-- Debezium CDC (M12/12.12): binlog (ROW + sync_binlog=1) → Kafka → idempotent consumers (M12/12.13)
```

**💰 Guarantee.** Every money event reliably propagates (never lost — atomic outbox) + no double-effect (idempotent consumers). Propagation as reliable as the movement.

**🎯 Interview / SD angle.** "Outbox (event atomic with the state, no dual-write) + CDC (binlog → Kafka) + idempotent consumers (exactly-once effect) = the integration backbone. 'The log is primary, everything derives.'" The platform's nervous system.

**✅ Self-check.** 1. Why outbox not dual-write? 2. Why must consumers be idempotent? 3. What does CDC reuse?

---

## 16.13 · Common fintech anti-patterns

**🔧 Code-specifics.** The fixes ARE the resource's code-specifics: `DECIMAL`/minor-units (M03), immutable ledger (16.2), idempotency keys (16.3), primary reads (16.5), outbox (16.12), Saga (M12), reconciliation (16.7), 1/1+semi-sync (16.11), tested restores (M13/13.5).

**💰 Guarantee.** The catalog IS the money-never-lies checklist — each anti-pattern a violation, each fix a prior module's guarantee.

**🎯 Interview / SD angle.** "Review against the money-killers: FLOAT money, mutable ledger, no idempotency, stale-replica authorization, dual-write, cross-shard 2PC, no reconciliation, weak durability, untested backups, sloppy FX rounding. Each loses money; each fix is a module." The depth signal.

**✅ Self-check.** 1. Name five money-killer anti-patterns + fixes. 2. Why is each a money-never-lies violation? 3. Which is the request-level one (idempotency)?

---

## 16.14 · The interview playbook

**🔧 Code-specifics.** The walkthrough yields the schema: ledger (16.2), idempotency_key (16.3), outbox (16.12), holds (16.4), per-currency balances (16.9) — drawn live.

**💰 Guarantee.** Leading with money-never-lies (invariants first) + threading it through every decision = the staff-level answer.

**🎯 Interview / SD angle.** "Structure: clarify → INVARIANTS (lead with these) → ledger (draw it) → money movement → consistency → scale → reliability/reconciliation → DR (name its cost) → tradeoffs → anti-patterns avoided. Lead with money-never-lies." The recall sheet is M14/14.16.

**✅ Self-check.** 1. What do you lead with, and why? 2. The walkthrough order? 3. What signals depth?

---

## 16.15 · Beyond the core: adjacent domains

**🔧 Code-specifics.** Same primitives, different business logic: lending (scheduled interest entries), settlements (netting = Σ over the ledger), wallets (derived balance), marketplaces (split = multiple balanced entries; escrow = a hold, 16.4).

**💰 Guarantee.** Every adjacent domain inherits money-never-lies by composing the same primitives (immutable ledger, idempotency, holds, reconciliation).

**🎯 Interview / SD angle.** "The same primitives — immutable double-entry ledger, idempotency, holds, reconciliation — compose into lending, settlements, wallets, marketplaces; only the business logic differs. The toolkit's DEPTH makes it general." Pattern transfer.

**✅ Self-check.** 1. How does a marketplace split map to the ledger? 2. What is escrow in terms of the primitives? 3. Why do the primitives generalize?

---

## 16.16 · The complete payments platform (end-to-end) ★

**🔧 Code-specifics.**
```sql
-- the complete platform (every piece together):
-- immutable double-entry ledger (16.2, *_minor BIGINT) SHARDED by tenant (Vitess, co-locate transfers M11/11.9)
-- transfer = single-shard ACID (debit+credit+entries+idempotency_key+outbox, M07–M09) · cross-shard = Saga (M12)
-- each shard replicated (semi-sync, M10) · per-op consistency (16.5) · multi-currency (16.9) · holds (16.4)
-- outbox → CDC → idempotent consumers (16.12) → fraud/notify/search/warehouse · reconciliation (16.7) backstop
-- operable (M13: tested backups/PITR, monitoring, online DDL, security) · survivable (M15: prevention + DR, 16.11)
SHOW STATUS LIKE 'Rpl_semi_sync_source_status';   -- verify durability per shard
```

**💰 Guarantee (the journey's culmination).** A payment is ATOMIC (single-shard ACID) · IDEMPOTENT (no double-charge) · DURABLE beyond node/region loss (semi-sync + cross-region) · never LOST in propagation (outbox/CDC) · SURVIVABLE through catastrophe (M15) · always PROVABLE + RECOVERABLE (immutable ledger + reconciliation). **Money never lies, end to end.**

**🎯 Interview / SD angle.** "The complete platform composes every module: immutable sharded ledger + atomic/idempotent movement + per-op consistency + outbox/CDC + reconciliation + DR + operations. Minimize the distributed surface (co-locate), bulletproof the money path, pay for survivability. Derived from the money-never-lies invariants." The synthesis of the entire journey (M01→M16).

**✅ Self-check.** 1. For each guarantee (atomic/idempotent/durable/no-loss/survivable/provable), which module delivers it? 2. How does the platform minimize the distributed surface? 3. State the one-sentence summary of the whole resource.

---

*Enrichment for 16.9–16.16 complete. **M16 Pass D is fully drafted (all 16 challenges) — M16 is now content-complete across Passes A–D.** This completes the Fintech System Design capstone — and the ENTIRE M01–M16 resource.*
