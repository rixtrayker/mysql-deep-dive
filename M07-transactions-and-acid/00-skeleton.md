# M07 · Transactions & ACID — Pass A (Skeleton)

> **Pass A goal:** lock the ordered concept list, a one-line mental model per concept, and the planned diagram + worked example per concept. No prose yet — that's Pass B.
>
> **Module mental model:** *A transaction is a promise that a group of operations happens* all-or-nothing, in isolation, and durably *— so that concurrent users and crashes can't leave your data in a half-finished or contradictory state. This is the deepest reason a money system uses a database: a transfer is "debit A and credit B," and there must be* no observable moment *where one happened without the other, no concurrent transfer that corrupts the balance, and no crash that loses a committed payment. ACID is the four guarantees that make this true: **Atomicity** (all-or-nothing), **Consistency** (invariants preserved), **Isolation** (concurrent transactions don't interfere), **Durability** (committed = survives a crash). Isolation is the subtle, expensive one — it comes in* levels *that trade correctness for concurrency, and choosing the level (and knowing which anomalies each permits) is where most real-world transaction bugs live.*
>
> **Threads carried in this module:**
> - **Money-never-lies** — *the* thread here: every isolation anomaly (dirty read, lost update, phantom) is a way money is mis-counted, double-spent, or created/destroyed. ACID is the formal machinery that makes "the books always balance" enforceable under concurrency.
> - **Durability** — the D in ACID; *committed must survive a crash*. This module states the guarantee; M09 shows the mechanism (redo log/WAL, fsync).
> - **Generics-first** — ACID, isolation levels, and the read anomalies are vendor-neutral concurrency theory (the SQL standard, decades of database research); MySQL/InnoDB is one realization with its own defaults and quirks.
> - **Tradeoff** — isolation is a spectrum: stronger isolation = more correctness but less concurrency/throughput (and more locking/aborts). Choosing the level is the central tradeoff.
>
> **Prereqs:** M01 (the ledger/double-entry invariant 1.19, FKs), M04 (InnoDB as the transactional engine 4.12, the storage layer), M02 (the normalized-ledger/derived-balance pattern that transactions keep consistent 2.17). **Leads into:** M08 (Locking & MVCC — *how* InnoDB actually implements isolation), M09 (InnoDB internals & durability — *how* the D and crash-recovery work), M12 (distributed transactions — ACID across nodes), M16 (the payments platform's transactional core).

---

## Concept list (ordered)

| # | Concept | One-line mental model | Diagram | Worked example |
|---|---------|----------------------|---------|----------------|
| 7.1 | **What a transaction is & why** | A transaction groups operations into one all-or-nothing unit, so partial failure and concurrency can't leave inconsistent state — the reason money lives in a transactional DB. ★ | Transaction lifecycle (BEGIN→work→COMMIT/ROLLBACK) | The Alice→Bob transfer: debit + credit must be one atomic unit |
| 7.2 | **Atomicity: all-or-nothing** | Either every operation in the transaction takes effect, or none does — a failure anywhere rolls the whole thing back, leaving no trace. | All-or-nothing: commit vs rollback (undo) | A transfer that fails after the debit but before the credit — atomicity undoes the debit |
| 7.3 | **Consistency: invariants preserved** | A transaction moves the database from one valid state to another, never violating its declared rules (constraints, the books balancing). | Valid state → txn → valid state (invariants held) | The double-entry invariant (SUM=0, M01/1.19) holds across a transfer; a CHECK rejects a bad one |
| 7.4 | **Isolation: concurrent transactions don't interfere** | Each transaction runs as if it were alone, even when many run at once — the hard, expensive guarantee, delivered in *levels*. | Concurrent timelines with/without isolation | Two transfers hitting the same account concurrently — isolation prevents corruption |
| 7.5 | **Durability: committed survives a crash** | Once a transaction commits, its effects persist even if the server crashes a microsecond later — the guarantee; M09 has the mechanism. | Commit → durable (survives crash); preview of WAL | A committed transfer survives a power loss the instant after COMMIT |
| 7.6 | **Transaction boundaries & autocommit** | Where a transaction begins and ends is a deliberate choice; by default MySQL auto-commits each statement, so multi-step money operations must explicitly group themselves. | autocommit on (per-statement) vs explicit BEGIN…COMMIT | Why the transfer must be one explicit transaction, not two auto-committed statements |
| 7.7 | **COMMIT, ROLLBACK & savepoints** | COMMIT makes changes permanent, ROLLBACK undoes them; savepoints allow partial rollback to a marked point within a transaction. | Transaction with savepoints + partial rollback | Rolling back one failed leg of a multi-step batch without aborting the whole thing |
| 7.8 | **The isolation levels (the SQL standard four)** | READ UNCOMMITTED → READ COMMITTED → REPEATABLE READ → SERIALIZABLE: a ladder of increasing isolation, each permitting fewer anomalies at higher cost. ★ | The four levels as a ladder | Walk the same two concurrent transactions up the ladder, watching anomalies disappear |
| 7.9 | **Read anomalies: dirty, non-repeatable, phantom** | The three classic concurrency bugs the isolation levels are defined to prevent — reading uncommitted data, a value changing mid-transaction, rows appearing mid-transaction. ★ | Each anomaly as a two-transaction timeline | Dirty read of an un-committed balance; a balance that changes between two reads; a phantom entry |
| 7.10 | **The isolation × anomaly matrix** | A single table mapping each isolation level to which anomalies it permits — the canonical reference that makes the whole topic click. ★ | The matrix (levels × anomalies, permitted/prevented) | Read the matrix to choose the level for a given money operation |
| 7.11 | **The lost update problem** | Two transactions read-modify-write the same value concurrently; one silently overwrites the other — *the* classic money bug, and why naive balance updates are dangerous. ★ | Lost-update timeline + the fix (atomic/locked update) | Two concurrent deposits to one balance; one deposit vanishes — and the three ways to prevent it |
| 7.12 | **Optimistic vs pessimistic concurrency control** | Two strategies for safe concurrent writes — lock first (pessimistic) or detect conflict at commit (optimistic, via version checks) — each with a sweet spot. | Pessimistic (lock) vs optimistic (version-check) flows | Updating a hot balance: SELECT…FOR UPDATE vs a version-column compare-and-set |
| 7.13 | **Write skew & SERIALIZABLE's role** | A subtler anomaly where two transactions each read a valid state and write disjoint data, yet together violate an invariant — only SERIALIZABLE (or explicit locks) prevents it. | Write-skew timeline (two reads, disjoint writes, broken invariant) | Two withdrawals each leaving balance ≥ 0 individually, together overdrawing the account |
| 7.13b | **MySQL/InnoDB's actual defaults & behavior** | InnoDB defaults to REPEATABLE READ (not the standard's typical RC), uses MVCC + next-key locks, and prevents more than the standard requires — the real-world reality vs the textbook. | InnoDB reality vs SQL-standard expectation | Why InnoDB's REPEATABLE READ avoids phantoms the standard allows (next-key locks, preview M08) |
| 7.14 | **Choosing an isolation level (the decision)** | Match the level to the operation's correctness needs vs concurrency cost — most money operations want RR or explicit locking; reporting can tolerate weaker. | Decision flow: operation → required guarantee → level | Choosing RR + row locks for a transfer; RC/snapshot for a dashboard read |
| 7.15 | **Transactions, performance & pitfalls** | Long-running and large transactions hold locks and undo, blocking others and bloating the engine — keep transactions short, and beware the failure modes. | Short vs long transaction impact (locks/undo held) | A long-open transaction holding locks → contention + history-list bloat (preview M08/M09) |
| 7.16 | **Fintech capstone: the atomic transfer & money invariants** | The canonical money-movement transaction — debit + credit + balance update, atomic, isolated, durable, idempotent — the transactional heart of the payments system. ★ | The full transfer transaction (annotated, all ACID + idempotency) | End-to-end: post a transfer correctly under concurrency and crashes (synthesizes M01/M02/M05, sets up M08/M16) |

