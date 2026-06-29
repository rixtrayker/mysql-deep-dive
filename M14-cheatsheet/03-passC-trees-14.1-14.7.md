# M14 · Pass C — Decision Trees & Flowcharts · Guides 14.1–14.7

> **Pass C scope:** the actual **decision-trees / triage-flowcharts / matrices** (the reference content itself) + a short applied walkthrough per guide. Mostly Mermaid (the right form for quick-reference). Pairs with `01-guides-…`. Domain: payments/wallet, the ledger.

---

## 14.1 · How to use this cheat-sheet

**The map (question → guide):**

```mermaid
flowchart TB
    Q["your question (production / interview)"]
    Q --> SLOW["query slow? → 14.7 triage · need an index? → 14.2"]
    Q --> ISO["which isolation? → 14.3 (+ anomaly matrix)"]
    Q --> BLOCK["everything blocked / deadlock? → 14.4 deadlock · 14.5 lock-wait vs deadlock vs MDL"]
    Q --> LAG["replicas lagging? → 14.6 triage"]
    Q --> LOST["LOST DATA? → 14.8 (CONTAIN→recover→VERIFY) → M15"]
    Q --> DUR["durable enough? → 14.9 matrix · replication/RPO/RTO? → 14.10"]
    Q --> SCALE["one box not enough? → 14.11 · cross-node op? → 14.12"]
    Q --> META["doing something dumb? → 14.13 · how big? → 14.14 · MySQL right? → 14.15 · one-pager → 14.16"]
    note["nothing here is NEW — it's M01–M13 compressed into DECISIONS for speed + recall under pressure"]
    LOST --> note
```

**Applied.** Under incident pressure on the payments platform, you don't re-derive theory — you match the symptom to the guide and follow the runbook. "The replicas are lagging and a balance read looks stale" → 14.6 (lag triage) + route money reads to the primary (12.4). "I think a deploy dropped ledger rows" → 14.8 (contain first!). This map is the front door.

---

## 14.2 · "Which index?" decision tree ★

**The decision tree:**

```mermaid
flowchart TB
    START["slow query — what index?"]
    START --> COLS["identify: WHERE = cols · range col · JOIN cols · ORDER BY cols"]
    COLS --> ORDER["composite order: (=cols…, ONE range col, sort cols) — leftmost-prefix rule (M05)"]
    ORDER --> COVER{"can the index include<br/>ALL columns the query needs?"}
    COVER -- yes --> COVERING["COVERING index → index-only scan (no table lookup) — best for hot queries (M05/M06)"]
    COVER -- no --> SEL{"are the filter cols<br/>SELECTIVE (many distinct)?"}
    SEL -- yes --> ADD["add the composite index in that order"]
    SEL -- no --> SKIP["low selectivity → the optimizer may ignore it; a scan may be cheaper — reconsider (M05)"]
    ADD & COVERING --> NOIDX["⚠ when NOT to index: write-heavy table (write amplification, M09) · redundant prefix · unused (sys.schema_unused_indexes)"]
    NOIDX --> VERIFY["VERIFY with EXPLAIN (M06): key used? access type ref/range not ALL? no unwanted filesort/temporary?"]
```

**Applied.** A slow "transfer history for account X, last 30 days, newest first" query: filters `account_id` (=), ranges `created_at`, sorts `created_at DESC` → index `(account_id, created_at)` (equality first, then the range/sort column) → and if the query selects only a few columns, make it **covering** (index-only). `EXPLAIN` confirms `ref` access on the index, no filesort. The write-heavy ledger means don't add indexes that aren't pulling their weight (M05).

---

## 14.3 · "Which isolation level?" guide + the anomaly matrix

**The anomaly matrix + choose-the-level:**

```mermaid
flowchart TB
    M["ISOLATION × ANOMALY (what each PERMITS, M07/M08)"]
    M --> RU["READ UNCOMMITTED: dirty ✓ · non-repeatable ✓ · phantom ✓ — almost never use"]
    M --> RC["READ COMMITTED: dirty ✗ · non-repeatable ✓ · phantom ✓ — high concurrency, less locking"]
    M --> RR["REPEATABLE READ (default): dirty ✗ · non-repeatable ✗ · phantom ✗* (InnoDB MVCC + gap locks) — the workhorse"]
    M --> SER["SERIALIZABLE: all ✗ — most locking, least concurrency"]
    RR --> CHOOSE["choose the WEAKEST level that's still correct (M07/7.14)"]
    CHOOSE --> MONEY["MONEY (transfer reads-then-writes a balance) → ≥ REPEATABLE READ + SELECT…FOR UPDATE (M08), or atomic UPDATE…WHERE balance>=amt"]
    CHOOSE --> REPORT["read-mostly/reporting → READ COMMITTED (more concurrency, staleness OK)"]
```

**Applied.** A transfer must not suffer a *lost update* (two concurrent transfers both reading balance=$100 and each debiting $80 → one overwrites the other → $20 instead of -$60-rejected). Fix: **REPEATABLE READ + `SELECT … FOR UPDATE`** on the balance row (serialize the two, M08), or the single atomic `UPDATE account SET balance_minor = balance_minor - :amt WHERE account_id=:a AND balance_minor >= :amt` (M07/7.16 — no read-then-write gap). Money correctness over concurrency.

---

## 14.4 · Deadlock triage flowchart

**The triage:**

