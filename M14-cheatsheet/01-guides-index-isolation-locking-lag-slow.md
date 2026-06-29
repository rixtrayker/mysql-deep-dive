# M14 · Pass B — Guides 14.1–14.7 · Index, Isolation, Locking, Lag & Slow-Query

> **Pass B scope (adapted for a reference module):** for each guide — **purpose**, **the decision logic** (how to decide / the triage steps), **what it distills** (the source module), and the **fintech angle**. No new theory (that's in M01–M13); this is *compression into fast decisions*. Diagrams (the actual trees/matrices) are Pass C.
>
> Running domain: payments/wallet, the ledger. The recurring check in every guide: *did money get lost or duplicated, and is this decision money-safe?*

---

## 14.1 · How to use this cheat-sheet

**Purpose.** The map: *which guide answers which production/interview question*, and the framing that **nothing here is new** — it's M01–M13's understanding *compressed into decisions* for speed and recall under pressure.

**The decision logic (the map).** Match your question to its guide:
- *"This query is slow — what index?"* → **14.2** (which-index tree). *"Why is it slow at all?"* → **14.7** (slow-query triage).
- *"Which isolation level?"* → **14.3** (isolation guide + anomaly matrix).
- *"Everything's blocked / a deadlock fired."* → **14.4** (deadlock triage), **14.5** (lock-wait vs deadlock vs MDL).
- *"The replicas are lagging."* → **14.6** (lag triage).
- *"I think I lost data."* → **14.8** (the lost-data triage tree → routes to M15).
- *"How durable is my config? / what do I lose on crash?"* → **14.9** (durability matrix).
- *"Which replication mode / how do I hit my RPO/RTO?"* → **14.10**.
- *"One box isn't enough."* → **14.11** (partition/replica/shard). *"Cross-node operation?"* → **14.12** (distributed quick-pick).
- *"Am I doing something dumb?"* → **14.13** (anti-pattern catalog). *"How big / how many?"* → **14.14** (sizing). *"Is MySQL even right?"* → **14.15**.
- *"Just give me the one-pager."* → **14.16** (master cheat-sheet).

**What it distills.** The whole journey (M01–M13) — this is the index over it.

**Fintech angle.** Under incident pressure (money on the line), you don't re-derive theory — you follow the *runbook*. This map is the front door to the money-safe decisions.

---

## 14.2 · "Which index?" decision tree ★

**Purpose.** From a slow query → *the right index* (or the decision *not* to index), fast — composite column order, covering, leftmost-prefix, selectivity. Distills **M05/M06**.

**The decision logic.**
1. **What does the query filter/join/sort on?** Identify the `WHERE` equality columns, range columns, `JOIN` columns, and `ORDER BY` columns.
2. **Composite column order** (M05): **equality columns first**, then **one range column**, then **`ORDER BY` columns** (the leftmost-prefix rule — an index helps a query only if the query uses a *prefix* of its columns; a range column "stops" further index use for equality). Order: `(=cols…, range col, sort cols)`.
3. **Covering index?** (M05/M06): if the index can include *all* columns the query needs (filter + selected), the query is **index-only** (no table lookup) — add the selected columns to the index (or use them as the trailing key parts) when the query is hot.
4. **Selectivity** (M05): index *selective* columns (many distinct values); a low-selectivity column alone (e.g., a boolean/status with 2 values) is a poor index (the optimizer may ignore it — it's cheaper to scan).
5. **When NOT to index** (M05): write-heavy tables (every index is write amplification — page splits, M09), low-selectivity columns, redundant indexes (a prefix of an existing one), and indexes the optimizer never uses (`sys.schema_unused_indexes`, M13).
6. **Verify with `EXPLAIN`** (M06): confirm the new index is *used* (`key`), the access type improved (`ref`/`range` not `ALL`), and `Extra` doesn't show `Using filesort`/`Using temporary` you wanted to avoid.

**What it distills.** M05 (index structure, composite order, covering, selectivity, leftmost-prefix, when indexes hurt) + M06 (reading `EXPLAIN` to verify).

**Fintech angle.** The hot ledger/account queries (balance lookups, transfer-history by account+time) get carefully-ordered composite/covering indexes; the *write-heavy* ledger means *don't over-index* (write amplification slows transfers). Verify every index pays its way.

---

## 14.3 · "Which isolation level?" guide + the anomaly matrix

**Purpose.** Pick the isolation level by *the anomalies you must prevent* vs *the concurrency you need*. Distills **M07/M08**.

**The decision logic.**
- **The matrix** (M07 — what each level permits): **READ UNCOMMITTED** (dirty reads — almost never use), **READ COMMITTED** (no dirty reads; allows non-repeatable reads + phantoms — good for high concurrency, less locking), **REPEATABLE READ** (MySQL default; no dirty/non-repeatable reads; InnoDB's MVCC + gap locks largely prevent phantoms too, M08), **SERIALIZABLE** (no anomalies; most locking, least concurrency).
- **Choose by cost-of-anomaly vs concurrency** (M07/7.14): start from the *weakest level that's still correct* for the operation. **Money-moving operations** (a transfer reading-then-writing a balance) need **at least REPEATABLE READ** (or explicit locking, `SELECT … FOR UPDATE`, M08) so the balance can't change under them (no lost update) — for money, *correctness is non-negotiable*. **Read-mostly/reporting** can use **READ COMMITTED** (more concurrency, staleness tolerable). **SERIALIZABLE** only when you truly need full isolation (rare — usually explicit locking on REPEATABLE READ suffices).
- **The key insight** (M08): in InnoDB, isolation is enforced by **MVCC** (consistent reads) + **locking** (record/gap/next-key) — and you often combine a moderate isolation level with *explicit* locks (`FOR UPDATE`/`FOR SHARE`/`SKIP LOCKED`) for the specific rows that need it, rather than raising the global level.

**What it distills.** M07 (isolation levels, the anomalies, the matrix, choosing) + M08 (how MVCC + locking enforce it; explicit locking).

**Fintech angle.** A transfer must not suffer a lost update (two transfers debiting the same balance) → REPEATABLE READ + `SELECT … FOR UPDATE` on the balance (M08), or a single atomic `UPDATE … SET balance = balance - :amt WHERE balance >= :amt` (M07/7.16). Money correctness over concurrency, always.

---

## 14.4 · Deadlock triage flowchart

**Purpose.** A deadlock fired — *diagnose → fix → prevent*. Distills **M08**.

**The decision logic.**
1. **Diagnose** (M08): read the deadlock — `SHOW ENGINE INNODB STATUS` ("LATEST DETECTED DEADLOCK" section) shows the two transactions, the locks they held, and the lock they each waited for. Identify the **lock-acquisition order** that conflicted (txn A locked row 1 then waited for row 2; txn B locked row 2 then waited for row 1).
2. **Immediate behavior** (M08): InnoDB *detects* the cycle and **rolls back the cheaper victim** automatically (the app gets a deadlock error) — so the *immediate* fix is the app **retries** the rolled-back transaction (deadlocks are normal under concurrency; retry is expected). Ensure the app *has* retry logic with backoff.
3. **Fix the cause** (M08): **consistent lock ordering** (always lock rows/tables in the same order — e.g., always lock the lower account_id first in a transfer → no cycle), **shorter transactions** (hold locks briefly — less overlap), **lower isolation / less locking** where safe, and **`SKIP LOCKED`** for queue-style processing (skip locked rows instead of waiting → no contention).
4. **Prevent** (M08): design access patterns to acquire locks in a canonical order; keep transactions short (M07/7.15); avoid unnecessary locking reads.

**What it distills.** M08 (deadlock detection, victim selection, lock ordering, SKIP LOCKED, avoidance).

**Fintech angle.** A transfer between accounts A and B locks both balances — if two transfers (A→B and B→A) lock in opposite order, they deadlock. Fix: **always lock the lower account_id first** (canonical order → no cycle). Retry the victim. This is *the* classic payments deadlock.

---

## 14.5 · Lock-wait vs deadlock vs MDL stall

**Purpose.** Distinguish the *three* "everything's blocked" causes — they look similar but have *distinct* fixes. Distills **M08**.

**The decision logic.** "Queries are hanging/timing out" — which is it?
- **Lock-wait timeout** (M08): a transaction waits for a row lock held by *another* (still-running) transaction, and times out (`innodb_lock_wait_timeout`). *Symptom:* "Lock wait timeout exceeded." *Cause:* a long-running transaction (or a slow one) holding locks. *Fix:* find the blocker (`sys.innodb_lock_waits`, M13) and shorten/kill it; reduce transaction duration (M07/7.15).
- **Deadlock** (M08): a *cycle* of transactions each waiting for a lock the other holds — InnoDB *detects and rolls back a victim immediately* (not a timeout). *Symptom:* "Deadlock found; transaction rolled back." *Fix:* 14.4 (lock ordering, retry).
- **Metadata-lock (MDL) stall** (M08): a DDL (`ALTER`, even online, 13.8) needs a metadata lock on a table, but a *long-running query* holds the table's MDL — so the DDL *waits*, and **every subsequent query on that table queues behind the waiting DDL** → the whole table appears frozen. *Symptom:* "Waiting for table metadata lock"; a pile-up of queries on one table after a DDL. *Cause:* a long query + a DDL. *Fix:* kill the long query (or the DDL); run DDL when no long queries are active; use a short `lock_wait_timeout` for DDL so it fails fast instead of queuing everything.

**What it distills.** M08 (the three blocking causes, especially the MDL "DDL blocks every query" trap).

**Fintech angle.** An MDL stall during a "harmless" online migration (13.6) can freeze the ledger table if a long reporting query holds the MDL — the silent, surprising outage. Recognize it (the pile-up signature), kill the long query, and run migrations when no long transactions are active.

---

## 14.6 · Replica-lag triage flowchart

**Purpose.** Replicas are lagging — *diagnose the cause → fix → prevent*. Distills **M10/M13**.

**The decision logic.**
1. **Confirm + measure** (M10/M13): is it real? Check the GTID gap / heartbeat (not just `Seconds_Behind_Source`, which lies during stalls, M10/10.5). How far behind, and growing?
2. **Diagnose the cause** (M10/M13):
   - **A slow query on the applier?** A heavy statement the replica applies slowly (slow log, 13.10) → optimize it (index, M05).
   - **A long transaction on the source?** Stalls the applier until it commits (M07/7.15, M08 HLL) → find/kill it.
   - **A write spike on the source** exceeding the replica's apply throughput → the applier can't keep up.
   - **Single-threaded apply** under a parallel write load (M10/10.8) → enable **parallel replication** (`replica_parallel_workers`, LOGICAL_CLOCK/WRITESET, M10/10.8).
   - **Replica under-provisioned / I/O-bound** → bigger/faster replica.
3. **Fix**: parallel replication (M10/10.8) is the most common structural fix; optimize the slow applier query; kill the long source transaction; throttle the write spike.
4. **Prevent**: parallel replication tuned, monitoring + alerting on lag (the early-warning signal, 13.11), and never reading money-decision data off a lagging replica (M10/10.6, 12.4).

**What it distills.** M10 (lag causes/measurement, parallel replication) + M13 (monitoring, slow-query diagnosis).

**Fintech angle.** Lag → stale reads → a **double-spend** if a balance-for-authorization hits a lagging replica (M10/10.6, 12.4) → and a wider **failover data-loss window** (M10/10.10). So lag is a *money* problem: triage it fast, and route money-decision reads to the primary (12.4) while you do.

---

## 14.7 · Slow-query triage flowchart

**Purpose.** A query is slow — *find it → understand why → fix it*. Distills **M06/M13**.

**The decision logic.**
1. **Find the high-impact queries** (M13): the **slow query log** → **`pt-query-digest`**, ranked by **total time** (not single-slowest — a fast query × a million calls dominates, e.g., an N+1, M06). Fix the biggest *cumulative* consumers first.
2. **Understand why** (M06): `EXPLAIN`/`EXPLAIN ANALYZE` the query — look at **access type** (`ALL` = full scan = bad; want `ref`/`range`/`eq_ref`/`const`), **`key`** (is an index used?), **`rows`** (estimate scanned), **`Extra`** (`Using filesort`, `Using temporary`, `Using index` = covering). Diagnose: missing index? non-selective index? implicit conversion (a type mismatch defeating the index)? leading wildcard (`LIKE '%x'` can't use the index)? function on the column (`WHERE DATE(col)=…` defeats the index)?
3. **Fix** (M05/M06): add/fix the **index** (14.2), **rewrite** the query (avoid `SELECT *`, fix N+1 with a join, remove the function-on-column, fix the implicit conversion), or restructure (covering index, better join order).
4. **Verify**: re-`EXPLAIN` — the access type improved, the index is used, filesort/temporary gone where intended.

**What it distills.** M06 (EXPLAIN reading, join algorithms, anti-patterns) + M13 (slow log, pt-query-digest, P_S/sys).

**Fintech angle.** A slow transfer-history or reconciliation query (M02/2.17) often hides a missing index (M05) or an N+1 (M06) — found via the slow log + EXPLAIN, fixed with the right index. A slow query on the source also *causes replica lag* (14.6) → a money problem.

---

*Guides 14.1–14.7 complete. Next: 14.8–14.16 (lost-data triage, durability matrix, replication/scale/distributed quick-picks, anti-pattern catalog, sizing, is-MySQL-right, master cheat-sheet).*
