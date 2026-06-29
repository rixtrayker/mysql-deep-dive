# M16 · Pass B — Challenges 16.1–16.5 · The Frame, The Ledger, Idempotency, Money Movement & Consistency

> **Pass B scope (adapted for the synthesis capstone):** for each challenge — **the problem · the invariants · the design (composing M01–M15) · the tradeoffs · the money-never-lies guarantee.** No new theory — this *composes* the prior modules into a real design. Diagrams + design walkthroughs are Passes C/D.
>
> Running domain: payments/wallet, the ledger — *now the system being designed*. The organizing question: *how does this stay money-never-lies (never lost or duplicated, always provable)?*

---

## 16.1 · The fintech design frame ★

**The problem.** How do you *approach* designing a fintech platform (in production, or in an interview) so you don't miss something that loses money? Money systems have unforgiving requirements (a lost or duplicated transfer is a real loss + a trust/regulatory failure), so the *design method* matters — you need a structured frame that ensures correctness *first*, then scale/operability/survivability.

**The invariants (start here — always).** Every fintech design starts from the **money-never-lies invariants**: (1) **money is conserved** (Σ debits = Σ credits — double-entry, 16.2); (2) **no money is lost or duplicated** (atomic + idempotent operations, 16.3/16.4); (3) **every change is provable/auditable** (immutable history, 16.8); (4) **the truth is always recoverable** (reconciliation + DR, 16.7/16.11). *Derive the design from the invariants* — not the other way around.

**The design (the frame — composing M01–M15).** Layer the design in order:
1. **Model the ledger** (16.2 — the immutable double-entry source of truth): M01 (modeling), M02 (normalization — the ledger normalized, balances derived), M03 (money types — minor units/DECIMAL).
2. **Make money movement correct** (16.3/16.4): M07 (ACID transfers), M08 (locking — concurrency-correct), M11/11.9 (co-locate so transfers are single-shard ACID), M12/12.9 (idempotency).
3. **Choose consistency per operation** (16.5): M10 (read routing), M12/12.15 (strong for money decisions, eventual for reporting).
4. **Scale it** (16.10): M10 (replicas), M11 (sharding), M02/2.17 (analytics offload).
5. **Make it operable** (M13): backups/PITR, monitoring, online DDL, security.
6. **Make it survivable** (16.11): M15 (the prevention checklist), M10 (semi-sync/failover), M13 (tested recovery).
7. **Integrate reliably** (16.12): M12 (outbox/CDC), and **reconcile** (16.7 — the backstop, M12/12.14).
Each layer *composes* specific prior modules; the frame ensures you build correctness *before* scale, and survivability *throughout*.

**The tradeoffs.** The frame *is* applied tradeoff-thinking: correctness vs performance (atomic single-shard vs distributed Saga, 16.4), consistency vs latency (strong vs eventual per operation, 16.5), simplicity vs scale (shard or not, 16.10), and the cost of survivability (DR, 16.11). The frame's discipline: *don't trade away a money-never-lies invariant for performance* — bulletproof the money path, optimize elsewhere.

**The money-never-lies guarantee.** The frame *guarantees* money-never-lies by *deriving the design from the invariants* — every layer is built to preserve "money is conserved, never lost/duplicated, always provable, always recoverable." This is the meta-design that the rest of the module fills in. The ★ SVG (Pass C) draws the frame.

---

## 16.2 · The Ledger: double-entry, immutability, debit=credit ★

**The problem.** Every money system needs a *correct, auditable record* of all money movement — one that *can't* silently lose or duplicate money, that *proves* every balance, and that survives forever for audit. The naive approach (a mutable `balance` column updated in place) is *wrong*: it has no history (no audit), is prone to lost updates (M15/15.9), and can't prove correctness. The right answer is the **immutable double-entry ledger** — the heart of every fintech platform.

