# M03 · Pass D — Enrichment · Concepts 3.1–3.6

> **Pass D scope:** content-contract items **#7 Code-specifics** (the only place real SQL appears), **#9 Failure modes & gotchas**, **#10 Fintech lens**, **#11 Interview / system-design angle**, plus **Self-check**. Pairs with `01-type-basics-footprint-integers-money.md` (Pass B) and `04-passC-…` (Pass C). Domain: payments/wallet.

---

## 3.1 · What a data type really is

**🔧 Code-specifics.**
```sql
-- The same value behaves differently per type (domain/ops/encoding/sort all change):
SELECT '1000.00' < '99.00';        -- 1 (TRUE!) lexicographic string compare — wrong for money
SELECT 1000.00  < 99.00;           -- 0 (FALSE) numeric compare — correct
-- Strict mode rejects bad coercion instead of silently truncating:
SET SESSION sql_mode = 'STRICT_ALL_TABLES';
-- INSERT ... amount = '10abc'  → ERROR in strict mode (would coerce to 10 in loose mode)
-- Note: INT(11) display width is deprecated and NOT a range limit — ignore it.
```

**⚠️ Failure modes & gotchas.**
- **Stringly-typed data** — numbers/dates stored as text → lexicographic sort, no range scan, no validation.
- **Implicit coercion** in loose mode (`'10abc' = 10` can be true) → silent wrong results.
- **Trusting `INT(11)`** as a range/size setting — it's only a display hint (deprecated).

**💰 Fintech lens.** A money value in the wrong type (string/float) fails silently — wrong sort order on amounts, broken equality in reconciliation. Type correctness is the first layer of money-never-lies.

**🎯 Interview / SD angle.** Define a type as **values + operations + encoding + sort order** (not just "kind of data"). Mention that MySQL historically favored coerce-over-reject, so **strict mode is mandatory**. High-signal: knowing `INT(11)` is display-width, not range.

**✅ Self-check.**
1. What four things does a type fix at once?
2. Why does `'1000.00' < '99.00'` return TRUE as strings?
3. What does strict mode change about bad input?

---

## 3.2 · Storage footprint → performance (the core link) ★

**🔧 Code-specifics.**
```sql
-- Inspect real row/table footprint and buffer-pool pressure:
SELECT table_name, data_length, index_length,
       ROUND((data_length+index_length)/1024/1024) AS mb
FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY mb DESC;
-- InnoDB page size (rows-per-page = ~page_size / row_size):
SELECT @@innodb_page_size;            -- 16384 (16KB) by default
-- Smaller types → more rows/page → more fits in the buffer pool:
SELECT @@innodb_buffer_pool_size;
```

**⚠️ Failure modes & gotchas.**
- **Oversized types everywhere** (BIGINT for tiny ranges, CHAR(36) ids, DOUBLE) → fewer rows/page → working set spills the buffer pool → disk IO.
- **Forgetting the PK is embedded in every secondary index** (M01/1.3) → a fat PK bloats *all* indexes.
- **Fat cold columns in the hot row** → wasted page space (fix: off-page/vertical partition, 3.14/M02).

**💰 Fintech lens.** The ledger is the biggest, hottest table; oversized types there multiply across billions of rows and every index — the difference between the working set living in RAM (fast) or thrashing disk (slow).

**🎯 Interview / SD angle.** This is the **why** behind "smallest type that safely fits": bytes/row → rows/16KB-page → buffer-pool fit → IO. Connect type choice to cache behavior — strong mechanical-sympathy signal that bridges to M05/M09.

**✅ Self-check.**
1. Why does a 2× fatter row roughly double IO for a scan?
2. How does the buffer pool turn row size into latency?
3. Why does PK width affect *every* index?

---

## 3.3 · Integer types & signedness

**🔧 Code-specifics.**
```sql
-- Right-size by range; BIGINT UNSIGNED for unbounded-growth PKs (overflow safety):
CREATE TABLE transaction_ (
  transaction_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,   -- ~18 quintillion ceiling
  status_code    TINYINT UNSIGNED NOT NULL,                 -- small bounded set → 1 byte
  PRIMARY KEY (transaction_id)
) ENGINE=InnoDB;
-- Watch headroom on existing auto-increment PKs:
SELECT auto_increment FROM information_schema.tables
WHERE table_schema=DATABASE() AND table_name='transaction_';   -- how close to the ceiling?
-- ⚠ mixing signed/unsigned in comparisons triggers coercion surprises.
```

**⚠️ Failure modes & gotchas.**
- **INT PK overflow** (~2.1B/4.2B) → inserts fail; the fix is a COPY migration (3.15) — a production emergency.
- **Silent clamping in loose mode** — over-range value stored as the max (strict mode errors instead).
- **Signed/unsigned comparison hazards** and the deprecated **display-width** confusion (`INT(11)`).

**💰 Fintech lens.** A `transaction_id` or `entry_id` that wraps halts all payments. BIGINT UNSIGNED from day one is cheap insurance on the ledger's PK — 4 extra bytes vs an outage + table rebuild.

**🎯 Interview / SD angle.** "What integer type for an auto-inc PK?" → **BIGINT UNSIGNED**, and explain *why* (INT ceiling reachable, widening is a brutal COPY migration). Right-size *down* for bounded columns (TINYINT codes). Note UNSIGNED is a MySQL-ism (portability cost).

**✅ Self-check.**
1. Why BIGINT (not INT) for a high-volume auto-inc PK?
2. What does UNSIGNED buy and what hazard does it add?
3. What happens on integer overflow in strict vs loose mode?

---

