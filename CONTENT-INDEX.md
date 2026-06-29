# High-Performance MySQL — Deep Revision (Fintech-focused)

A concept-first revision resource modeled on *High Performance MySQL* (Schwartz, Zaitsev, Tkachenko). Staff/architect depth, built for revision, system-design interviews, and production decisions. **Concepts and diagrams over code** — real SQL/config appears only in labeled "Code-specifics" boxes.

Full plan: `~/.claude/plans/like-book-high-performance-wiggly-balloon.md`.

## The journey

| # | Module | Track |
|---|--------|-------|
| M01 | Relational Foundations & Data Modeling | A · Foundations |
| M02 | Normalization & Denormalization | A · Foundations |
| M03 | MySQL Data Types & Schema Design | A · Foundations |
| M04 | How MySQL Executes a Query | B · Performance |
| M05 | Indexing Deep Dive | B · Performance |
| M06 | Query Optimization & Execution Plans | B · Performance |
| M07 | Transactions & ACID | C · Concurrency |
| M08 | Locking & MVCC | C · Concurrency |
| M09 | InnoDB Internals & Disk Durability | C · Concurrency |
| M10 | Replication | D · Scale |
| M11 | Partitioning, Sharding & Scaling Out | D · Scale |
| M12 | Distributed Data Concerns | D · Scale |
| M13 | Operations, Backups & Observability | E · Operations |
| M14 | Production Cheat-Sheet & Decision Guides | E · Operations |
| M15 | Failure Modes, Data Loss & Recovery | E · Operations |
| M16 | Fintech System Design with MySQL | F · Capstone |

## The content contract (every concept)

Each concept is authored to the same 12-point depth checklist:

1. Mental model (intuition + analogy)
2. How it actually works (mechanism)
3. Why it exists / what it solves
4. Tradeoffs & alternatives
5. Generics / first-principles (DB-agnostic)
6. MySQL-specific reality
7. Code-specifics (labeled box, only when needed)
8. Worked example (narrated, no code in prose)
9. Failure modes & gotchas
10. Fintech lens
11. Interview / system-design angle
12. Diagram(s)

### Cross-cutting threads
**Durability** (what survives a crash?) · **Money-never-lies** (did money get lost/duplicated?) · **Generics-first** (agnostic principle before MySQL specifics) · **Tradeoff** (nothing is free).

## Build phasing (per module)

