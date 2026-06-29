# M04 · How MySQL Executes a Query — Pass A (Skeleton)

> **Pass A goal:** lock the ordered concept list, a one-line mental model per concept, and the planned diagram + worked example per concept. No prose yet — that's Pass B.
>
> **Module mental model:** *A query is a declarative wish — "give me this set" (M01/1.1) — and MySQL is a pipeline that turns that wish into a concrete plan of physical operations against bytes on disk. Between the SQL you type and the rows you get back sits a connection layer, a parser, an optimizer that chooses among many possible plans by estimating cost, an executor that runs the chosen plan, and a pluggable storage engine (InnoDB) that actually reads and writes pages. You can't tune what you can't see: this module is the map of that pipeline, so that indexing (M05) and EXPLAIN (M06) become "influencing decisions the optimizer makes" rather than guesswork.*
>
> **Threads carried in this module:**
> - **Generics-first** — the parse → optimize → execute pipeline and the cost-based optimizer are universal to relational engines; MySQL is one concrete realization. Learn the shape once, it transfers to Postgres, etc.
> - **Tradeoff** — the optimizer *is* a tradeoff machine: it estimates the cost of alternative plans and picks the cheapest by a model. Every later tuning lever (indexes, hints, rewrites) is "change the costs so it picks a better plan."
> - **Durability** — the pluggable storage engine is where the architecture meets disk; InnoDB-vs-MyISAM is fundamentally a durability/transactionality choice, previewing M07–M09.
> - **Money-never-lies** — correctness depends on the engine: only a transactional, crash-safe engine (InnoDB) can guarantee a money write survives; the engine choice is a money-safety decision.
>
> **Prereqs:** M01–M03 (the schema/types the query runs against). **Leads into:** M05 (indexing = giving the optimizer cheap access paths), M06 (EXPLAIN = reading the optimizer's chosen plan), M07–M09 (transactions, locking, InnoDB internals — the engine layer this module introduces).

---

## Concept list (ordered)

| # | Concept | One-line mental model | Diagram | Worked example |
|---|---------|----------------------|---------|----------------|
| 4.1 | **The big picture: query in, rows out** | A query passes through a fixed pipeline — connect → parse → optimize → execute → storage engine — each stage transforming it closer to physical reads. ★ | End-to-end pipeline (the master diagram) | Trace "get account 42's balance" through every stage |
| 4.2 | **The connection layer & a session's lifecycle** | Every client gets a thread/connection with its own session state (variables, transaction, temp tables); connections are a finite, costly resource. | Client → connection/thread pool → session state | A connection storm; why pooling exists; per-session `sql_mode`/`time_zone` (M03) |
| 4.3 | **Authentication, authorization & the grant check** | Before a query runs, MySQL verifies *who you are* and *what you may touch* — identity + privilege, evaluated per statement. | Auth handshake → privilege check → allow/deny | A service user with least-privilege grants blocked from a table it shouldn't read |
| 4.4 | **Parsing & the parse tree** | The parser checks the SQL is grammatically valid and turns text into a structured tree the engine can reason about — syntax errors die here. | SQL text → tokens → parse tree | A typo'd query rejected at parse; what a parse tree of a SELECT looks like |
| 4.5 | **Preprocessing & semantic resolution** | After parsing, MySQL resolves names (do these tables/columns exist? are they ambiguous?) and checks the statement *means* something valid. | Parse tree → name/type resolution → resolved tree | "Unknown column" caught here, not at parse; resolving `account.balance` to a real column |
| 4.6 | **The query optimizer: choosing among plans** | For one SQL statement there are many physical execution plans; the optimizer estimates each plan's cost and picks the cheapest — it's a search over strategies. ★ | Many candidate plans → cost estimate → chosen plan | One join query, three possible plans (which table first, which index), and why one wins |
| 4.7 | **The cost model & statistics** | The optimizer's cost estimate is only as good as its statistics (row counts, cardinality, index selectivity) — it *guesses* using sampled metadata, and stale stats cause bad plans. | Statistics (cardinality/histograms) → cost formula → plan | Stale statistics making the optimizer pick a full scan over an index; `ANALYZE TABLE` |
| 4.8 | **Access paths: how a single table is read** | For each table the optimizer picks an *access method* — full scan, index range scan, index lookup, covering index — the fundamental unit of "how data is fetched." ★ | Access-path ladder (full scan → range → ref → const → covering) | Same `WHERE` answered by full scan vs index range vs covering index (sets up M05/M06) |
| 4.9 | **Join execution strategies** | A multi-table query is executed by a join algorithm — nested-loop (with index), block nested-loop, hash join — and a chosen join *order*; the optimizer picks both. | Nested-loop vs hash join mechanics + join order | Joining `account` → `ledger_entry`: driving table choice and algorithm (deep-dived in M06) |
| 4.10 | **The execution engine: running the plan** | The executor walks the chosen plan tree, pulling rows operator by operator and calling the storage engine for data — the plan becomes actual row movement. | Executor iterating plan operators ↔ storage engine API | Watch the executor drive a join: for each driving row, probe the inner table via the engine |
| 4.11 | **The storage engine API & pluggable engines** | MySQL separates the SQL layer (parse/optimize/execute) from *storage engines* via a handler API — the executor asks an engine to "give me the next row," engine-agnostically. ★ | SQL layer ↕ handler API ↕ {InnoDB, MyISAM, Memory, …} | The same SELECT served by InnoDB vs Memory engine through the identical API |
| 4.12 | **InnoDB vs MyISAM (and why InnoDB)** | The engine choice decides transactionality, crash-safety, locking granularity, and FKs — InnoDB (transactional, row-locking, crash-safe) is the right default; MyISAM is a legacy non-transactional engine. ★ | InnoDB vs MyISAM feature/guarantee comparison | Why a ledger MUST be InnoDB (durability, row locks, FKs); what MyISAM silently lacks |
| 4.13 | **Result handling, buffers & sorting (filesort, temp tables)** | Some operations (sorting, grouping, DISTINCT) can't stream and need a sort buffer or a temporary table — sometimes in memory, sometimes spilled to disk (a performance cliff). | Stream vs buffer/sort/temp-table decision | An `ORDER BY` with no usable index → filesort; a big GROUP BY spilling to an on-disk temp table |
| 4.14 | **Caching layers in the path (and the dead query cache)** | Several caches sit in the path — the buffer pool (data pages), table/dictionary caches, prepared-statement cache — but the old SQL *query cache* is removed in 8.0 (a common misconception). | Caches along the pipeline (buffer pool central) | Why the query cache is gone; how the buffer pool (not a result cache) makes repeats fast (M09) |
| 4.15 | **Reading a plan: from concept to EXPLAIN (bridge to M06)** | Everything above is made visible by `EXPLAIN` — it shows the optimizer's chosen access paths, join order, and estimates; reading it is reading the optimizer's mind. | Pipeline stage → corresponding EXPLAIN column | Map "get account 42's recent entries" to its EXPLAIN row (access type, key, rows) — preview of M06 |
| 4.16 | **Fintech capstone: the lifecycle of a money query** | Trace a real payments query end-to-end through the whole pipeline — and see where correctness (InnoDB) and performance (access paths, plan) are won or lost. ★ | Full annotated pipeline for a ledger query | "Post a transfer + read the new balance": every stage, with the engine/plan choices that keep it correct and fast (sets up M05/M06/M07) |

---

## Diagram inventory for M04 (Pass C targets)

- **Notation standard:** pipeline/flow diagrams for the lifecycle (the module is fundamentally a pipeline); comparison tables for engines (4.12) and access paths (4.8); layered-architecture diagram for the storage-engine API (4.11).
- **Standard:** 4.2, 4.3, 4.4, 4.5, 4.7, 4.9, 4.10, 4.13, 4.14, 4.15.
- **★ Bespoke / capstone visuals:** 4.1 (the master end-to-end pipeline — reused throughout and in M06), 4.6 (candidate-plans → cost → chosen-plan), 4.8 (access-path ladder), 4.11 (SQL-layer ↕ handler-API ↕ engines), 4.12 (InnoDB vs MyISAM comparison), 4.16 (fully-annotated money-query lifecycle).

## Worked-example domain

Single running **payments/wallet** domain (continues M01–M03), now using the *typed* schema from M03/3.17. The recurring trace query is **"get account 42's balance / recent entries"** (a single-table access-path example) and **"post a transfer + read the new balance"** (the capstone, exercising engine choice, plan, and transactionality). The `account`→`ledger_entry` join illustrates join strategies.

## "Go deeper" additions (matching house style)

Beyond a basic "here are the stages" tour, this skeleton deliberately includes the staff-level material: **the cost model & statistics as a first-class concept (4.7)** including stale-stats failures, **access paths as the fundamental read unit (4.8)** that M05/M06 build on, **join strategies (4.9)**, **the storage-engine handler API and pluggability (4.11)** as the architectural key, **InnoDB-vs-MyISAM as a durability/correctness decision (4.12)**, **filesort/temp-table spills (4.13)**, and the **query-cache-is-removed-in-8.0 correction (4.14)** — the things that separate "knows there's an optimizer" from "understands how plan choice and engine choice determine correctness and speed."

## Open questions surfaced during Pass A (not blocking)

1. **Access paths & joins (4.8/4.9):** keep these at *introduction* depth here (name them, show the lifecycle role) and reserve the deep mechanics for M05 (indexing) and M06 (EXPLAIN/join algorithms)? (Proposed: yes — introduce here, deep-dive there, avoid duplication. Cross-references make the hand-off explicit.)
2. **MyISAM coverage (4.12):** treat MyISAM mainly as a *contrast* to explain *why* InnoDB's guarantees matter (not as something to use)? (Proposed: yes — it's legacy; its value here is illuminating InnoDB by comparison.)
3. **Concept count (16).** Comfortable, or merge (e.g., fold 4.4 parsing + 4.5 preprocessing, or 4.14 caching into 4.13)?

## Pass A status: ✅ drafted — awaiting your sign-off before Pass B (core notes).