---

## Diagram inventory for M07 (Pass C targets)

- **Notation standard:** two-transaction **timeline diagrams** (the natural way to show anomalies and isolation) for 7.9/7.11/7.13; flow/state for transaction lifecycle (7.1/7.7); the level **ladder** (7.8); decision flows (7.14). Mostly Mermaid (sequence/timeline diagrams render well).
- **★ Bespoke SVG candidates (decide in Pass C):** **7.10 (the isolation × anomaly matrix)** — a reference table best as a clean, colorful custom SVG; **7.16 (the annotated atomic-transfer transaction)** — the money capstone. (7.11 lost-update and the level ladder may also warrant SVG; Mermaid sequence diagrams likely suffice for the anomaly timelines.) Reuse the M05 SVG workflow (validated render).

## Worked-example domain

Single running **payments/wallet** domain (continues M01–M06), using the M05-indexed ledger. The recurring vehicles: the **Alice→Bob transfer** (debit + credit + balance update — the atomic unit), **concurrent transfers to one hot account** (isolation/lost-update/write-skew), and **a dashboard read during writes** (snapshot/weaker isolation). The double-entry invariant (SUM=0, M01/1.19) and the normalized-ledger/derived-balance pattern (M02/2.17) are what transactions keep consistent.

## "Go deeper" additions (matching house style)

Beyond a basic "BEGIN/COMMIT and four isolation levels" treatment, this skeleton deliberately includes the staff-level material: **the lost-update problem as its own concept with three fixes (7.11)**, **optimistic vs pessimistic concurrency control (7.12)**, **write skew and why it needs SERIALIZABLE (7.13)** — the anomaly the SQL-standard three don't name — **InnoDB's actual defaults vs the textbook (7.13b)** (RR default, MVCC + next-key locks preventing phantoms the standard allows), **the explicit level-choosing decision (7.14)**, and **transaction performance pitfalls / long-transaction harms (7.15)** — the things that separate "knows ACID" from "reasons correctly about concurrency and chooses the right isolation under real contention."

## Open questions surfaced during Pass A (not blocking)

1. **Overlap with M08 (Locking & MVCC):** M07 is *what* (the guarantees, isolation levels, anomalies — the contract); M08 is *how* (locks, MVCC version chains, next-key locks — the mechanism). Confirm this split — M07 stays at the semantic/contract level, deferring lock/MVCC mechanics to M08 with forward-references? (Proposed: yes — avoids duplication; 7.13b previews just enough InnoDB reality to be honest.)
2. **★ SVG scope:** author the isolation×anomaly matrix (7.10) and the atomic-transfer capstone (7.16) as custom SVGs (the others Mermaid sequence/timeline)? (Proposed: yes for those two; decide in Pass C.)
3. **Concept count (~16, with a 7.13b).** Comfortable, or fold 7.13b into 7.8/7.13, or merge 7.12 optimistic/pessimistic into 7.11 lost-update?

## Pass A status: ✅ drafted — awaiting your sign-off before Pass B (core notes).
