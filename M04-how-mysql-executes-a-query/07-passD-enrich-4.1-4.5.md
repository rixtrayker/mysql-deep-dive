# M04 · Pass D — Enrichment · Concepts 4.1–4.5

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL/config appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-pipeline-frontend.md` (Pass B) and `04-passC-…` (Pass C). Domain: payments/wallet.

---

## 4.1 · The big picture: query in, rows out ★

**🔧 Code-specifics.**
```sql
-- See the optimizer's chosen plan (stage 5 of the pipeline) without running it:
EXPLAIN SELECT balance FROM account WHERE account_id = 42;
-- See the actual execution (runs it, reports real time/rows per operator):
EXPLAIN ANALYZE SELECT balance FROM account WHERE account_id = 42;
-- Confirm the query cache is gone in 8.0 (the variable no longer exists):
SHOW VARIABLES LIKE 'have_query_cache';   -- NO in 8.0 / not present
```

**⚠️ Failure modes & gotchas.**
- **Thinking a repeat is fast due to a "query cache"** — it's gone in 8.0; speed comes from the buffer pool (4.14).
- **Assuming you control the plan** — you influence it (indexes/stats/hints); the optimizer decides (4.6).
- **Tuning blind** — changing things without `EXPLAIN` to see what the pipeline actually does.

**💰 Fintech lens.** Every money query rides this pipeline; correctness is decided at the engine stage (InnoDB) and speed at the optimizer stage — knowing which stage owns what tells you where to look when a ledger query is wrong vs slow.

**🎯 Interview / SD angle.** Be able to name the stages in order: **connection → auth → parse → resolve → optimize → execute → storage engine.** Frame the DB as a "query compiler with a storage runtime." Mention the query cache is removed in 8.0 (common gotcha).

**✅ Self-check.**
1. Name the pipeline stages in order.
2. At which stage is "how to get the data" decided?
3. Why is a repeated query fast in 8.0 if there's no query cache?

---

## 4.2 · The connection layer & a session's lifecycle

**🔧 Code-specifics.**
```sql
SHOW VARIABLES LIKE 'max_connections';       -- the hard cap; exceeding → "Too many connections"
SHOW STATUS LIKE 'Threads_connected';         -- current connections in use
SHOW VARIABLES LIKE 'wait_timeout';           -- idle reaping
-- Session vs global scope (M03): a pooled connection can carry a prior session setting
SET SESSION time_zone = '+00:00';             -- reset on borrow to avoid leakage
-- Pooling lives in the app / a proxy (ProxySQL, M10), not in a single SQL statement.
```

**⚠️ Failure modes & gotchas.**
- **No pooling** → connection storm → `max_connections` exhausted → outage.
- **Session-state leakage across pooled reuse** — leftover `time_zone`/`sql_mode`/open transaction poisons the next borrower.
- **Pool too large** → DB drowns in concurrency (M08 contention); **too small** → requests queue.

**💰 Fintech lens.** High-throughput payment services pool connections (often behind ProxySQL, M10) and **reset session state between borrows** — a leaked time zone silently corrupts `TIMESTAMP` reads (M03/3.9); a leaked open transaction holds locks and stalls others.

**🎯 Interview / SD angle.** Connections are **finite, costly, stateful** → pool them and bound concurrency. Know the leak hazard (state persists across reuse) and the sizing tradeoff. Mention thread-pool vs thread-per-connection for very high connection counts.

**✅ Self-check.**
1. Why pool connections instead of opening one per request?
2. What's the danger of session state under pooling?
3. What goes wrong if the pool is too large?

---

## 4.3 · Authentication, authorization & the grant check

**🔧 Code-specifics.**
```sql
-- Least-privilege service users (the un-bypassable floor):
CREATE USER 'reporting'@'%' IDENTIFIED BY '…' REQUIRE SSL;     -- TLS required
GRANT SELECT ON payments.* TO 'reporting'@'%';                 -- read-only, no writes
CREATE USER 'payments'@'%' IDENTIFIED BY '…' REQUIRE SSL;
GRANT SELECT, INSERT, UPDATE ON payments.ledger_entry TO 'payments'@'%';
-- Roles (8.0) bundle privileges:
CREATE ROLE 'ledger_writer'; GRANT INSERT, SELECT ON payments.ledger_entry TO 'ledger_writer';
SHOW GRANTS FOR 'reporting'@'%';
```

**⚠️ Failure modes & gotchas.**
- **Shared superuser for all services** → no blast-radius limit; a compromised app user can do anything.
- **No TLS** → credentials/data in plaintext on the wire.
- **Authorization checked per-statement** — a valid query still fails if the privilege is missing (and that's the point).

**💰 Fintech lens.** Money systems are high-value targets: **least-privilege service users** (payments writes the ledger; reporting only reads replicas, M10), no shared superuser, TLS required, audit on (M13). The DB grant is the floor beneath app-level authz.

**🎯 Interview / SD angle.** Distinguish **authentication (who) from authorization (what)**; authn once at connect, authz per statement. Least privilege + defense in depth (DB grants + app rules). Mention roles (8.0) and TLS.

**✅ Self-check.**
1. Authentication vs authorization — when is each checked?
2. Why grant least privilege per service?
3. Where does DB-level authz sit relative to app-level authz?

---

## 4.4 · Parsing & the parse tree

**🔧 Code-specifics.**
```sql
-- Syntax error dies at parse (form only):
SELCT balance FROM account;          -- ERROR 1064 (42000): ... near 'SELCT ...'
-- Prepared statements: parse once, execute many; parameters are VALUES, not parseable SQL (anti-injection):
PREPARE s FROM 'SELECT balance FROM account WHERE account_id = ?';
SET @id = 42; EXECUTE s USING @id;   -- ? is data, never code
DEALLOCATE PREPARE s;
-- Reserved word as identifier must be quoted/renamed (why this resource uses transaction_):
-- SELECT * FROM transaction;  -- error; use `transaction` or transaction_
```

**⚠️ Failure modes & gotchas.**
- **Syntax errors** caught here — but a misspelled *column* parses fine (fails at 4.5).
- **SQL injection** when concatenating user input into query text — prepared statements prevent it by parameterizing.
- **Reserved words** as unquoted identifiers → parse error.

**💰 Fintech lens.** Prepared/parameterized statements are mandatory for money endpoints — injection on a payments API is catastrophic; the parser treating parameters as values (not SQL) is the structural defense.

**🎯 Interview / SD angle.** Parsing validates **form, not meaning** (table existence is 4.5). Prepared statements: parse-once perf **and** injection prevention (separate code from data). A clean, high-signal point.

**✅ Self-check.**
1. What error class dies at parsing vs at resolution?
2. How do prepared statements prevent SQL injection?
3. Does the parser know whether a table exists?

---

## 4.5 · Preprocessing & semantic resolution

**🔧 Code-specifics.**
```sql
-- Semantic errors caught here (form was fine):
SELECT blance FROM account;                  -- ERROR 1054: Unknown column 'blance' in 'field list'
SELECT created_at FROM account a JOIN ledger_entry e ON e.account_id=a.account_id;  -- ambiguous → must qualify
-- GROUP BY legality uses functional-dependency reasoning (M02/2.3):
SELECT @@sql_mode;                            -- includes ONLY_FULL_GROUP_BY by default in 8.0
-- Names resolve against the (transactional, InnoDB-stored) data dictionary in 8.0.
```

**⚠️ Failure modes & gotchas.**
- **"Unknown column/table"** and **"ambiguous column"** caught here, not at parse.
- **Disabling `ONLY_FULL_GROUP_BY`** → MySQL returns an *arbitrary* value for non-determined columns (correctness bug).
- **Referencing a dropped/renamed column** fails fast here.

**💰 Fintech lens.** This is where `account.balance` binds to the real typed column (M03/3.17). `ONLY_FULL_GROUP_BY` (FD-based, M02/2.3) prevents aggregate queries from silently returning arbitrary money values — keep it on.

**🎯 Interview / SD angle.** Form (parse) vs meaning (preprocess): resolution binds names to the **data dictionary** (the DB's symbol table) and type/semantic-checks. Note `ONLY_FULL_GROUP_BY` *is* FD reasoning — ties back to M02/2.3.

**✅ Self-check.**
1. Why does a misspelled column fail here, not at parse?
2. What does `ONLY_FULL_GROUP_BY` enforce, and via what concept?
3. What is the "data dictionary" the resolver consults?

---

*Enrichment for 4.1–4.5 complete. Next Pass D file: 4.6–4.9.*
