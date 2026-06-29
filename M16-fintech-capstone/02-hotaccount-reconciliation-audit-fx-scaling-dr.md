# M16 · Pass B — Challenges 16.6–16.11 · Hot Accounts, Reconciliation, Audit, Multi-Currency, Scaling & DR

> **Pass B scope:** **the problem · the invariants · the design (composing M01–M15) · the tradeoffs · the money-never-lies guarantee.** Synthesis, not new theory. Diagrams + design walkthroughs are Passes C/D.
>
> Running domain: payments/wallet, the ledger — *the system being designed*. The organizing question: *how does this stay money-never-lies?*

---

## 16.6 · Hot account contention ★

**The problem.** Some accounts are *hot* — a popular merchant, a platform float/settlement account, a payroll source — receiving *many concurrent* transfers. Every transfer touching that account contends on its *balance row* (a hot row, M08) — and naive locking serializes them, throttling throughput (the account becomes a bottleneck; transfers queue/deadlock, M08/M15/15.13). For a high-volume merchant (10k payments/sec into one account), the hot balance is *the* scaling pain of money systems.

**The invariants.** **(1) Correctness under contention**: concurrent transfers to the hot account must *all* apply correctly (no lost update, M15/15.9 — the balance reflects *every* transfer). **(2) Throughput**: the hot account can't be a single-row bottleneck that throttles the whole platform. **(3) Money conserved**: the relief patterns must *not* lose/duplicate money (every transfer still lands).

