# M14 · Pass D — Enrichment (all guides)

> **Pass D scope (reference module — consolidated):** **🔧 Code-specifics** (the exact commands/queries each guide invokes), **💰 Fintech lens**, **🎯 Interview / SD angle**, and **✅ Self-check** — across all 16 guides. Lighter than a teaching module (the decision logic *is* the content; this adds the exact commands + the money/interview framing). The source modules (M01–M13) hold the deep theory.
>
> Running domain: payments/wallet, the ledger. Money is `*_minor BIGINT` (integer minor units) or `DECIMAL` — never FLOAT/DOUBLE; reserved word `transaction` → `transaction_`.

---

## 🔧 Code-specifics — the exact commands each guide invokes

**14.2 which index** — `EXPLAIN SELECT …`; `CREATE INDEX idx ON ledger_entry (account_id, created_at);` (=col, then range/sort); verify `key`/access type. `SELECT * FROM sys.schema_unused_indexes;` (drop unused).

**14.3 isolation** — `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;` `SELECT … FOR UPDATE;` or the atomic `UPDATE account SET balance_minor = balance_minor - :amt WHERE account_id=:a AND balance_minor >= :amt;`

**14.4 deadlock** — `SHOW ENGINE INNODB STATUS\G` (LATEST DETECTED DEADLOCK); app retry with backoff; lock the lower `account_id` first; `SELECT … FOR UPDATE SKIP LOCKED` for queues.

**14.5 blocked** — `SELECT * FROM sys.innodb_lock_waits;` (lock-wait); `SHOW PROCESSLIST` / "Waiting for table metadata lock" (MDL); `SET SESSION lock_wait_timeout = 5;` (DDL fails fast).

**14.6 lag** — `SHOW REPLICA STATUS\G` (GTID gap, not just Seconds_Behind_Source); `SET GLOBAL replica_parallel_workers = 8; replica_parallel_type = LOGICAL_CLOCK;` (M10/10.8).

**14.7 slow query** — slow log (`slow_query_log=ON`, `long_query_time=1`) → `pt-query-digest` (rank by total time) → `EXPLAIN ANALYZE`.

**14.8 lost data** — fence/halt; reconcile (`balance_minor <> SUM(amount_minor)`); `mysqlbinlog --stop-datetime='… 14:29:59' | mysql` (PITR); reconcile again; → M15.

**14.9 durability** — `SET GLOBAL innodb_flush_log_at_trx_commit = 1; SET GLOBAL sync_binlog = 1;` (the money 1/1).

**14.10 replication** — `binlog_format=ROW`, `gtid_mode=ON`, `rpl_semi_sync_source_enabled=1`, `SHOW STATUS LIKE 'Rpl_semi_sync_source_status';` (monitor).

**14.11 scale** — `SHOW ENGINE INNODB STATUS` (write pressure → write-bound?); replica lag/read QPS (read-bound?); shard via Vitess.

**14.12 distributed** — idempotency: `INSERT INTO idempotency_key … (UNIQUE)` atomic with the effect; outbox: `INSERT INTO outbox …` in the state txn; CDC via Debezium (ROW + `sync_binlog=1`).

**14.13 anti-patterns** — the fixes are the code-specifics of M01–M13 (e.g., `DECIMAL`/`*_minor BIGINT`, `BINARY(16)`, online DDL via gh-ost, outbox).

**14.14 sizing** — `innodb_buffer_pool_size` ≈ 70-80% RAM; small `max_connections` + ProxySQL.

**14.15 tool-fit** — MySQL for OLTP/ACID; Debezium CDC → warehouse/search/cache (derive, don't run on the ledger).

**14.16 master sheet** — the money settings line: `DECIMAL`/minor-units · `flush_log_at_trx_commit=1`+`sync_binlog=1` · semi-sync+ROW+GTID · idempotency+outbox/CDC+reconciliation.

---

## 💰 Fintech lens (the money-safe use of the guides)

Every triage guide carries the **money-never-lies** check. The flagships: **14.8 (lost data)** — *contain → assess → recover → VERIFY (reconcile)*, the money-incident runbook (the verify step is non-negotiable). **14.9 (durability)** — money = **1/1**, always (a weaker combo silently risks losing transfers). **14.6 (lag)** — while lagging, route money-decision reads to the **primary** (a stale replica balance = double-spend). **14.13 (anti-patterns)** — the ⚠ entries (FLOAT money, stale-replica money read, weak durability, dual-write, no idempotency, untested backup, no reconciliation) are the *money-never-lies violations* checklist. **14.16 (master sheet)** — the "money settings" box is the non-negotiables in one place. These are the runbooks that make the money-safe decisions *fast and correct under pressure*.

---

## 🎯 Interview / system-design angle

**The whole module is interview gold** — these are the questions interviewers actually ask, answered as decision frameworks: *"Walk me through diagnosing replica lag"* → 14.6. *"How do you recover from a bad `DELETE`?"* → 14.8 (contain first!) + PITR (14.8/13.3). *"Which isolation level for money movement, and why?"* → 14.3 (RR + `FOR UPDATE`, no lost update). *"How do you add a column to a billion-row table with no downtime?"* → online DDL (14.13 → 13.6). *"How do you guarantee a payment isn't double-charged?"* → idempotency (14.12 → 12.9). *"When would you NOT use MySQL?"* → 14.15. The skill these demonstrate: **fast, structured, tradeoff-aware decisions** (symptom → diagnosis → fix, with the *why*) — and stating the *generic principle* before the MySQL specifics. The master cheat-sheet (14.16) is the recall sheet for the whole interview.

---

## ✅ Self-check (across the guides)

1. **14.2/14.7:** A "transfer history by account, last 30 days, newest first" query is slow — what index, and how do you confirm it's used?
2. **14.3:** Why does a money transfer need REPEATABLE READ + `FOR UPDATE` (or an atomic conditional `UPDATE`)? What anomaly does it prevent?
3. **14.4/14.5:** A→B and B→A transfers deadlock — the fix? And how do you tell a deadlock from a lock-wait from an MDL stall?
4. **14.6:** Replicas lag — name three causes and the structural fix (parallel apply). Why is lag a *money* problem?
5. **14.8:** What's the *first* step when you suspect data loss, and why? What's the *non-negotiable* last step before declaring recovery?
6. **14.9:** What's the "money" durability combination, and what does each weaker combo risk?
7. **14.11:** Walk the scale decision (up → ? → ? → shard). Why shard last?
8. **14.12:** Match each distributed problem to its pattern (cross-node atomic / retryable / save+notify / propagate / detect-drift).
9. **14.13:** Name the seven money-never-lies anti-patterns and their fixes.
10. **14.16:** Recite the "money settings" (the non-negotiables for not losing money).

---

*Enrichment for all 16 guides complete. **M14 Pass D is fully drafted — M14 is now content-complete across Passes A–D.** This completes the cheat-sheet/decision-guides reference module.*
