# M05 · Indexing Deep Dive ★ — Pass A (Skeleton)

> **Pass A goal:** lock the ordered concept list, a one-line mental model per concept, and the planned diagram + worked example per concept. No prose yet — that's Pass B.
>
> **Module mental model:** *An index is a separate, sorted data structure that lets the engine find rows without scanning every one — it trades write cost and storage for read speed. In M04 you saw the optimizer choose among access paths (4.8); an index is how you give it the* fast *paths. But indexes are not free magic: each one is a B+Tree that must be kept sorted on every insert/update/delete, so the art is choosing the* fewest, best *indexes that serve your real queries (M01/1.14) without drowning your writes. To design indexes well you must understand what they physically are — B+Trees of pages — because that structure explains every rule: why column order matters, why covering indexes are fast, why random keys fragment, why an index sometimes isn't used.*
>
> **Threads carried in this module:**
> - **Tradeoff** — *the* index thread: every index speeds some reads and slows every write (and costs storage + buffer-pool space). Indexing is choosing where to spend.
> - **Generics-first** — B+Trees, sorted access structures, and "touch the least data" access-cost reasoning are universal (the same logic governs any sorted index, anywhere); MySQL/InnoDB is one realization.
> - **Durability** — page splits, write amplification, and fragmentation (how index maintenance hits disk) connect indexing to the write/durability path (preview of M09).
> - **Money-never-lies** — the ledger is the biggest, fastest-growing table; its index design decides whether it stays queryable for years, and a UNIQUE index is also an *integrity* guarantee (idempotency, M16), not just a performance tool.
>
> **Prereqs:** M01 (keys, clustered PK, design-for-queries 1.14), M03 (type size → index size 3.2, id storage 3.12), M04 (access paths 4.8, the optimizer choosing among them 4.6, EXPLAIN 4.15). **Leads into:** M06 (EXPLAIN/optimization — reading and tuning the access paths indexes create), M09 (InnoDB internals — buffer pool, page structure, the physical home of these B+Trees), M16 (indexing the payments platform at scale).

---

## Concept list (ordered)

| # | Concept | One-line mental model | Diagram | Worked example |
|---|---------|----------------------|---------|----------------|
| 5.1 | **What an index is (and the core tradeoff)** | An index is a sorted side-structure mapping key values → row locations, so reads find data without scanning — paid for on every write. | Heap scan vs index lookup; read↑/write↓ seesaw | Finding "account 42's entries" with vs without an index on a billion rows |
| 5.2 | **The B+Tree: the structure behind almost every index** ★ | A balanced tree of pages where all data sits in sorted leaves linked in order — giving O(log n) lookups *and* efficient range scans. ★ custom SVG | ★ B+Tree: root → internal → linked leaf pages | Walk a lookup (`account_id = 42`) and a range (`created_at BETWEEN …`) down the tree |
| 5.3 | **Pages: the unit of index (and table) storage** ★ | Indexes and rows live in fixed 16KB pages; the tree is pages pointing to pages, and "how many keys per page" sets the tree's height/fanout. ★ | ★ 16KB page anatomy (keys, pointers, fill) | Why a compact key (M03/3.2) → more keys/page → shallower tree → fewer I/Os |
| 5.4 | **Clustered index: the table IS its primary-key B+Tree** ★ | In InnoDB the table's rows are stored *inside* the PK's B+Tree leaves — the PK isn't a pointer to the row, it *is* the row's location. ★ | ★ clustered index: leaves contain full rows | PK lookup returns the row directly (no extra hop); why PK choice = physical layout (M01/1.3) |
| 5.5 | **Secondary indexes: pointers back to the clustered index** ★ | A secondary index is a B+Tree whose leaves hold the indexed columns + the PK value — so a lookup finds the PK, then a second hop fetches the row. ★ | ★ secondary index → PK → clustered index (double lookup) | A `(account_id)` secondary lookup → PK → clustered row; why the extra hop matters |
| 5.6 | **Covering indexes: answering from the index alone** ★ | If every column a query needs is *in* the index, the engine answers from the index leaves and skips the second hop entirely — the biggest single read win. ★ | ★ covering index: query satisfied at the leaf, no row fetch | "SELECT amount WHERE account_id=42" covered by `(account_id, amount)` → "Using index" |
| 5.7 | **Composite indexes & the leftmost-prefix rule** ★ | A multi-column index is sorted by column order, so it can serve queries on a *leading prefix* of its columns — but not a non-leading subset. ★ | ★ composite index sort order + which queries it serves | `(account_id, created_at)`: serves account / account+date, but NOT date-alone |
| 5.8 | **Column order in composite indexes (the design decision)** | The order of columns in a composite index is the single highest-leverage index-design choice — equality columns first, then range/sort columns. | Decision flow: equality → range → sort ordering | Ordering `(account_id, created_at)` vs `(created_at, account_id)` for the same query |
| 5.9 | **Selectivity & cardinality: when an index helps** | An index pays off only if it's *selective* — narrows to few rows; a low-cardinality column (few distinct values) may not be worth indexing (the optimizer may skip it). | Selectivity spectrum (high → low) vs scan | Indexing `status` (3 values) vs `account_id` (millions); why the optimizer ignores the former |
| 5.10 | **Index-only ordering & grouping (killing filesort/temp)** | An index already in sorted order can satisfy `ORDER BY`/`GROUP BY` directly, eliminating the filesort/temp-table blocking ops from M04/4.13. | Index order → skip sort step | "account 42's entries newest-first" served in order by `(account_id, created_at)` — no filesort |
| 5.11 | **Prefix indexes (indexing part of a long column)** | For long strings you can index just the first N characters — smaller index, but less selective and can't cover or sort fully. | Prefix index on first N chars + tradeoffs | Indexing the first 12 chars of a long reference string; the selectivity/coverage cost |
| 5.12 | **Functional & expression indexes** | Index the *result of an expression* (a function of columns), so queries filtering on that expression can use an index instead of scanning. | Expression → indexed value flow | Index on `DATE(created_at)` or a JSON-extracted generated column (ties M03/3.11) |
| 5.13 | **Descending & invisible indexes (and other modern options)** | Descending indexes serve `ORDER BY … DESC` efficiently; invisible indexes let you test dropping an index safely; both are modern InnoDB tools. | Ascending vs descending leaf order; invisible toggle | A mixed `ASC, DESC` sort needing a descending index; safely retiring an index via invisible |
| 5.14 | **Other index types: hash, fulltext, spatial, adaptive hash** | Beyond B+Trees: hash indexes (exact-match only), fulltext (text search), spatial (geo), and InnoDB's automatic adaptive hash index — each for a niche. | Index-type → use-case map | When fulltext beats `LIKE`; what the adaptive hash index does automatically |
| 5.15 | **When indexes hurt: write amplification & page splits** ★ | Every index is maintained on every write; random-order inserts cause page splits and fragmentation — too many/poorly-chosen indexes drown writes and bloat storage. ★ | ★ page split on random insert; write fan-out to N indexes | A UUIDv4 PK splitting pages vs a monotonic PK appending; the cost of 8 indexes per insert (M03/3.12) |
| 5.16 | **Index design methodology: choosing the fewest, best indexes** | A repeatable process: enumerate access patterns (M01/1.14), design composite indexes to cover them, verify with EXPLAIN (M06), drop the unused — minimize index count. | Methodology flow: patterns → indexes → verify → prune | Designing the full index set for the `ledger_entry` access patterns |
| 5.17 | **Indexes as integrity: UNIQUE indexes & constraints** | A UNIQUE index is both a fast access path *and* an enforced invariant — the structural home of uniqueness rules (idempotency keys, natural keys). | UNIQUE index = access path + integrity guarantee | The idempotency-key UNIQUE index preventing a double-posted transfer (M01/1.2, M16) |
| 5.18 | **Fintech capstone: indexing the ledger** ★ | The payments schema fully indexed — clustered PK for statement locality, covering indexes for hot reads, UNIQUE for idempotency, minimal write overhead — keeping the ledger fast *and* correct as it grows forever. ★ | ★ fully-indexed money-model (indexes annotated + justified) | End-to-end: every index on account/transaction/ledger_entry, justified by an access pattern (sets up M06/M16) |