## 3.4 · DECIMAL vs FLOAT/DOUBLE — exactness vs approximation ★

**🔧 Code-specifics.**
```sql
-- The canonical demonstration of float lossiness:
SELECT 0.1 + 0.2;                          -- 0.30000000000000004 (DOUBLE) — not 0.3
SELECT CAST(0.1 AS DECIMAL(10,2)) + CAST(0.2 AS DECIMAL(10,2));   -- 0.30 exact
-- Money column: exact fixed-point, never FLOAT/DOUBLE:
CREATE TABLE ledger_entry (
  amount DECIMAL(18,2) NOT NULL          -- 16 integer digits, 2 decimals; exact
) ENGINE=InnoDB;
-- Float equality is unreliable even for reads:
-- WHERE amount = 0.3   may NOT match a DOUBLE-stored 0.3
```

**⚠️ Failure modes & gotchas.**
- **FLOAT/DOUBLE for money** → accumulating rounding error → balances drift, reconciliation breaks.
- **Float equality** (`WHERE x = 0.3`) silently fails to match stored approximations.
- **Non-strict mode silently rounds** an over-scale DECIMAL insert (strict mode errors).

**💰 Fintech lens.** This is *the* money-never-lies rule. Float drift produces audit discrepancies with no single wrong row; `SUM` and equality become unreliable. **Money is DECIMAL or integer minor units, never FLOAT.**

**🎯 Interview / SD angle.** Recite the `0.1 + 0.2` problem and *why* (binary can't represent decimal fractions; IEEE-754 is universal). This is one of the most reliably-tested fintech facts — a wrong answer is disqualifying. Pivot to "the real choice is DECIMAL vs integer minor units, both exact" (3.5).

**✅ Self-check.**
1. Why can't binary floating point represent 0.1 exactly?
2. Why is float equality unreliable even on reads?
3. What are the two *correct* money representations?

---

## 3.5 · Representing money: DECIMAL vs integer minor units ★

**🔧 Code-specifics.**
```sql
-- Option A — DECIMAL (readable, scale in the type; good for fiat ledgers):
amount DECIMAL(18,2) NOT NULL          -- $100.00 stored as 100.00
-- Option B — integer minor units (fastest exact math; ideal for crypto/high precision):
amount_minor BIGINT NOT NULL,          -- $100.00 stored as 10000 (cents)
currency     CHAR(3) NOT NULL          -- MANDATORY: minor units are meaningless without exponent
-- Both exact. Be consistent per currency; store currency alongside either way.
-- 18-decimal crypto (wei) can overflow BIGINT → DECIMAL(65,0) or binary/string representation.
```

**⚠️ Failure modes & gotchas.**
- **Minor units without a stored currency/exponent** → the same `10000` read as USD vs JPY = 100× error.
- **Mixing DECIMAL and minor-units** for the same currency across the schema → conversion bugs.
- **BIGINT overflow for 18-decimal crypto** — needs wider representation.

**💰 Fintech lens.** Both are valid exact encodings; the *exponent must always be known*. DECIMAL self-documents scale (gentler for mixed fiat); integer minor units are idiomatic for crypto and fastest for high-throughput arithmetic.

**🎯 Interview / SD angle.** Don't frame it as "FLOAT vs DECIMAL" — frame the real choice as **DECIMAL vs integer minor units, both exact**, with a decision guide (DECIMAL for fiat readability, minor units for crypto/precision/throughput). Mention storing currency alongside and the wei-overflow edge.

**✅ Self-check.**
1. What must accompany an integer-minor-units amount, and why?
2. When would you prefer minor units over DECIMAL?
3. What breaks if minor-unit amounts mix exponents silently?

---

## 3.6 · Currency, scale & rounding

**🔧 Code-specifics.**
```sql
-- Scale must fit the FINEST currency you support; round per currency exponent:
amount DECIMAL(18,8) NOT NULL          -- 8 places covers BTC; fiat uses fewer
currency CHAR(3) NOT NULL              -- exponent per ISO 4217 (USD=2, JPY=0, BHD=3, BTC=8)
-- MySQL ROUND() is HALF-UP by default; no native banker's rounding:
SELECT ROUND(3.335, 2);                -- 3.34 (half-up) — finance often wants half-EVEN
-- Banker's rounding (half-to-even) → implement in app logic; conserve the residual:
-- split $10.00 / 3 → 3.34, 3.33, 3.33 (largest-remainder so parts sum to 10.00)
```

**⚠️ Failure modes & gotchas.**
- **Single scale-2 column for JPY (0) and BHD (3)** → fractional yen or lost precision.
- **Implicit rounding in intermediate steps** → totals that don't reconcile (sum of rounded ≠ rounded sum).
- **MySQL `ROUND()` half-up bias** over many ops; **no native banker's rounding**.

**💰 Fintech lens.** Scale and rounding are schema-and-policy decisions; wrong choices create fractional-unit violations or penny drift that surfaces in reconciliation (M02/2.17). Conserve the residual (largest-remainder) so splits sum back to the whole.

**🎯 Interview / SD angle.** Know currency exponents vary (USD=2, JPY=0, BHD=3, crypto=8–18) and that **rounding mode + rounding points must be explicit**; banker's rounding minimizes cumulative bias. Note MySQL lacks native half-even — implement in app. Strong domain-depth signal.

**✅ Self-check.**
1. Why can't one fixed scale serve JPY, USD, and BTC correctly?
2. Why is banker's rounding preferred in finance?
3. What does MySQL's default `ROUND()` do, and what's missing?

---

*Enrichment for 3.1–3.6 complete. Next Pass D file: 3.7–3.11.*