- **Pass A** — concept list & skeleton (mental model + planned diagram/example per concept) ← *current*
- **Pass B** — core notes (contract items #1–#6)
- **Pass C** — diagrams & worked examples (#8, #12)
- **Pass D** — enrich (#7, #9, #10, #11, cross-links, self-check)

Module-by-module sign-off. Presentation (website) is deferred until content is locked.

## Status

| Module | A | B | C | D |
|--------|---|---|---|---|
| M01 | ✅ | ✅ | ✅ | ✅ **complete** |

**M01 files:**
- Pass A — `00-skeleton.md`
- Pass B (core notes) — `01-relational-core.md` (1.1–1.8) · `02-modeling-and-er.md` (1.9–1.14) · `03-deeper-keygen-temporal-antipatterns-money.md` (1.15–1.19)
- Pass C (diagrams + worked examples) — `04-passC-diagrams-examples-1.1-1.8.md` · `05-passC-diagrams-examples-1.9-1.14.md` · `06-passC-diagrams-examples-1.15-1.19.md`
- Pass D (code-specifics, failure modes, fintech lens, interview angle, self-check) — `07-passD-enrich-1.1-1.8.md` · `08-passD-enrich-1.9-1.14.md` · `09-passD-enrich-1.15-1.19.md`

> All 19 Mermaid diagrams validated with `mmdc` (19/19 render clean). SQL code-specifics self-reviewed (reserved words handled, no FLOAT for money).

**▶ M01 is content-complete.**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M02 | ✅ | ✅ | ✅ | ✅ **complete** |

**M02 files:**
- Pass A — `00-skeleton.md` (17 concepts)
- Pass B (core notes) — `01-redundancy-fds-1nf-bcnf.md` (2.1–2.8) · `02-higher-forms-ladder-target.md` (2.9–2.11) · `03-denormalization-sync-distributed-capstone.md` (2.12–2.17)
- Pass C (diagrams + worked examples) — `04-passC-diagrams-examples-2.1-2.8.md` · `05-passC-diagrams-examples-2.9-2.11.md` · `06-passC-diagrams-examples-2.12-2.17.md`
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07-passD-enrich-2.1-2.8.md` · `08-passD-enrich-2.9-2.11.md` · `09-passD-enrich-2.12-2.17.md`

> 4NF/5NF intuition-first + formal box; denormalization half decision-first. 17/17 Mermaid diagrams validated; SQL self-reviewed (no FLOAT for money, reserved words handled).

**▶ M01 + M02 content-complete.**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M03 | ✅ | ✅ | ✅ | ✅ **complete** |

**M03 files:**
- Pass A — `00-skeleton.md` (17 concepts)
- Pass B (core notes) — `01-type-basics-footprint-integers-money.md` (3.1–3.6) · `02-text-charset-temporal-enum-json.md` (3.7–3.11) · `03-idstorage-null-rowformat-evolution-principles-capstone.md` (3.12–3.17)
- Pass C (diagrams + worked examples) — `04-passC-diagrams-examples-3.1-3.6.md` · `05-passC-diagrams-examples-3.7-3.11.md` · `06-passC-diagrams-examples-3.12-3.17.md`
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07-passD-enrich-3.1-3.6.md` · `08-passD-enrich-3.7-3.11.md` · `09-passD-enrich-3.12-3.17.md`

> 17/17 Mermaid diagrams validated; SQL self-reviewed (no FLOAT/DOUBLE for money, reserved words handled).

**▶ M01 + M02 + M03 content-complete (Track A · Foundations done).**

### Track B — Performance Core
| Module | A | B | C | D |
|--------|---|---|---|---|
| M04 | ✅ | ✅ | ✅ | ✅ **complete** |

**M04 files:**
- Pass A — `00-skeleton.md` (16 concepts)
- Pass B (core notes) — `01-pipeline-frontend.md` (4.1–4.5) · `02-the-optimizer.md` (4.6–4.9) · `03-execution-engine-results-capstone.md` (4.10–4.16)
- Pass C (diagrams + worked examples) — `04-passC-diagrams-examples-4.1-4.5.md` · `05-passC-diagrams-examples-4.6-4.9.md` · `06-passC-diagrams-examples-4.10-4.16.md`
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07-passD-enrich-4.1-4.5.md` · `08-passD-enrich-4.6-4.9.md` · `09-passD-enrich-4.10-4.16.md`

> 16/16 Mermaid diagrams validated; SQL self-reviewed (no FLOAT money, InnoDB money tables, reserved words handled).

**▶ M01–M04 content-complete.**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M05 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M05 files:**
- Pass A — `00-skeleton.md` (18 concepts)
- Pass B (core notes) — `01-structural-foundation.md` (5.1–5.6) · `02-design-levers-and-toolbox.md` (5.7–5.14) · `03-when-indexes-hurt-methodology-integrity-capstone.md` (5.15–5.18)
- Pass C (diagrams + worked examples) — `04/05/06-passC-…` + **`assets/` (8 ★ custom SVGs)**
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07/08/09-passD-enrich-…`

> **8 ★ bespoke custom SVGs** (render-validated via rsvg→PNG) + 10 Mermaid diagrams + 18 worked examples; SQL self-reviewed (no FLOAT money, InnoDB ledger, reserved words handled).

**▶ M01–M05 content-complete (Track A done + M04/M05 of Track B).**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M06 | ✅ | ✅ | ✅ | ✅ **complete** |

**M06 files:**
- Pass A — `00-skeleton.md` (16 concepts)
- Pass B (core notes) — `01-reading-the-plan.md` (6.1–6.7) · `02-joins-and-rewrites.md` (6.8–6.11) · `03-toolkit-antipatterns-pagination-stability-capstone.md` (6.12–6.16)
- Pass C (diagrams + worked examples) — `04/05/06-passC-…`
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07/08/09-passD-enrich-…`

> 16/16 Mermaid diagrams validated; SQL self-reviewed (no FLOAT money, reserved words handled).

**▶ M01–M06 content-complete — Track A (Foundations) + Track B (Performance Core) both DONE.**

### Track C — Concurrency & Internals
| Module | A | B | C | D |
|--------|---|---|---|---|
| M07 | ✅ | ✅ | ✅ | ✅ **complete** |

**M07 files:**
- Pass A — `00-skeleton.md` (16 concepts)
- Pass B (core notes) — `01-acid-and-boundaries.md` (7.1–7.7) · `02-isolation-in-depth.md` (7.8–7.13b) · `03-choosing-pitfalls-capstone.md` (7.14–7.16)
- Pass C (diagrams + worked examples) — `04/05/06-passC-…` + **`assets/` (2 ★ custom SVGs)**
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07/08/09-passD-enrich-…`

> 16/16 Mermaid + 2 ★ SVGs validated; SQL self-reviewed (no FLOAT money, atomic balance updates, reserved words handled).

**▶ M01–M07 content-complete.**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M08 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M08 files:**
- Pass A — `00-skeleton.md` (16 concepts)
- Pass B (core notes) — `01-mvcc-and-read-modes.md` (8.1–8.4) · `02-the-lock-taxonomy.md` (8.5–8.10) · `03-contention-failures-capstone.md` (8.11–8.16)
- Pass C (diagrams + worked examples) — `04/05/06-passC-…` + **`assets/` (6 ★ custom SVGs)**
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07/08/09-passD-enrich-…`

> 10/10 Mermaid + 6/6 ★ SVGs validated; SQL self-reviewed (no FLOAT money, atomic balance updates, reserved words handled). Most SVG-rich module (6 custom).

**▶ M01–M08 content-complete.**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M09 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M09 files:**
- Pass A — `00-skeleton.md` (16 concepts)
- Pass B (core notes) — `01-wal-foundation.md` (9.1–9.6) · `02-disk-sync-deep-dive.md` (9.7–9.10) · `03-writepath-recovery-capstone.md` (9.11–9.16)
- Pass C (diagrams + worked examples) — `04/05/06-passC-…` + **`assets/` (7 ★ custom SVGs)**
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07/08/09-passD-enrich-…`

> 9/9 Mermaid + 7/7 ★ SVGs validated; config self-reviewed (money durability posture stated). Contains the disk-sync/data-loss material (9.7–9.10).

**▶ M01–M09 content-complete — Track A (Foundations) + Track B (Performance Core) + Track C (Concurrency & Internals) all DONE.**

### Track D — Scale & Distribution
| Module | A | B | C | D |
|--------|---|---|---|---|
| M10 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M10 files:**
- Pass A — `00-skeleton.md` (16 concepts)
- Pass B (core notes) — `01-foundations-mechanism-sync.md` (10.1–10.4) · `02-lag-consistency-gtid-parallel.md` (10.5–10.8) · `03-topologies-failure-bridge-capstone.md` (10.9–10.16)
- Pass C (diagrams + worked examples) — `04/05/06-passC-…` + **`assets/` (7 ★ custom SVGs: mechanism, sync spectrum, lag, topologies, failover, split-brain, replicated-platform)**
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07-passD-enrich-10.1-10.4.md` · `08-passD-enrich-10.5-10.8.md` · `09-passD-enrich-10.9-10.16.md`

> 9/9 Mermaid + 7/7 ★ SVGs render-validated; SVG refs resolve. Opens Track D. Pass D code-specifics self-reviewed (no FLOAT money, reserved words handled, semi-sync monitoring `Rpl_semi_sync_source_status`, GTID/`super_read_only` errant-txn prevention).

**▶ M01–M10 content-complete — Track A + B + C done, Track D opened (M10 Replication).**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M11 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M11 files:**
- Pass A — `00-skeleton.md` (16 concepts)
- Pass B (core notes) — `01-scaling-partitioning-sharding-intro.md` (11.1–11.5) · `02-shard-key-schemes-colocation.md` (11.6–11.10) · `03-crossshard-ids-routing-resharding-capstone.md` (11.11–11.16)
- Pass C (diagrams + worked examples) — `04/05/06-passC-…` + **`assets/` (9 ★ custom SVGs: shard-vs-partition-vs-replica, shard-key, schemes, consistent-hash-ring, co-location, cross-shard-ACID, routing-Vitess, resharding-flow, sharded-ledger)**
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07-passD-enrich-11.1-11.5.md` · `08-passD-enrich-11.6-11.10.md` · `09-passD-enrich-11.11-11.16.md`

> 7/7 Mermaid + 9/9 ★ SVGs render-validated; SVG refs resolve (most SVG-rich module). Scales **writes** (vs M10's reads). Pass D SQL self-reviewed (money `*_minor BIGINT`, never FLOAT; reserved words handled; co-location keeps a transfer single-shard ACID; Vitess `Reshard`/`VDiff` for live verified resharding; Saga + idempotency + reconciliation for cross-shard).

**▶ M01–M11 content-complete — Track A + B + C done, Track D in progress (M10 Replication + M11 Sharding).**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M12 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M12 files:**
- Pass A — `00-skeleton.md` (16 concepts)
- Pass B (core notes) — `01-cap-pacelc-consistency.md` (12.1–12.5) · `02-2pc-saga-idempotency-dualwrite.md` (12.6–12.10) · `03-outbox-cdc-reconciliation-capstone.md` (12.11–12.16)
- Pass C (diagrams + worked examples) — `04/05/06-passC-…` + **`assets/` (9 ★ custom SVGs: CAP, consistency-ladder, 2PC, Saga, idempotency, dual-write, outbox, CDC, distributed-platform)**
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07-passD-enrich-12.1-12.5.md` · `08-passD-enrich-12.6-12.10.md` · `09-passD-enrich-12.11-12.16.md`

> 7/7 Mermaid + 9/9 ★ SVGs render-validated; SVG refs resolve. The *theory + patterns* of distribution (generalizes M10/M11). Pass D SQL self-reviewed (money `*_minor BIGINT`, never FLOAT; reserved words handled; idempotency via unique constraint atomic with effect; outbox in the state-change txn; CDC needs ROW + `sync_binlog=1`; reconciliation re-derives from the immutable ledger). Key: CAP/PACELC, consistency spectrum, 2PC/XA (avoided), Saga, **idempotency (the load-bearing primitive)**, dual-write→outbox, CDC, exactly-once-effect, reconciliation backstop, per-operation consistency.

**▶ M01–M12 content-complete — Track A + B + C + D ALL DONE (Foundations · Performance · Concurrency&Internals · Scale&Distribution).**

### Track E — Operations & Production
| Module | A | B | C | D |
|--------|---|---|---|---|
| M13 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M13 files:**
- Pass A — `00-skeleton.md` (16 concepts)
- Pass B (core notes) — `01-why-ops-backups-pitr-rpo-rto.md` (13.1–13.5) · `02-online-ddl-observability.md` (13.6–13.10) · `03-earlywarning-pooling-config-security-capstone.md` (13.11–13.16)
- Pass C (diagrams + worked examples) — `04/05/06-passC-…` + **`assets/` (8 ★ custom SVGs: backup-types, PITR, tested-restore, online-DDL, observability, early-warning, security-layers, operable-platform)**
- Pass D (code-specifics, failure modes, fintech, interview, self-check) — `07-passD-enrich-13.1-13.5.md` · `08-passD-enrich-13.6-13.10.md` · `09-passD-enrich-13.11-13.16.md`

> 8/8 Mermaid + 8/8 ★ SVGs render-validated; SVG refs resolve. Makes the correct+scaled system *operable* (recoverable/observable/changeable/secure). Pass D SQL self-reviewed (money `*_minor BIGINT`, never FLOAT; reserved words handled). Key: backup types + PITR (binlog's 3rd use) + RPO/RTO + **tested restores** ("you don't have backups, you have restores"); online DDL (gh-ost/native, copy-sync-cutover); observability + golden signals + **early-warning signals** (the M08/M09/M10 internals as leading indicators); pooling; config-that-matters (the money/durability settings); security defense-in-depth; reconciliation watchdog. Opens Track E.

**▶ M01–M13 content-complete — Tracks A–D done + Track E started (M13 Operations).**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M14 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M14 files (reference/distillation module — *guides*, not teaching concepts):**
- Pass A — `00-skeleton.md` (16 guides)
- Pass B (guide decision logic) — `01-guides-index-isolation-locking-lag-slow.md` (14.1–14.7) · `02-guides-lostdata-durability-scale-antipatterns-cheatsheet.md` (14.8–14.16)
- Pass C (the actual trees/flowcharts/matrices) — `03-passC-trees-14.1-14.7.md` · `04-passC-trees-14.8-14.16.md` + **`assets/` (3 ★ custom SVGs: lost-data-triage, anti-pattern-catalog, master-cheatsheet)**
- Pass D (code-specifics, fintech, interview, self-check — consolidated) — `05-passD-enrich.md`

> 11/11 Mermaid + 3/3 ★ SVGs render-validated; SVG refs resolve. *Distills* M01–M13 into fast decision-trees/triage-flowcharts/matrices + the anti-pattern catalog + the master one-page cheat-sheet (Mermaid-heavy, the right form for quick-reference). The "I lost data" tree (14.8) is the **entry point to M15**. Key guides: which-index, which-isolation (+anomaly matrix), deadlock/lock-wait/MDL triage, lag triage, slow-query triage, lost-data triage, durability matrix, scale decision, distributed quick-pick, anti-pattern catalog, sizing, is-MySQL-right, master cheat-sheet.

**▶ M01–M14 content-complete — Tracks A–D done + Track E in progress (M13 Ops + M14 Cheat-Sheet).**

| Module | A | B | C | D |
|--------|---|---|---|---|
| M15 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M15 files (the critical chapter — *catastrophic-failure scenarios*: symptom→cause→fix→prevention + money verdict):**
- Pass A — `00-skeleton.md` (16 scenarios)
- Pass B (root-cause/fix/prevention) — `01-mindset-crashloss-splitbrain-corruption-forcerecovery.md` (15.1–15.6) · `02-pitrgaps-droptable-applevel-backup-diskfull.md` (15.7–15.11) · `03-oom-hllbloat-sbrbreak-triage-prevention.md` (15.12–15.16)
- Pass C (catastrophe diagrams + worked recoveries) — `04/05/06-passC-…` + **`assets/` (10 ★ custom SVGs: failure-mindset, crash-loss-windows, split-brain, corruption, force-recovery, PITR-gap, lost-update, untested-backup, triage-tree, prevention-checklist)**
- Pass D (recovery code-specifics, money verdict, interview, self-check) — `07/08/09-passD-enrich-…`

> 6/6 Mermaid + 10/10 ★ SVGs render-validated; SVG refs resolve. **User-flagged priority chapter** ("rare situation and fixes/solutions"). Each scenario = symptom→root cause→fix→prevention + **"did money get lost/duplicated?" verdict**. Pass D SQL self-reviewed (money `*_minor BIGINT`, never FLOAT; reserved words handled). Scenarios: failure mindset (silent+rare), lost-txns-on-crash (durability windows), split-brain (fence>reconcile), errant-txns/GTID-drift, silent corruption (bit-rot/lying-disks/torn-pages/checksums/doublewrite), **innodb_force_recovery 1-6**, PITR gaps, dropped-table recovery, app-level loss (lost-update/RMW/dual-write), the-backup-that-won't-restore, disk-full, OOM-killer, HLL-bloat, SBR-divergence, **the "I lost data" triage tree** (contain→assess→recover→VERIFY→prevent), **the prevention checklist** (3 universals: durability config, reconciliation, tested-recovery+early-warning). The dark mirror of every prior guarantee.

**▶ M01–M15 content-complete — Tracks A–E ALL DONE.**

### Track F — Capstone
| Module | A | B | C | D |
|--------|---|---|---|---|
| M16 ★ | ✅ | ✅ | ✅ | ✅ **complete** |

**M16 files (the capstone — *fintech challenges*, synthesizing M01–M15):**
- Pass A — `00-skeleton.md` (16 challenges)
- Pass B (challenge designs) — `01-frame-ledger-idempotency-money-consistency.md` (16.1–16.5) · `02-hotaccount-reconciliation-audit-fx-scaling-dr.md` (16.6–16.11) · `03-outbox-antipatterns-interview-adjacent-complete.md` (16.12–16.16)
- Pass C (architecture diagrams + design walkthroughs) — `04/05/06-passC-…` + **`assets/` (9 ★ custom SVGs: design-frame, ledger, idempotency, money-movement, hot-account, reconciliation, multi-currency, DR-posture, complete-platform)**
- Pass D (code-specifics, money guarantee, interview, self-check) — `07-passD-enrich-16.1-16.8.md` · `08-passD-enrich-16.9-16.16.md`

> 7/7 Mermaid + 9/9 ★ SVGs render-validated; SVG refs resolve. The synthesis capstone — organized *by fintech challenge*, composing every prior module. Challenges: the design frame, the double-entry ledger, idempotency, money movement (atomic/holds/two-phase), per-operation consistency, hot-account contention, reconciliation, audit/compliance, multi-currency/FX, scaling, DR ("what zero-data-loss costs"), the outbox/CDC backbone, the anti-pattern catalog, the interview playbook, adjacent domains, and **the complete end-to-end platform** (16.16 — the flagship). Pass D SQL self-reviewed (money `*_minor BIGINT`/`DECIMAL`, never FLOAT; `transaction_`).

---

## 🎉 RESOURCE COMPLETE — M01–M16, all Passes A–D

**All 16 modules content-complete.** A concept-first, fintech-focused MySQL deep-revision resource at staff/architect depth, modeled on *High Performance MySQL*.

| Track | Modules |
|-------|---------|
| **A · Foundations** | M01 Relational Foundations · M02 Normalization · M03 Data Types |
| **B · Performance** | M04 Query Execution · M05 Indexing ★ · M06 Optimization/EXPLAIN |
| **C · Concurrency & Internals** | M07 Transactions/ACID · M08 Locking/MVCC ★ · M09 InnoDB Internals & Disk Durability ★ |
| **D · Scale & Distribution** | M10 Replication ★ · M11 Sharding ★ · M12 Distributed Data ★ |
| **E · Operations** | M13 Operations/Backups/Observability ★ · M14 Cheat-Sheet/Decision-Guides · M15 Failure Modes & Data Loss ★ |
| **F · Capstone** | M16 Fintech System Design ★ |

**Totals: 16 modules · 155 markdown files · 78 validated custom SVGs · ~260 concepts/guides/scenarios/challenges.** Every Mermaid diagram (`mmdc`) and custom SVG (`xmllint` + `rsvg-convert`) validated; every SVG reference resolves. Four threads carried throughout — **durability** ("what survives a crash?"), **money-never-lies** ("did money get lost/duplicated?"), **generics-first** (the agnostic principle before MySQL specifics), and **tradeoff** (nothing is free). Single running payments/wallet domain; money in integer minor units / `DECIMAL` (never FLOAT); reserved word `transaction` → `transaction_`.

> Presentation (the eventual interactive website) remains deliberately deferred — the content is now locked across all 16 modules.