```mermaid
flowchart TB
    D["deadlock error fired"]
    D --> DIAG["DIAGNOSE: SHOW ENGINE INNODB STATUS → 'LATEST DETECTED DEADLOCK' — the 2 txns, locks held, locks waited (M08)"]
    DIAG --> IMM["IMMEDIATE: InnoDB rolled back the cheaper victim → the app RETRIES (with backoff) — deadlocks are normal, retry is expected"]
    IMM --> FIX["FIX THE CAUSE:"]
    FIX --> ORD["consistent LOCK ORDERING — always lock rows in the same order (e.g., lower account_id first)"]
    FIX --> SHORT["shorter transactions (less lock overlap, M07/7.15)"]
    FIX --> SKIP["SKIP LOCKED for queue-style processing (skip locked rows, no contention, M08)"]
    ORD & SHORT & SKIP --> PREV["PREVENT: canonical lock order · short txns · avoid unnecessary locking reads"]
```

**Applied.** Two transfers — A→B and B→A — each lock their source then destination balance; in opposite order they form a cycle → deadlock. Fix: **always lock the lower account_id first** (both transfers lock A then B → no cycle). InnoDB rolls back the victim; the app retries. *The* classic payments deadlock, fixed by canonical lock ordering.

---

## 14.5 · Lock-wait vs deadlock vs MDL stall

**Which "blocked" is it?**

```mermaid
flowchart TB
    BLOCKED["queries hanging / timing out — which cause?"]
    BLOCKED --> LW{"'Lock wait timeout<br/>exceeded'?"}
    LW -- yes --> LWFIX["LOCK-WAIT: waiting on a row lock held by another running txn → find the blocker (sys.innodb_lock_waits, M13), shorten/kill it (M07/7.15)"]
    BLOCKED --> DL{"'Deadlock found;<br/>rolled back'?"}
    DL -- yes --> DLFIX["DEADLOCK: a cycle — InnoDB rolled back a victim immediately → lock ordering + retry (14.4)"]
    BLOCKED --> MDL{"'Waiting for table<br/>metadata lock' +<br/>pile-up on ONE table after a DDL?"}
    MDL -- yes --> MDLFIX["MDL STALL: a DDL waits on a long query's metadata lock → ALL queries on that table queue behind it (M08) → kill the long query / the DDL; run DDL when no long queries active; short lock_wait_timeout"]
```

**Applied.** A "harmless" online migration (13.6) on the ledger table seems to freeze *everything* on that table — the signature: a pile-up of "Waiting for table metadata lock" *after* the `ALTER` started. Cause: a long-running reporting query held the table's MDL, so the `ALTER` waits, and every transfer queues behind the waiting `ALTER` (M08). Fix: kill the long query (or the `ALTER`); run migrations when no long transactions are active. The silent, surprising outage.

---

## 14.6 · Replica-lag triage flowchart

**The triage:**

```mermaid
flowchart TB
    LAG["replicas lagging"]
    LAG --> CONFIRM["CONFIRM + measure: GTID gap / heartbeat (not just Seconds_Behind_Source — it lies, M10/10.5)"]
    CONFIRM --> CAUSE{"diagnose the cause"}
    CAUSE -- "slow applier query" --> Q["optimize it (slow log → EXPLAIN → index, M05/M13)"]
    CAUSE -- "long txn on source" --> T["find/kill it (M07/7.15, HLL M08)"]
    CAUSE -- "write spike > apply throughput" --> W["throttle / scale"]
    CAUSE -- "single-threaded apply" --> P["PARALLEL replication (replica_parallel_workers, LOGICAL_CLOCK/WRITESET, M10/10.8)"]
    CAUSE -- "replica under-provisioned" --> R["bigger/faster replica"]
    Q & T & W & P & R --> MONEY["⚠ while lagging: route money-decision reads to the PRIMARY (M10/10.6, 12.4) — lag → stale read → double-spend"]
```

**Applied.** A payments replica lags 30s. Confirm via GTID gap. Diagnose: a heavy reporting query the applier runs slowly → optimize it; or single-threaded apply under transfer load → enable **parallel replication** (M10/10.8). *Critically*, while lagging, route balance-for-authorization reads to the **primary** (12.4) so a stale replica balance doesn't cause a double-spend, and watch the failover loss window (M10/10.10). Lag is a *money* problem.

---

## 14.7 · Slow-query triage flowchart

**The triage:**

```mermaid
flowchart TB
    S["a query is slow"]
    S --> FIND["FIND: slow query log → pt-query-digest, ranked by TOTAL time (M13) — a fast query × a million calls (N+1, M06) dominates"]
    FIND --> WHY["WHY: EXPLAIN/EXPLAIN ANALYZE (M06)"]
    WHY --> CHECK{"access type ALL (full scan)?<br/>no key? filesort/temporary?"}
    CHECK -- "missing/wrong index" --> IDX["add/fix the index (14.2)"]
    CHECK -- "leading wildcard / function on col / implicit conversion" --> REWRITE["rewrite (range not function, match types, full-text not LIKE '%x')"]
    CHECK -- "SELECT * / N+1" --> QUERY["select needed cols (covering) · fix N+1 with a join"]
    IDX & REWRITE & QUERY --> VERIFY["VERIFY: re-EXPLAIN — access improved, index used, filesort/temporary gone"]
```

**Applied.** A slow reconciliation query (M02/2.17). Slow log + `pt-query-digest` surfaces it (high *total* time). `EXPLAIN` shows `ALL` (full scan of the ledger) — a missing index on the grouping column. Add it (M05) → `range`/`ref` access → fast. (And note: a slow query *on the source* also causes replica lag, 14.6 — fixing it helps both.)

---

*Decision trees for 14.1–14.7 complete (1 ★ SVG ref in 14.2's companion + 7 Mermaid). Next: 14.8–14.16 (★ lost-data tree, durability/sizing matrices, scale/distributed quick-picks, ★ anti-pattern catalog, ★ master cheat-sheet).*