**The invariants.** **(1) Double-entry**: every transaction is *balanced* — Σ debits = Σ credits (money moves *from* one account *to* another; it's never created or destroyed). **(2) Immutability**: ledger entries are *append-only* — never updated or deleted (corrections are *new* compensating entries, M01/1.17) — so the history is a permanent, tamper-evident audit trail. **(3) Derived balances**: an account's balance is *derived* from its entries (balance = Σ its entry amounts) — the *entries* are the source of truth; the balance is a (cacheable) projection (M02/2.17).

**The design (composing M01–M03).** Model (M01): **accounts** (parties' money locations) and an **immutable `ledger_entry` table** (append-only — each entry: account, amount in minor units, the transaction it belongs to, timestamp). Every **transaction** writes *balanced* entries (a transfer of $100 from A to B = a −$100 entry on A *and* a +$100 entry on B, in one atomic transaction, M07 — Σ = 0, double-entry holds). **Balances** are *derived* (M02/2.17): balance = Σ the account's entries — kept as a *cached/denormalized* `balance` column (updated atomically *with* the entries, M07) for fast reads, *and* re-derivable from the entries for **reconciliation** (16.7 — the cached balance must always = Σ entries). Money is **minor units / DECIMAL** (M03 — never FLOAT). The ledger is **partitioned by time** for retention (M13/13.2) and **immutable** (no `UPDATE`/`DELETE` — enforced by privilege, M13/13.14, and convention).

**The tradeoffs.** The ledger trades *write volume + derived-balance complexity* for *auditability + provable correctness + no-lost-money*: append-only means more rows (vs in-place updates) and the balance is derived (must be kept in sync), but you get a permanent audit trail, re-derivable balances (reconciliation), and no lost-update risk on the entries (they're immutable). The cached-balance-vs-derived tradeoff (M02/2.17): the cache is fast but must be reconciled against the entries (the truth). The immutable-ledger pattern is *non-negotiable* for money — the alternative (mutable balances, no history) fails audit and correctness.

**The money-never-lies guarantee.** The ledger *is* money-never-lies made structural: double-entry guarantees money is *conserved* (Σ = 0); immutability guarantees every movement is *provable* (the audit trail); derived balances guarantee *re-derivability* (reconciliation can always recompute the truth from the immutable entries, M12/12.14 — so any drift in the cached balance is *detectable and repairable*). It's the foundation every other challenge builds on. The ★ SVG (Pass C) draws the double-entry ledger (entries, the debit=credit invariant, derived balances).

---

## 16.3 · Idempotency & exactly-once ★

**The problem.** Payment requests *will* be retried (network timeouts, client retries, at-least-once delivery, M12/12.13) — and without protection, a retry *double-charges* (the same payment processed twice). A money API *must* be safely retryable so a payment happens **exactly once in effect**, no matter how many times it's submitted. This is *the* load-bearing primitive of money systems (M12/12.9).

**The invariants.** **(1) Exactly-once effect**: a payment, however many times its request is delivered, moves money *exactly once*. **(2) Safe retry**: the client *can* retry (after a timeout/uncertainty) *without* risking a double-charge. **(3) Same result on retry**: a retry returns the *original* result (not an error, not a re-execution).

**The design (composing M12/12.9).** Every money operation carries a client-supplied **idempotency key** (a unique ID per *logical* payment — reused across retries of the *same* payment, M12/12.9). The server, on each request: **(1)** in the *same atomic transaction* as the money movement (M07), `INSERT` the idempotency key into an `idempotency_key` table with a **unique constraint** (M03/M05); **(2)** if the insert *succeeds* (key is new) → process the payment (the atomic debit+credit+ledger-entries, 16.2/16.4), record the result, return it; **(3)** if the insert *fails* the unique constraint (key seen → a retry) → *don't re-process* → return the *recorded* result. The atomicity (key-insert + money-movement in one transaction, M07) is critical — a crash between them can't double-apply. The database *enforces* dedup atomically (the unique index). This makes the payment **exactly-once in effect** despite at-least-once delivery (M12/12.13).

**The tradeoffs.** Idempotency costs an `idempotency_key` table + the dedup check per request + key retention — *trivial* vs the bug it prevents (double-charging). There's no real alternative (exactly-once *delivery* is impossible, M12/12.13 — you *must* do at-least-once + idempotency). The design choices are about *implementation* (a dedicated key table vs a unique constraint on a natural key vs inherently-idempotent conditional updates), *key scope* (per logical payment), and *retention* (keep keys long enough to cover all retries). For money, idempotency is *non-negotiable* on every retryable money operation.

**The money-never-lies guarantee.** Idempotency *guarantees no double-charge* — the single most important money-never-lies protection at the request level. Combined with the atomic ledger (16.2) and reconciliation (16.7), it ensures every payment moves money *exactly once*, provably. It threads through *every* money operation in the platform (transfers, Saga steps M12/12.8, CDC consumers M12/12.13). The ★ SVG (Pass C) draws idempotency for money (key → first applies / retry returns prior result).

---

## 16.4 · Money movement: atomic transfers, holds, two-phase capture ★

**The problem.** Money moves in more than one way, and each needs correct modeling. A **transfer** is a simple atomic debit+credit. But a **card payment** (and many flows) is *two-phase*: an **authorization** *reserves* funds (a **hold** — "this $100 is committed but not yet moved") and a later **capture** *settles* it (actually moves the money) — with the hold possibly *expiring* or being *released*. Modeling *pending vs settled* money correctly (holds, partial captures, expirations) is essential — get it wrong and you double-spend held funds or lose track of pending money.

**The invariants.** **(1) Atomic transfer**: a debit+credit is all-or-nothing (M07 — both legs or neither). **(2) Holds reserve funds**: a hold makes funds *unavailable* (can't be double-spent) *without* moving them yet — so the *available* balance = settled balance − active holds. **(3) Two-phase correctness**: authorize (hold) → capture (settle) or release (free the hold) — every hold is eventually captured or released (no leaked holds). **(4) Idempotent + atomic** throughout (16.3, M07).

**The design (composing M07/M08/M11/M12).**
- **Atomic transfer** (the simple case): one transaction (M07) — debit A, credit B, write balanced ledger entries (16.2), update cached balances atomically — co-located on one shard (M11/11.9) so it's single-shard ACID; idempotent (16.3); concurrency-correct (M08 — atomic conditional `UPDATE` or `FOR UPDATE`, no lost update, M15/15.9).
- **Auth-hold-capture** (two-phase): **authorize** = create a **hold** record (reserve funds — the *available* balance drops, but no ledger entry yet — the money hasn't *moved*) in one atomic transaction; **capture** = convert the hold to a *settled* transfer (write the balanced ledger entries, M07, releasing the hold) — possibly a *partial* capture (capture less than held, release the rest) or *multiple* captures; **release/expire** = free an uncaptured hold (the funds become available again). Holds have *expirations* (an uncaptured hold auto-releases after N days). Each step is atomic + idempotent. The *available balance* = settled balance − Σ active holds (computed/maintained carefully).
- **Cross-shard money movement** (when accounts span shards): a **Saga** (M12/12.8) over local transactions + clearing accounts (M11/11.9) — never fragile 2PC.

**The tradeoffs.** Atomic single-shard transfers (the common case, co-located, M11/11.9) are *simple and correct* (full ACID). Two-phase (holds) adds *complexity* (the pending state, expirations, partial captures) but is *required* for card/auth flows (you must reserve before you settle). Cross-shard transfers trade atomicity for scale (Saga, eventually consistent + reconciled, M12). The design minimizes complexity: most movements are *atomic single-shard transfers*; holds are used where the *business* needs two-phase; cross-shard is the rare minority. The available-vs-settled-balance distinction is the key correctness subtlety (don't let held funds be double-spent).

**The money-never-lies guarantee.** Atomic transfers guarantee *no money lost/duplicated* in a movement (M07 — both legs or neither). Holds guarantee *reserved funds aren't double-spent* (available balance accounts for holds). Two-phase capture guarantees *pending money is tracked* (every hold captured or released, no leaks). Idempotency (16.3) guarantees *no double-movement on retry*. Together: every money movement — simple or two-phase, single- or cross-shard — moves money *exactly once, atomically, provably*. The ★ SVG (Pass C) draws transfer (atomic) + auth-hold-capture (two-phase).

---

## 16.5 · Consistency for money: what to read where

**The problem.** In a replicated/sharded platform (M10/M11), reads can hit the primary (strong, current) or a replica (eventual, possibly stale, M10/10.5) — and *reading the wrong consistency for a money decision loses money* (authorizing against a stale balance → double-spend/overdraft, M15/15.9). You must route *each* read to its *correct* consistency level — strong where money depends on it, eventual where staleness is harmless.

**The invariants.** **(1) Money decisions read strong**: any read that *decides* whether to move money (a balance-for-authorization) must see the *latest* committed state (strong consistency — the primary) — *never* stale. **(2) Users see their own writes**: a user reading their *own* balance/history after a payment must see it (read-your-writes, M10/10.6). **(3) Reporting tolerates staleness**: reports/dashboards/analytics can read eventual (replicas — staleness harmless).

**The design (composing M10/M12).** Classify *each* read by cost-of-being-stale (M12/12.15):
- **Balance-for-authorization / money decision** → read the **primary** (strong, M12/12.4) — never authorize against a stale balance.
- **A user's own balance/history after their write** → **read-your-writes** (M10/10.6 — route to the primary or a GTID-caught-up replica via `WAIT_FOR_EXECUTED_GTID_SET`).
- **Reporting / dashboards / reconciliation / analytics** → **async replicas / the warehouse** (eventual, M10/10.5, M02/2.17 — fast, offloads the primary, staleness harmless).
Routing is done by the app or a proxy (ProxySQL/Vitess, M11/11.13). The platform is *heterogeneous* in consistency — strong on the money path, eventual elsewhere (M12/12.15).

**The tradeoffs.** Strong reads (primary) are *correct but don't scale reads* (they load the primary); eventual reads (replicas) *scale but can be stale*. The per-operation choice (M12/12.15) gets *both* — correctness where it matters (the money path, on the primary) and read-scaling where it doesn't (reporting, on replicas). The alternative (one global level) fails: all-strong doesn't scale reads; all-eventual loses money on the authorization path. The design *classifies* each read and routes accordingly.

**The money-never-lies guarantee.** Routing money decisions to *strong* reads (the primary) guarantees *no decision against stale data* — preventing the stale-read double-spend (M15/15.9). Read-your-writes prevents the user-confusion double-submit (M10/10.6). Eventual-for-reporting offloads safely. Together: money is *never* lost/duplicated by reading the wrong consistency. The Pass C Mermaid draws the per-operation consistency map.

---

*Challenges 16.1–16.5 — Pass B complete. Next: 16.6–16.11 (hot-account, reconciliation, audit, multi-currency, scaling, DR).*
