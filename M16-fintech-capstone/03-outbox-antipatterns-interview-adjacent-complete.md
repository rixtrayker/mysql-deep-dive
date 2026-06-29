# M16 · Pass B — Challenges 16.12–16.16 · The Integration Backbone, Anti-Patterns, The Interview Playbook, Adjacent Domains & The Complete Platform

> **Pass B scope:** **the problem · the invariants · the design (composing M01–M15) · the tradeoffs · the money-never-lies guarantee.** Synthesis, not new theory. Diagrams + design walkthroughs are Passes C/D. **16.16 completes the entire resource (M01–M16).**
>
> Running domain: payments/wallet, the ledger — *the system being designed*. The organizing question: *how does this stay money-never-lies?*

---

## 16.12 · The outbox/CDC integration backbone

**The problem.** A payments platform isn't isolated — every money movement must *reliably reach* other systems: fraud detection, notifications, the search index, the reporting warehouse, partner integrations. Doing this with **dual-writes** (commit the DB, then publish an event) *silently drops events* on a crash (M12/12.10) — losing fraud checks, notifications, settlements. You need a *reliable* propagation backbone — the platform's nervous system.

**The invariants.** **(1) No lost events**: every committed money movement *reliably* produces its event (no dual-write loss). **(2) Exactly-once effect downstream**: each consumer applies each event *once* (idempotent, M12/12.13). **(3) Decoupled**: producers (the ledger) don't know their consumers; consumers subscribe to the change stream.

