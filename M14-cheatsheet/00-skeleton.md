# M14 · Production Cheat-Sheet & Decision Guides — Pass A (Skeleton)

> **Pass A goal:** lock the ordered entry list, a one-line purpose per entry, and the planned diagram (mostly Mermaid decision-trees/flowcharts + matrices). No prose yet — that's Pass B. **This is a *reference/distillation* module**, not a teaching module: it *distills* M01–M13 into fast, actionable quick-references — decision trees, triage flowcharts, matrices, and an anti-pattern catalog. Entries are *guides*, not new concepts.
>
> **Module mental model:** *Twelve teaching modules built the deep understanding; this module makes it* fast to apply *under pressure. It's the* one-page-per-question *reference an engineer reaches for in production or an interview — "which index do I add?", "which isolation level?", "the replicas are lagging, now what?", "I think I lost data — what do I do?" — each answered as a* decision tree *or* triage flowchart *that walks you from symptom to action, plus* matrices *(isolation×anomaly, durability config, force-recovery levels) and an* anti-pattern catalog *(the recurring mistakes and their fixes). Nothing here is new — it's the prior modules'* knowledge compressed into decisions *. The value is* speed and recall under pressure *: in an incident you don't re-derive MVCC, you follow the lag-triage tree; in an interview you don't reconstruct the isolation levels, you recall the matrix. For fintech, these are the runbooks (the* money-never-lies *decisions made fast and correctly when it counts).*
>
> **Threads carried in this module:**
> - **Durability** — the durability-config matrix (`flush_log_at_trx_commit`×`sync_binlog`, M09) and the "I lost data" triage tree are durability distilled into a decision.
> - **Money-never-lies** — *every* triage guide carries the "did money get lost/duplicated?" check; the lost-data tree's first step is *contain* (stop the bleeding) then *assess blast radius*, the money-safe incident response.
> - **Generics-first** — the decision logic (which index, which isolation, lag/deadlock/lost-data triage) is database-agnostic; the cheat-sheet states the principle, then the MySQL specifics.
> - **Tradeoff** — every decision tree *is* a tradeoff made explicit (which isolation = correctness vs concurrency; which index = read speed vs write cost; shard-or-not = scale vs complexity).
>
> **Prereqs:** *all of M01–M13* (this module distills them — it has no new prerequisites, it *references* everything). Each guide cites the module it compresses. **Leads into:** **M15 (Failure Modes & Data Loss — the "I lost data" triage tree here is the *entry point* to M15's catastrophic-failure deep-dives; M14 is the fast decision, M15 is the detailed incident handling)**, M16 (the fintech capstone uses these guides as its operational runbooks).

---

## Entry list (ordered — guides, not concepts)

| # | Entry | Purpose (one line) | Diagram |
|---|-------|--------------------|---------|
| 14.1 | **How to use this cheat-sheet** | The map: which guide for which question, and the "distilled from M01–M13, not new" framing. | Index/map of the guides → the question each answers |
| 14.2 | **"Which index?" decision tree** ★ | From a slow query → the right index (composite column order, covering, leftmost-prefix, when NOT to index) — distills M05/M06. | Mermaid decision tree: query shape → index choice |
| 14.3 | **"Which isolation level?" guide + the anomaly matrix** | Pick the isolation level by the anomalies you must prevent vs the concurrency you need — distills M07/M08. | Isolation × anomaly matrix + a choose-the-level tree |
| 14.4 | **Deadlock triage flowchart** | A deadlock fired — diagnose (the deadlock log), fix (lock ordering, shorter txns, SKIP LOCKED), prevent — distills M08. | Mermaid triage: symptom → diagnose → fix → prevent |
| 14.5 | **Lock-wait vs deadlock vs MDL stall** | Distinguish the three "everything's blocked" causes (lock-wait timeout, deadlock, metadata-lock stall) and their distinct fixes — distills M08. | Decision: which "blocked" am I? → the specific fix |
| 14.6 | **Replica-lag triage flowchart** | Replicas are lagging — diagnose (slow query? long txn? write spike? single-threaded apply?), fix, prevent — distills M10/M13. | Mermaid triage: lag → cause → fix (parallel apply, etc.) |
| 14.7 | **Slow-query triage flowchart** | A query is slow — slow log → pt-query-digest (by total time) → EXPLAIN → fix (index/rewrite) — distills M06/M13. | Mermaid triage: slow → find → EXPLAIN → fix |
| 14.8 | **"I think I lost data" triage tree** ★ | The incident response: CONTAIN (stop the bleeding) → assess blast radius → recover (PITR/failover/restore) → verify (reconcile) → post-mortem — the entry to M15. ★ | ★ the lost-data triage tree (contain → recover → verify) |
| 14.9 | **The durability config matrix** | `innodb_flush_log_at_trx_commit` (0/1/2) × `sync_binlog` (0/1/N): for each combo, exactly what you lose on crash + the throughput — distills M09. | Matrix: the durability/throughput combinations |
| 14.10 | **Replication mode + RPO/RTO quick-pick** | Async vs semi-sync vs group replication, and the backup/failover choices, picked by RPO/RTO — distills M10/M13. | Quick-pick: requirement → replication + recovery choice |
| 14.11 | **Scale decision: partition vs replica vs shard** | The "one box isn't enough" decision — diagnose the bottleneck (read/write/storage) → the right tool — distills M11/M13. | Decision tree: bottleneck → partition/replica/shard |
| 14.12 | **Distributed-pattern quick-pick** | Cross-node operation? → co-locate / Saga / idempotency / outbox / CDC / reconcile — pick the pattern by the problem — distills M12. | Quick-pick: distributed problem → the pattern |
| 14.13 | **The anti-pattern catalog** ★ | The recurring mistakes (FLOAT money, SELECT *, N+1, leading wildcard, missing index, naive ALTER, dual-write, stale-replica money read, untested backup, …) → the fix, each. ★ | ★ the anti-pattern → fix catalog (grouped by module) |
| 14.14 | **Sizing rules of thumb** | Quick capacity heuristics — buffer pool ~70-80% RAM, connection pool sizing, when to shard, index count limits, row-size guidance — distills M09/M11/M13. | A rules-of-thumb reference table |
| 14.15 | **"Is MySQL the right tool?" decision guide** | When MySQL fits (OLTP, ACID, relational) vs when to reach elsewhere (analytics→warehouse, KV→Redis, search→ES, graph, time-series) — the honest tool-fit guide. | Decision: workload → MySQL or which alternative |
| 14.16 | **The master cheat-sheet (one-page recall)** ★ | The single-page condensation — the key numbers, defaults, decisions, and "money settings" — the interview/incident recall sheet. ★ | ★ the master one-page cheat-sheet (the whole journey, condensed) |

---

## Diagram inventory for M14 (Pass C targets)

- **★ Bespoke SVG (few — this is a Mermaid-heavy reference module):** the genuinely-bespoke ones are **14.8** (the "I lost data" triage tree — *the* flagship, the M15 entry point), **14.13** (the anti-pattern → fix catalog — a rich grouped visual), and **14.16** (the master one-page cheat-sheet — the condensation of the whole journey). Possibly **14.2** (the "which index?" tree) if it's richer as an SVG. So **~3–4 ★ SVGs** (far fewer than the teaching modules — this is a *reference* module, so most entries are **Mermaid decision-trees/flowcharts** or **matrices/tables**, which is the *right* form for quick-reference).
- **Standard (Mermaid decision-trees/flowcharts):** 14.2 (which index), 14.3 (isolation), 14.4 (deadlock triage), 14.5 (lock-wait/deadlock/MDL), 14.6 (lag triage), 14.7 (slow-query triage), 14.10 (replication quick-pick), 14.11 (scale decision), 14.12 (distributed quick-pick), 14.15 (is-MySQL-right).
- **Matrices/tables:** 14.3 (isolation × anomaly), 14.9 (durability config), 14.14 (sizing rules).

## Worked-example domain

Single running **payments/wallet** domain (continues M01–M13), the ledger — but as a *reference* module, the "worked examples" are *applied triage walkthroughs*: walking the lag-triage tree on a real lagging payments replica, the lost-data tree on a real ledger incident, the which-index tree on a slow transfer-history query, the anti-pattern catalog against the payments schema. Each guide is demonstrated *being used* on the payments platform.

## "Go deeper" additions (matching house style)

This module's value is *not* depth (the depth is in M01–M13) — it's *compression and recall*. The "go deeper" here is **completeness and actionability**: every common production question has a guide; every guide goes symptom → action (not just theory); the matrices give the *exact* tradeoffs (durability combos, isolation anomalies); the anti-pattern catalog is *comprehensive* (every recurring mistake from the whole journey); and the "I lost data" tree is a *real incident runbook* (contain → recover → verify, the money-safe response, entry to M15). The flagship distillations: the **lost-data triage tree** (14.8 — the money-incident runbook), the **durability matrix** (14.9 — the exact what-you-lose table), the **anti-pattern catalog** (14.13 — the whole journey's mistakes + fixes), and the **master cheat-sheet** (14.16 — one-page recall). For fintech, these are the runbooks that make the *money-never-lies* decisions fast and correct under pressure.

## Open questions surfaced during Pass A (not blocking — autopilot defaults adopted)

1. **M14 as reference vs teaching:** M14 is a *reference* module (distills M01–M13 into guides), so its entries are *decision trees/flowcharts/matrices*, not 12-point teaching concepts. **Default: confirmed** — the content contract is *adapted*: each guide gives purpose + the decision logic (the "how to decide") + the diagram + the module it distills + the money/fintech angle, rather than the full 12-point teaching treatment (which lives in the source modules). Pass B/C/D are lighter (the guides + their diagrams + the anti-pattern/cheat-sheet content), since there's no new theory to teach.
2. **M14/M15 boundary:** the "I lost data" triage tree (14.8) is the *fast decision/entry point*; M15 is the *detailed catastrophic-failure handling*. **Default: confirmed** — 14.8 routes to M15's deep-dives (contain → assess → which M15 scenario → recover).
3. **★ SVG count (~3–4) + entry count (16).** A reference module is rightly Mermaid/matrix-heavy. **Default: keep 16 entries + ~3–4 ★ SVGs** (lost-data tree, anti-pattern catalog, master cheat-sheet, maybe which-index) — the rest as Mermaid decision-trees + matrices (the correct form for quick-reference).

## Pass A status: ✅ drafted — autopilot: proceeding to Pass B (the guides' decision logic).
