# M11 · Pass D — Enrichment · Concepts 11.6–11.10

> Pass D scope: **#7 Code-specifics · #9 Failure modes · #10 Fintech lens · #11 Interview/SD angle · Self-check.** Pairs with `02-shard-key-schemes-colocation.md` + `05-passC-…`. Domain: payments/wallet, the ledger.

---

## 11.6 · The shard key: the most important decision ★

**🔧 Code-specifics.**
```sql
-- Vitess: the shard key is the VINDEX (shard-key → shard mapping), defined in the VSchema:
--   "sharded": true,
--   "tables": { "ledger_entry": { "column_vindexes":
--       [ { "column": "tenant_id", "name": "hash" } ] } }    -- ← the shard key + scheme
-- secondary vindex lets a 2nd column route instead of scatter (11.10)
-- app-level: shard = consistent_hash(tenant_id);  connect(shard)
```

**⚠️ Failure modes & gotchas.**
- **Sharding by `transaction_id`** (or any key co-locating nothing) → every balance/account read scatters (11.10) — almost always wrong.
- **A skewed/low-cardinality key** (`country`, a whale `merchant_id`) → a **hotspot shard** (M08's hot row → hot shard).
- **Choosing the key from the data model, not the access pattern** → cross-shard everything.
- **Treating the key as changeable** — it isn't (11.14, re-distributes every row).

**💰 Fintech lens.** Shard by `tenant_id`/`ledger_group` so a transfer's two legs co-locate (single-shard ACID, 11.9); handle whales via a directory/dedicated shard (11.7). The key is the decision the whole platform (M16) is built on.

**🎯 Interview / SD angle.** "The shard key governs co-location, routing, even-load, and cardinality at once — it's the dominant, near-permanent design decision, chosen from the WORKLOAD (what's transacted/queried together), not the data. Get it right; it's the hardest thing to change." Universal.

**✅ Self-check.**
1. Name the four properties the shard key governs.
2. Why is it chosen from the access pattern, not the data model?
3. Why account_id vs customer_id vs transaction_id for payments?

---

## 11.7 · Sharding schemes: range, hash, directory ★

**🔧 Code-specifics.**
```sql
-- Vitess vindex types map the key → shard:
--   "hash"        → even spread (skew-proof), no range routing      [the common choice]
--   "numeric"/range via keyspace ranges → range routing, but hotspots on sequential keys
--   "lookup" vindex → directory (a backing table maps key → keyspace id) — flexible, indirection
-- production pattern: HASH the key → keyspace id → RANGE-partition the keyspace (even + reshardable)
```

**⚠️ Failure modes & gotchas.**
- **Range on a monotonic key** (sequential account/txn IDs) → newest shard hotspot.
- **Hash** → range queries can't route (scatter) + naive `mod N` reshards badly (11.8).
- **Directory** → the lookup is a latency hop + a critical SPOF (must be HA/cached).

**💰 Fintech lens.** Hash the shard key for even load (no hot newest-account shard) — then *deliberately* co-locate a transfer's two legs (11.9), since hashing scatters them. A lookup/dedicated shard isolates whale tenants.

**🎯 Interview / SD angle.** "Range (order-locality, but hotspots) vs hash (even spread, no range queries) vs directory (flexible, indirection) — the same order-vs-spread tradeoff as the partition function. Most systems hash-then-range-the-hash-space (Vitess)." Universal.

**✅ Self-check.**
1. Why does range-by-monotonic-key hotspot?
2. What does hashing buy and destroy?
3. Why hash-then-range-the-hash-space?

---

## 11.8 · Consistent hashing & minimizing reshuffle ★

**🔧 Code-specifics.**
```sql
-- naive: shard = hash(key) mod N        ← changing N remaps ~(N-1)/N of keys (DON'T)
-- consistent hashing: key & shards on a ring; key → next shard clockwise; +shard moves only its arc
-- Vitess equivalent: hash vindex → keyspace id; RESHARD splits a keyspace RANGE
--   (moves only that range's rows — bounded, like the ring's ~1/N)
```

**⚠️ Failure modes & gotchas.**
- **`hash(key) mod N` sharding** → adding a shard remaps ~all keys → resharding ≈ impossible → frozen at the initial shard count.
- **No virtual nodes** → uneven arcs (some shards overloaded).
- **Changing the shard *key*** (not just count) → no consistent-hashing shortcut applies; full re-distribution.

**💰 Fintech lens.** Shard the ledger via a **ring (vnodes) or Vitess keyspace**, *not* `mod N`, so growing 8→16 shards moves only ~1/N of accounts (a routine reshard, 11.14) instead of re-homing every account.

**🎯 Interview / SD angle.** "`mod N` couples every key to N (change N → move everything); a ring/keyspace couples each key to its local region (change membership → move only ~1/N). Vnodes give even load + gentle rebalancing. Cassandra/Dynamo rings; Vitess range-splits." Foundational.

**✅ Self-check.**
1. Why does `mod N` move ~all keys when N changes?
2. How does the ring move only ~1/N?
3. What do virtual nodes add?

---

## 11.9 · Co-location: keeping related data together ★

**🔧 Code-specifics.**
```sql
-- co-locate: same shard key → same shard. shard by tenant_id so a transfer is single-shard:
BEGIN;
  UPDATE account SET balance_minor = balance_minor - 100 WHERE account_id = :A;  -- debit (minor units)
  UPDATE account SET balance_minor = balance_minor + 100 WHERE account_id = :B;  -- credit
  INSERT INTO ledger_entry (…) VALUES (…), (…);                                  -- double-entry
COMMIT;   -- ONE single-shard ACID txn (both accounts on this shard)
-- Vitess: same keyspace id → same shard; reference tables (currencies) replicated to ALL shards
```
> Money is `*_minor BIGINT` (integer minor units) — never FLOAT/DOUBLE.

**⚠️ Failure modes & gotchas.**
- **Naive per-account hashing** → a transfer's legs land on different shards → cross-shard (11.11) → crash between legs loses/duplicates money.
- **Co-locating key (`tenant_id`) vs even load** → whale-tenant hotspots (mitigate: directory/dedicated shard).
- **Forgetting reference tables** → single-shard txns do cross-shard reads for currencies/types.

**💰 Fintech lens (★).** *The* fintech sharding rule: keep a transfer's debit+credit on **one shard** → the double-entry write stays a single-node ACID transaction (the debit=credit invariant preserved at scale, M07/7.16). Cross-shard transfers use the clearing-account pattern + Saga (M12).

**🎯 Interview / SD angle.** "Partition along the TRANSACTION boundary — co-locate data touched together so the common operation stays single-partition (ACID, fast); cross-partition is a costlier mode you minimize. Keep an invariant's data on one node so the invariant stays a single-node transaction." The deepest distributed-data principle.

**✅ Self-check.**
1. Why must a transfer's two legs co-locate?
2. The co-location vs even-load tension, and a fix?
3. How do you handle a genuinely cross-shard transfer?

---

## 11.10 · Cross-shard queries & scatter-gather

**🔧 Code-specifics.**
```sql
SELECT … WHERE tenant_id = ?;          -- keyed → ONE shard (fast)
SELECT SUM(amount_minor) WHERE amount_minor > 1000000;  -- no shard key → SCATTER to all + merge
-- fixes: secondary vindex (route a 2nd column) · push cross-cutting reads to a reporting replica/warehouse
-- ⚠ deep pagination across shards: LIMIT … OFFSET 10000 → every shard ships a 10k prefix (brutal)
```

**⚠️ Failure modes & gotchas.**
- **Non-shard-key queries** scatter to *all* shards → latency = slowest shard, load = every shard pays.
- **Deep `LIMIT/OFFSET`** and **cross-shard joins** — especially expensive; design them out.
- **`COUNT(DISTINCT)`/median** don't combine trivially from partials.

**💰 Fintech lens.** "All of a customer's accounts" is single-shard if sharded by `customer_id`, scatter-gather if by `account_id` — the key decides (11.6). Global reports / "all txns over $X" / platform reconciliation → a **replica-fed warehouse** (M02/2.17, M13), *not* scatter-gather on the live money path.

**🎯 Interview / SD angle.** "A sharded system is a COLLECTION of single-shard databases — aligned queries are cheap, cross-cutting ones fan-out-expensive. Route via a secondary index, or serve from a denormalized/replicated read model. Aggregations/sorts/joins/pagination across shards are distributed-query problems." Universal.

**✅ Self-check.**
1. What makes a query scatter-gather, and why doesn't it scale?
2. Three ways to avoid scattering?
3. Where do global reports belong, and why?

---

*Enrichment for 11.6–11.10 complete. Next Pass D file: 11.11–11.16.*