**The design (composing M12).** The **outbox + CDC** backbone (M12/12.11/12.12):
- **Outbox** (M12/12.11): every state change writes a *semantic event* (e.g., "TransferCompleted") into an `outbox` table *in the same atomic transaction* as the money movement (M07) — so the event *can't be lost* (it commits atomically with the transfer; no dual-write, M12/12.10).
- **CDC** (M12/12.12): **Debezium** reads the binlog (M10 — ROW format, `sync_binlog=1`) and streams the outbox events (and ledger changes) to **Kafka** — reliable, ordered, resumable (GTID-tracked), low-latency, non-intrusive (reads the binlog, doesn't load the primary).
- **Idempotent consumers** (M12/12.13): each consumer (fraud, notifications, search-indexer, warehouse-loader, reconciliation, 16.7) processes events *idempotently* (dedup by event ID) → exactly-once *effect* despite at-least-once delivery.
- Per **shard** (M11), each shard's binlog is a CDC source; events fan out platform-wide.

**The tradeoffs.** The backbone adds infrastructure (Debezium + Kafka) + the outbox table + idempotent consumers — for *guaranteed reliable propagation without dual-writes*. It's *eventually consistent* (events propagate shortly after commit) — fine for propagation (fraud/notifications/reporting tolerate slight delay), made safe by idempotency + reconciliation. The alternative (dual-writes) is *broken* (silent event loss, M12/12.10). The design *reuses* the binlog (M10 — already there for replication) as the integration source ("the log is primary, everything derives," M12/12.12).

**The money-never-lies guarantee.** The outbox guarantees *every money event reliably propagates* (never lost — atomic with the movement, M12/12.11); idempotent consumers guarantee *no double-effect* (exactly-once, M12/12.13). So fraud checks, notifications, settlements, and reporting *never silently miss* a transfer — and reconciliation (16.7) is *fed* by this backbone (the events drive the verification). Money's *propagation* is as reliable as its *movement*. The Pass C Mermaid draws the outbox/CDC backbone.

---

## 16.13 · Common fintech anti-patterns (the money killers)

**The problem.** Money systems have *specific, catastrophic* anti-patterns — mistakes that *silently lose or duplicate money* — that recur across the journey (M03–M15). A fintech design *review* must check against them; each one is a money-never-lies violation.

**The design (the catalog — anti-pattern → why it loses money → the fix).**
- **FLOAT/DOUBLE for money** (M03) → precision loss (0.1 + 0.2 ≠ 0.3) → money silently wrong over many operations. **Fix**: `DECIMAL` / integer minor units (16.9).
- **Mutable ledger / in-place balance updates** (16.2) → no audit trail, lost-update risk (M15/15.9), can't reconcile. **Fix**: immutable append-only double-entry ledger; balances *derived*.
- **No idempotency on money operations** (16.3, M12/12.9) → retries *double-charge*. **Fix**: idempotency keys (unique constraint, atomic with the effect).
- **Authorizing against a stale-replica balance** (16.5, M10/10.6, M15/15.9) → double-spend/overdraft. **Fix**: read the *primary* (strong) for money decisions.
- **Dual-write (DB + queue/cache)** (M12/12.10) → silently dropped events (lost notifications/settlements). **Fix**: outbox + CDC (16.12).
- **Cross-shard 2PC/XA for transfers** (M12/12.6/12.7) → blocking, frozen accounts. **Fix**: co-locate (single-shard ACID, M11/11.9) or Saga (M12/12.8).
- **No reconciliation** (16.7, M12/12.14) → distributed inconsistencies undetected → unrecoverable loss. **Fix**: independent reconciliation (re-derive from the immutable ledger, match external).
- **Weak durability config for money** (M9/M15/15.2) → lost confirmed transfers on crash. **Fix**: `flush_log=1` + `sync_binlog=1` + semi-sync.
- **Untested backups** (M13/13.5, M15/15.10) → unrecoverable when needed. **Fix**: tested restore drills + reconciliation.
- **Sloppy FX rounding** (16.9) → rounding residuals silently lost. **Fix**: defined rounding + residual accounting.

**The money-never-lies guarantee.** This catalog *is* the money-never-lies checklist — each anti-pattern is a way money gets lost/duplicated, and each fix is a prior module's guarantee. Reviewing a design against it *ensures* the invariants hold. The Pass C Mermaid draws the fintech anti-pattern catalog.

---

## 16.14 · The interview playbook: designing a payments system

**The problem.** "Design a payments system" is a *staple* system-design interview — and the skill is *presenting* a fintech design *structured*, *correct-first*, and *tradeoff-aware*. The playbook is how to walk it in 45 minutes.

**The design (the structured walkthrough).**
1. **Clarify requirements**: scale (TPS, accounts), consistency needs, durability/DR (RPO/RTO), currencies, compliance — *and* the implicit money-never-lies requirement.
2. **State the invariants** (16.1): money conserved, never lost/duplicated, provable, recoverable — *lead with these* (it signals you understand money systems).
3. **Model the ledger** (16.2): immutable double-entry, derived balances — the heart. *Draw it.*
4. **Money movement** (16.4): atomic transfers (single-shard ACID), idempotency (16.3), holds/two-phase where needed.
5. **Consistency** (16.5): per-operation — strong for money decisions, eventual for reporting.
6. **Scale** (16.10): replicas → shard by tenant (co-locate transfers) → analytics offload — *shard last*.
7. **Reliability/integration** (16.12): outbox/CDC for propagation; **reconciliation** (16.7) as the backstop.
8. **DR** (16.11): semi-sync + fenced failover + tested PITR; *name what zero-data-loss costs*.
9. **Tradeoffs**: *name them out loud* (atomic-single-shard vs Saga, strong vs eventual, shard-or-not, the DR cost) — interviewers reward tradeoff-awareness.
10. **Anti-patterns** (16.13): mention what you're *avoiding* (FLOAT money, dual-write, no idempotency) — it shows depth.

**The money-never-lies guarantee.** The playbook *leads with* money-never-lies (the invariants first) and *threads it through* every decision — which is exactly what distinguishes a strong fintech-design answer. Presenting the invariants → ledger → correct-movement → consistency → scale → DR → tradeoffs, with the money-never-lies thread explicit, is the staff-level answer. The Pass C Mermaid draws the interview structure.

---

## 16.15 · Beyond the core: lending, settlements, wallets, marketplaces

**The problem.** Fintech is more than payments — and the question is whether the *same primitives* (ledger, idempotency, reconciliation) extend to *adjacent* domains, or whether each needs reinvention. The answer: the primitives *transfer* — same foundations, different challenges.

**The design (the primitives extended).**
- **Lending**: a loan is a ledger of *disbursements + repayments*; interest accrual is *scheduled ledger entries* (immutable); a repayment schedule is *future-dated* transactions. Same ledger (16.2), idempotency (16.3 — repayments retryable), reconciliation (16.7).
- **Settlements / netting**: batch many transfers, *net* them (Σ per party), and settle the net — a *batch* of ledger entries; netting is *Σ over the immutable ledger*. Same ledger + reconciliation (16.7 — settle = reconcile).
- **Wallets** (the running domain): a wallet *is* an account with a balance derived from its ledger entries (16.2) — the core model.
- **Marketplaces / split payments / escrow**: a payment *splits* across parties (buyer → escrow → seller + platform fee) — *multiple* balanced ledger entries per transaction (the split is *just more entries*, double-entry holds, 16.2); escrow is a *holding account* (a hold, 16.4); reconciliation (16.7) verifies the splits.
The same primitives — **immutable double-entry ledger, idempotency, holds, reconciliation** — compose into *every* fintech domain; only the *business logic* (interest, netting, splits) differs.

**The money-never-lies guarantee.** Because the *primitives* (immutable ledger, idempotency, reconciliation) carry the money-never-lies guarantees, *every* adjacent domain inherits them — lending, settlements, wallets, marketplaces are all *money-never-lies* by composing the same foundations. The depth of the toolkit (M01–M15) is what makes it *general*. The Pass C Mermaid draws adjacent domains → the same primitives.

---

## 16.16 · The complete payments platform (end-to-end) ★

**The problem.** The capstone of the capstone: *put it all together* — design the **entire** payments platform, composing *every* module (M01–M15), so it's **correct, scalable, operable, and survivable**, with money-never-lies guaranteed end to end. This is the synthesis the whole resource builds toward.

**The design (the complete architecture — every module composed).**
- **The core (correctness — M01–M09)**: an **immutable double-entry ledger** (16.2 — accounts + append-only balanced entries, derived balances, minor units M03) — money movements are **atomic single-shard ACID transactions** (16.4, M07/M08 — debit+credit+entries+idempotency-key+outbox-row in one commit, M07) with **idempotency** (16.3, M12/12.9) and **holds/two-phase capture** where needed (16.4).
- **Scale (M10–M11)**: **sharded by tenant/account** (M11 — co-locating transfers single-shard, M11/11.9), each shard **replicated** (M10 — semi-sync, primary for strong reads, async replicas for reporting); **distributed IDs** (M11/11.12 — ULID/Snowflake).
- **Consistency (M12)**: **per-operation** (16.5, M12/12.15 — strong for money decisions, RYW for users, eventual for reporting); **cross-shard transfers** via **Saga** (M12/12.8, never 2PC).
- **Integration (M12)**: the **outbox/CDC backbone** (16.12 — every event atomic + reliably propagated, idempotent consumers) → fraud, notifications, search, the **warehouse** (analytics offload, M02/2.17, HTAP, 16.10).
- **The backstop (M02/M12)**: **reconciliation** (16.7 — re-derive balances from the immutable ledger, match external records, daily — detect/repair any drift).
- **Operability (M13)**: tested backups + PITR, monitoring + early-warning signals (M13/13.11), online DDL, security (least privilege, TLS, encryption, audit, M13/13.14).
- **Survivability (M15)**: the **prevention checklist** (M15/15.16) + **DR** (16.11 — RPO≈0 via semi-sync + cross-region, fast RTO via fenced failover, tested PITR — survives every catastrophe).
- **Multi-currency** (16.9), **audit/compliance** (16.8), all on the immutable ledger.

**The tradeoffs (the platform's design judgment).** The complete platform is *applied tradeoff-thinking*: it **minimizes the distributed surface** (co-locate so most transfers are single-shard ACID, M11/11.9 — the correctness anchor), accepts **eventual consistency only where safe** (propagation/reporting, with idempotency + reconciliation), **bulletproofs the money path** (strong, atomic, durable) while **scaling the rest** (replicas, sharding, analytics offload), and **pays for survivability** (semi-sync's latency, the DR infrastructure) *because the cost of losing money exceeds it*. Every decision is *derived from the money-never-lies invariants* (16.1).

**The money-never-lies guarantee (the journey's culmination).** The complete platform guarantees, *end to end*: a payment is **atomic** (single-shard ACID, M07–M09), **idempotent** (no double-charge, M12/12.9), **durable beyond node/region loss** (semi-sync + cross-region, M10), **never lost in propagation** (outbox/CDC, M12), **survivable through any catastrophe** (M15's prevention checklist + tested DR, 16.11), and **always provable + recoverable** (the immutable ledger + reconciliation, 16.2/16.7). Money is **never lost or duplicated, and always provable** — across crashes, node loss, region loss, scale, distribution, and catastrophe. This is the synthesis of the *entire journey* (M01 modeling → M09 durability → M12 distributed correctness → M15 survivability → M16 the platform): a **correct, scalable, operable, survivable, money-never-lies fintech platform on MySQL**. The ★ SVG (Pass C) draws THE complete payments platform architecture — every module, one diagram, the resource's flagship.

---

*Challenges 16.12–16.16 — Pass B complete. **M16 Pass B is fully drafted (all 16 challenges) — and 16.16 is the synthesis of the entire resource (M01–M16).** Next: M16 Pass C (the architecture diagrams + the complete-platform flagship SVG — ~9–10 ★ SVGs + Mermaid + design walkthroughs).*