---

## Diagram inventory for M05 (Pass C targets)

- **★ Bespoke SVG (the structural visuals this module is built around):** 5.2 (B+Tree), 5.3 (16KB page anatomy), 5.4 (clustered index leaves = rows), 5.5 (secondary→PK→clustered double lookup), 5.6 (covering index), 5.7 (composite sort order + served queries), 5.15 (page split on random insert + write fan-out), 5.18 (fully-indexed money-model). These are the "things Mermaid renders poorly" the project flagged for custom SVG — *Pass C will author them as SVG; Pass A/B describe them.*
- **Standard (Mermaid):** 5.1 (seesaw), 5.8 (column-order decision flow), 5.9 (selectivity spectrum), 5.10 (index-order→skip-sort), 5.11 (prefix tradeoffs), 5.12 (expression→index), 5.13 (asc/desc + invisible), 5.14 (index-type map), 5.16 (methodology flow), 5.17 (UNIQUE = access + integrity).

## Worked-example domain

Single running **payments/wallet** domain (continues M01–M04), using the M03-typed schema. The recurring vehicles: **`ledger_entry`** (the big, growing table — clustered PK `(account_id, created_at, …)`, the statement/range queries from M01/1.14) and the **idempotency-key UNIQUE index** (integrity, M16). Multi-billion-row scale is assumed so the structural consequences (tree height, page splits, covering) are real.

## "Go deeper" additions (matching house style)

Beyond a basic "make an index on the WHERE column" treatment, this skeleton deliberately includes the staff-level material: **the B+Tree/page/clustered/secondary structural chain (5.2–5.5)** as the foundation that explains every rule, **covering indexes (5.6)** and **leftmost-prefix/column-order (5.7–5.8)** as the highest-leverage design levers, **selectivity (5.9)**, **index-only ordering to kill filesort (5.10)**, the **modern index toolbox (5.11–5.14: prefix, functional, descending, invisible, hash/fulltext/spatial, adaptive hash)**, **when indexes HURT (5.15: write amplification + page splits ★)** — the half most treatments omit — **a repeatable design methodology (5.16)**, and **UNIQUE-indexes-as-integrity (5.17)** tying indexing back to correctness.

## Open questions surfaced during Pass A (not blocking)

1. **B+Tree/page/row-format overlap with M09:** keep M05's structural diagrams at the *index-design* level (enough B+Tree/page to justify the rules) and reserve the deep InnoDB page-format/buffer-pool internals for M09? (Proposed: yes — M05 teaches "the structure that explains index rules," M09 teaches "the engine internals"; cross-references make the split clean, minimal duplication.)
2. **Custom SVG authoring (Pass C):** the 8 ★ visuals are genuinely better as hand-authored SVG than Mermaid (B+Tree page layout, splits). Confirm Pass C should produce real `.svg` assets (vs approximating in Mermaid)? (Proposed: author as SVG — this is exactly the project's stated "key custom SVG" case; I'll validate they render.)
3. **Concept count (18).** Comfortable, or merge (e.g., fold 5.8 column-order into 5.7 composite, or 5.13's descending+invisible into one)?

## Pass A status: ✅ drafted — awaiting your sign-off before Pass B (core notes).