**The design (composing M08/M11).** Several relief patterns, composable:
- **Atomic conditional `UPDATE`** (M08/M15/15.9): `UPDATE … SET balance = balance + :amt WHERE …` is atomic (no read-then-write gap, no lost update) — and incremental updates *can't* deadlock the way read-modify-write does. The first-line fix.
- **Sharded/split balances** (M11): split the hot account's balance into *N sub-balances* (shards/buckets) — each transfer hits a *random* sub-balance (spreading contention across N rows instead of 1); the *true* balance = Σ sub-balances (computed/reconciled). Trades a single hot row for N warm rows (N× the concurrency).
- **Batching / async settlement**: instead of updating the hot balance *synchronously* per transfer, *queue* the transfers (write them to the immutable ledger immediately — that's append-only, *not* contended) and *batch-apply* to the balance asynchronously (one update for many transfers). The ledger entries are the truth; the balance catches up. Async settlement (M12 — eventually consistent, reconciled).
- **Queue-style processing with `SKIP LOCKED`** (M08): process the hot account's pending transfers from a queue, skipping locked rows (no contention, M08).

**The tradeoffs.** Atomic conditional `UPDATE` is *simple* (use it always) but doesn't help if the *single row* is the bottleneck. Split balances *scale* (N× concurrency) but add *complexity* (the true balance is derived from N sub-balances — must be summed/reconciled, and the available-balance check spans N rows). Batching/async *scales* (the contended balance update is amortized) but makes the *cached* balance *eventually consistent* (the ledger is current, the balance lags — fine if you read the ledger for decisions, or accept brief staleness, reconciled). The design: atomic updates always; split balances or batching for *genuinely* hot accounts (the rare few); the *immutable ledger is always the append-only, uncontended source of truth* (16.2) — contention is only on the *derived* balance, which you can split/batch.

**The money-never-lies guarantee.** The relief patterns preserve money-never-lies: every transfer *still writes an immutable ledger entry* (16.2 — the append-only ledger is never contended/lost), so the *truth* is always complete; the *derived* balance (split/batched/async) is *reconciled* against the entries (16.7, M12/12.14) — so any contention-relief lag is *detectable and correct*. Money is conserved (every transfer lands in the ledger), never lost, just the balance-projection is scaled. The ★ SVG (Pass C) draws hot-account contention + the relief patterns.

---

## 16.7 · Reconciliation: internal, external & drift detection ★

**The problem.** No system is perfectly consistent (replicas lag M10, Sagas half-complete M12, balances drift from entries M15/15.9, bugs happen) — and for money, an *undetected* inconsistency is *lost or duplicated money*. You *must* independently *detect* (and repair) any drift — the money-never-lies *backstop* that catches what every other mechanism missed.

**The invariants.** **(1) Internal consistency**: every cached balance = Σ its immutable ledger entries (the derived-balance invariant, 16.2). **(2) Double-entry holds**: Σ all debits = Σ all credits (money conserved, 16.2). **(3) External consistency**: the platform's records match the external truth (the payment processor's/bank's settlement records). **(4) Detect + repair**: any drift is *detected* and *repaired* (with an audit trail), not silently carried.

**The design (composing M02/M12).** Reconciliation runs as periodic (daily/continuous) **independent verification** (M02/2.17, M12/12.14):
- **Internal reconciliation**: re-derive each balance from the *immutable ledger entries* (balance = Σ entries) and compare to the *cached* balance — any mismatch = drift (a lost update M15/15.9, a half-Saga M12/12.8, a bug). Also verify Σ debits = Σ credits (double-entry holds — money conserved).
- **External reconciliation**: import the **external processor's/bank's settlement records** and match against the platform's transactions — any unmatched/mismatched = drift (a missed event M12/12.10, a settlement discrepancy).
- **Repair**: on detected drift, *investigate* (trace to the cause) and *correct* (a compensating ledger entry, 16.2/M01/1.17 — never mutate; append a correction, with an audit trail) + alert.
- **The pipeline**: reconciliation runs on *replicas/the warehouse* (M02/2.17, M10 — offloading the primary, fed by **CDC**, M12/12.12) so it doesn't load the transactional shards; the **outbox/CDC** backbone (16.12) feeds it the events.

**The tradeoffs.** Reconciliation costs compute (re-deriving + matching) + engineering (the checks + repair workflows) — *non-negotiable* for money (the cost of *not* having it is undetected loss). It's a *backstop, not a primary mechanism* — it detects *residual* errors after the primary mechanisms (idempotency, atomic transfers, outbox) prevent *most*. The choices: frequency (daily batch vs continuous/streaming), independence (must use a *genuinely* independent source — the immutable ledger, the external records — or it just re-confirms the same bug), and repair (automated compensating entries vs human investigation, always audited). For money, reconciliation is *mandatory* and *independent*.

**The money-never-lies guarantee.** Reconciliation *is* the money-never-lies backstop — it's the mechanism that makes "did money get lost or duplicated?" *answerable* (and the answer "no, reconciliation would catch it"). It's *why* eventual consistency and the distributed patterns are *acceptable* for money (M12/12.14 — they're permitted to be temporarily inconsistent *because* reconciliation catches any *persistent* drift). The immutable ledger (16.2) makes it *possible* (the truth is always re-derivable). It's the final guarantee under the whole platform. The ★ SVG (Pass C) draws the reconciliation pipeline.

---

## 16.8 · Audit trails & compliance

**The problem.** Fintech is *regulated* — regulators, auditors, and compliance (PCI-DSS, SOX, AML/KYC) require *proving* "who did what, when" to every account, *immutably*, and *retaining* it for years. A mutable system (in-place updates, no history) *can't* satisfy this. You need an immutable, queryable, retained audit trail.

**The invariants.** **(1) Immutable history**: every change to money/accounts is recorded *permanently* and *can't be altered* (tamper-evident). **(2) Complete**: every money movement and significant action is captured. **(3) Queryable**: "show every change to this account over this period" is answerable. **(4) Retained**: history is kept for the regulatory period (often 7+ years).

**The design (composing M01/M13).** The **immutable double-entry ledger** (16.2) *is* the core audit trail — append-only entries record every money movement permanently (M01/1.17 — event-sourcing-like: the entries *are* the history). Augment with: **temporal/event-sourcing patterns** (M01/1.17 — record *what happened* as immutable events, not just current state — so the full history is reconstructable); an **audit log** (M13/13.14 — who connected/acted, for non-money actions); and **retention via partitioning** (M13/13.2 — partition the ledger/audit by time, so old data is retained efficiently and purged precisely when the retention period expires — `DROP PARTITION`). Immutability is *enforced* (M13/13.14 — no `UPDATE`/`DELETE` privilege on the ledger for app accounts; corrections are compensating entries). The history is queryable (indexed by account + time, M05).

**The tradeoffs.** The immutable-history approach trades *storage* (keep everything forever, vs in-place updates) for *auditability + compliance* (a complete, tamper-evident, queryable history) — *required* for regulated money. Partitioning manages the storage/retention (M13/13.2). The event-sourcing-vs-CRUD tradeoff (M01/1.17): event-sourcing (immutable events) gives full history but more complexity than mutable CRUD — for money/compliance, the history is *required*, so event-sourcing-like immutability wins. The design *reuses* the ledger (it's *already* the immutable history) rather than building a separate audit system.

**The money-never-lies guarantee.** The immutable ledger guarantees *every money movement is permanently provable* — which *is* money-never-lies at the audit level (you can *prove* money was never lost/duplicated by examining the immutable, balanced, complete history). It satisfies compliance *and* enables reconciliation (16.7 — the same immutable entries). The Pass C Mermaid draws audit/compliance (immutable ledger + temporal + retention).

---

## 16.9 · Multi-currency & FX ★

**The problem.** A global platform handles *multiple currencies* — and money correctness is *per-currency* (you can't add USD to EUR), FX *conversions* need the *exact rate at transaction time* (immutable — for audit/dispute), and *rounding* must be careful (a fraction of a cent, mishandled, loses money over millions of transactions). Multi-currency is a subtle correctness challenge most treatments underestimate.

**The invariants.** **(1) Per-currency minor units**: each amount is in a *specific currency's minor units* (cents for USD, etc. — never FLOAT, M03), and balances are *per-currency* (separate USD/EUR/… balances — never mixed). **(2) Rate snapshots**: an FX conversion records the *exact rate used* (immutable — the rate *at transaction time*, for audit/dispute/reproducibility). **(3) Rounding correctness**: conversions round *deterministically and consistently* (a defined rounding rule), and rounding *residuals* are accounted for (not silently lost). **(4) Conservation per currency**: within a currency, Σ debits = Σ credits (16.2).

**The design (composing M03/16.2).** **Per-currency amounts**: store amount as integer minor units + a currency code (M03 — `amount_minor BIGINT` + `currency CHAR(3)`); balances are *per (account, currency)* (an account has separate balances per currency it holds). **FX conversion** (a cross-currency transfer): record a **rate snapshot** — the conversion is *two* movements (debit the source currency, credit the destination currency) at a *recorded, immutable rate* (the rate row referenced by the transaction — so the exact rate is auditable/reproducible). **Rounding**: convert with a *defined* rounding rule (e.g., round-half-even / banker's rounding), and account for the *residual* (the fraction lost/gained to rounding goes to a defined rounding/spread account — *not* silently dropped, preserving conservation). The double-entry invariant (16.2) holds *per currency* (a cross-currency transfer balances within each currency via the FX/rounding accounts).

**The tradeoffs.** Per-currency minor units + rate snapshots + careful rounding add *modeling complexity* (vs a naive single-currency `DECIMAL`) but are *required* for correctness (you *can't* mix currencies or lose rounding residuals — over millions of transactions, sloppy rounding *loses real money*). The rate-snapshot approach trades storage (record every rate used) for auditability/reproducibility (the exact conversion is provable). The design treats *each currency as its own money* (per-currency balances, per-currency conservation) with FX as an explicit, rate-snapshotted, rounding-accounted conversion.

**The money-never-lies guarantee.** Per-currency minor units (never FLOAT) guarantee *no precision loss* (M03). Rate snapshots guarantee *FX conversions are exact and auditable* (the rate is recorded, immutable). Rounding-residual accounting guarantees *no money silently lost to rounding* (the residual is captured, conservation holds per currency). Together: multi-currency money is *never lost or duplicated*, and every conversion is *provable* — money-never-lies across currencies. The ★ SVG (Pass C) draws multi-currency (minor units per currency + rate snapshots + rounding).

---

## 16.10 · Scaling the platform: read/write split, sharding, HTAP

**The problem.** A growing platform out-scales one box — and must scale *correctly* (without losing the money-never-lies invariants). Compose the scaling toolkit: scale *reads* (replicas), scale *writes* (sharding), and *offload analytics* (don't run heavy reporting on the OLTP ledger) — all while keeping money movement correct.

**The invariants.** **(1) Correctness preserved**: scaling must *not* break money-never-lies (transfers stay atomic, balances stay correct, reconciliation still works). **(2) Money path stays fast + correct**: the transactional ledger stays performant and ACID. **(3) Analytics offloaded**: heavy reporting doesn't load the money path.

**The design (composing M10/M11/M02).** The composed topology (M14/14.11):
- **Scale up first** (M13 — bigger box, buffer pool, M09) — ride it far (most fintech fits one tuned box + replicas a *long* way).
- **Read scaling**: **read-replicas** (M10) + read/write split — route money-decision reads to the primary (strong, 16.5), reporting/RYW to replicas (M10/10.6).
- **Write scaling**: **shard** (M11) *only* when genuinely write-bound — by **tenant/account** (M11/11.6/11.9 — *co-locating* each transfer's legs so it stays *single-shard ACID*); each shard *itself replicated* (M10).
- **Analytics offload (HTAP)**: run reporting/reconciliation/analytics on **replica-fed read models / a warehouse** (M02/2.17, M13 — fed by **CDC**, M12/12.12) — *not* on the OLTP ledger (M14/14.15 — MySQL is the system of record; analytics is derived).
The composed platform: **sharded (write scale) × replicated-per-shard (read scale + HA) × analytics-offloaded (HTAP)** — with the money path single-shard ACID throughout.

**The tradeoffs.** Each scaling step adds capacity *and* complexity (M11/11.15 — shard last, shard reluctantly). Read-replicas add staleness (managed by consistency routing, 16.5). Sharding adds cross-shard complexity (managed by co-location, M11/11.9 — keep transfers single-shard). Analytics offload adds a pipeline (CDC + warehouse) but *protects* the money path. The design *composes* the tools sized to the bottleneck, keeping money movement *single-shard ACID* (the correctness anchor) throughout.

**The money-never-lies guarantee.** Scaling *preserves* money-never-lies because the money path stays **single-shard ACID** (M11/11.9 — co-located transfers are atomic + correct, regardless of how many shards), each shard is **durable + node-loss-survivable** (M9/M10 — semi-sync), and **reconciliation still works** (16.7 — re-derive from the immutable ledger per shard). Money is never lost/duplicated *because* scaling divided the *data*, not the *guarantees* — the transfer is as correct on 16 shards as on 1. The Pass C Mermaid draws the scaled topology.

---

## 16.11 · Failure & DR: RPO/RTO, what zero-data-loss costs ★

**The problem.** The platform must *survive* failures — node loss, region loss, catastrophe (M15) — with *no lost money* (RPO≈0) and minimal downtime (fast RTO). And there's an honest question every fintech architect must answer: **what does "zero data loss" *actually* cost?** (it's *not* free — it costs latency, infrastructure, and operational rigor). This is the survivability design.

**The invariants.** **(1) RPO≈0**: no *committed* transfer is ever lost (even on node/region loss). **(2) Fast RTO**: downtime is seconds-to-minutes (payments resume quickly). **(3) Survivable**: every M15 catastrophe is prevented or cleanly recovered + verified. **(4) Provable recovery**: after any failure, money is *reconciled* correct (16.7).

**The design (composing M09/M10/M13/M15).** The DR posture (the synthesis of M15/15.16's prevention checklist):
- **RPO≈0**: **`flush_log_at_trx_commit=1` + `sync_binlog=1`** (no committed transfer lost on crash, M09/M15/15.2) + **semi-sync replication** (a committed transfer is durable on a replica *immediately* — survives total primary loss, M10/10.4) + **a cross-region replica** (survives region loss, M10).
- **Fast RTO**: **automated fenced failover** (M10/10.10–10.13 — promote a replica in seconds; *fence* to prevent split-brain, M15/15.3) + fast physical/snapshot restore (M13/13.2) for cases failover can't fix.
- **Recoverable from logical disasters**: **tested PITR** (M13/13.3/13.5 — rewind before a bad deploy/`DROP`; tested drills *prove* it works, M15/15.10) — because logical errors *replicate* (failover doesn't help, M15/15.8).
- **Survivable**: the full **M15 prevention checklist** (15.16 — fencing, checksums, super_read_only, tested restores, early-warning, ROW format) + **reconciliation** (16.7 — verify recovery).

**The tradeoffs (what zero-data-loss *costs*).** The honest accounting: **RPO≈0 costs latency** (semi-sync adds a round-trip per commit, M10/10.4) + **infrastructure** (replicas, cross-region, standby) + **operational rigor** (tested drills, monitoring, fencing). **Fast RTO costs** automated failover infrastructure + standbys. *True* zero-data-loss isn't free — and the architect's job is to *quantify* it (the latency/cost) and *justify* it (vs the cost of *losing* money — which, for a payments platform, vastly exceeds it). For *lower-value* systems, you'd accept looser RPO/RTO (cheaper). The tradeoff is *cost vs the cost of loss* — and for money, the rigor is justified (and often regulated).

**The money-never-lies guarantee.** The DR posture guarantees *money survives any failure*: a committed transfer survives crash (M09), node loss (semi-sync, M10), region loss (cross-region replica), and logical disaster (tested PITR, M13) — and is *reconciled* correct after recovery (16.7). Money is *never* lost, *even when the system fails* — which is the ultimate money-never-lies guarantee (the synthesis of M15's "catastrophes are survivable"). The ★ SVG (Pass C) draws the DR posture + the cost.

---

*Challenges 16.6–16.11 — Pass B complete. Next: 16.12–16.16 (outbox/CDC backbone, anti-patterns, interview playbook, adjacent domains, the complete platform).*
