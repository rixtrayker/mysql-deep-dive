# M15 · Pass B — Scenarios 15.12–15.16 · OOM, HLL Bloat, SBR Break, The Triage Tree & The Prevention Checklist

> **Pass B scope:** **#1 Mental model · #2 root cause · #3 why catastrophic · #4 the fix · #5 prevention · #6 generics + MySQL reality**, plus the **💰 money verdict**. Diagrams + recovery code-specifics are Passes C/D. These close out the failure-modes chapter.
>
> Running domain: payments/wallet, the ledger. *Every* scenario asks: **did money get lost or duplicated, and what catches/recovers it?**

---

## 15.12 · OOM-killer victimizing mysqld

**Mental model.** On Linux, when the system runs out of memory, the kernel's **OOM-killer** picks a process to kill to free memory — and mysqld (the biggest memory user) is the prime victim. The result: **mysqld is abruptly killed** (SIGKILL — no clean shutdown) → a crash → crash recovery on restart (M09). The root cause is **memory over-commit**: the buffer pool + per-connection buffers × (a connection spike) + other processes exceed RAM. It's preventable by **right-sizing memory** (buffer pool + max connections sized to fit RAM with headroom, M13/13.13) — an OOM-kill is a *capacity planning* failure.

**How it happens (root cause).** MySQL's memory = the **buffer pool** (a fixed large chunk, M09/M13 — e.g., 70-80% of RAM) + **per-connection buffers** (sort buffer, join buffer, etc. — allocated *per connection*, so they scale with connection count) + other caches. If the buffer pool is sized *too aggressively* (e.g., 90% of RAM) *and* a **connection storm** (M13/13.12) opens many connections (each allocating per-connection buffers) *and* other processes need memory — total demand *exceeds* RAM. Linux over-commits (lets allocations succeed optimistically), then when memory is actually *touched* and runs out, the OOM-killer fires and kills mysqld. The root cause is **buffer pool + (connections × per-conn buffers) + overhead > RAM**.

**Why it's catastrophic.** mysqld is *killed* (not shut down cleanly) → an abrupt crash → an outage (payments stop) + crash recovery on restart (M09 — durable *if* config is right, 15.2). If it's a *recurring* condition (the memory pressure persists), mysqld gets OOM-killed *repeatedly* (a crash loop). For money, an outage stops transfers; the crash itself is recoverable (if 1/1, 15.2) but the *repeated* kills are a sustained outage. It's catastrophic as an *outage* (and a sign of mis-sizing).

**The fix (recovery).** **Immediate:** restart mysqld (crash recovery, M09); reduce memory pressure (kill the connection storm, M13/13.12; stop other memory hogs). **Root cause:** **right-size the buffer pool** (leave headroom — buffer pool + max-connections × per-conn-buffers + OS should be < RAM, M13/13.13), **bound connections + pool** (M13/13.12 — so per-connection buffers don't explode), and possibly add RAM. Configure the OOM-killer to *not* prefer mysqld (`oom_score_adj`) as a stopgap.

**Prevention.** **Memory right-sizing** (M13/13.13 — buffer pool sized with headroom for per-connection buffers + OS, *not* 90%+ of RAM) + **connection pooling/limits** (M13/13.12 — bound connections so per-connection memory is bounded) + **memory monitoring** (alert on memory pressure before OOM) + a dedicated DB host (don't co-locate memory-hungry processes). It's a *capacity-planning* prevention — fit the memory budget.

**Generics / MySQL reality.** OOM-killing the database is a universal Linux operational failure (any large-memory process) — prevented by right-sizing and connection bounding. In MySQL: buffer pool + per-connection-buffer sizing (M09/M13), connection pooling (M13/13.12), memory monitoring. The link: the *connection storm* (M13/13.12) and *over-sized buffer pool* (M13/13.13) *combine* to cause OOM. The Pass C Mermaid draws memory over-commit → OOM-kill → crash recovery.

**💰 Money verdict.** **Money movement STOPS (outage)**; the crash itself is recoverable if durability is 1/1 (15.2). A *capacity-planning* catastrophe. Prevention: memory right-sizing + connection bounding (M13). The lesson: **an OOM-kill is a mis-sizing — fit buffer pool + connections × per-conn-buffers within RAM, with headroom.**

---

## 15.13 · Undo / history-list bloat from a forgotten long transaction

**Mental model.** A single **long-running transaction** left open (a forgotten reporting session, a stuck app transaction, an idle-in-transaction connection) is a silent time-bomb: because MVCC must preserve the *old* row versions that transaction might still read (M08), **undo logs can't be purged** while it's open → the **history-list length (HLL)** grows unbounded → reads slow (longer version chains to traverse, M08), undo space bloats (→ disk-full, 15.11), and eventually the database degrades into an *outage*. The terror: *one forgotten transaction* (often trivial — a `SELECT` someone left open) can take down the whole database. It's *the* silent performance/space killer — caught by the HLL early-warning signal (M13/13.11).

**How it happens (root cause).** InnoDB's MVCC (M08) keeps *old versions* of rows (in the undo log) so that *open* transactions see a consistent snapshot (the data as of when they started). The **purge** thread (M08/M09) reclaims undo *once no open transaction needs it*. But a **long-open transaction** (especially under REPEATABLE READ, which holds its snapshot for the *whole* transaction) means undo from *its start onward* *can't be purged* (it might still read those old versions). So every change since that transaction started *accumulates* undo (the HLL grows). A transaction open for *hours* (a forgotten session) → *hours* of accumulated undo → HLL in the millions → reads traversing huge version chains (slow) → undo space exhausting disk. The root cause is **one transaction held open far too long** (M07/7.15).

**Why it's catastrophic.** It's *silent* and *amplifying*: the HLL grows *invisibly* (no error) while *everything* slows (every read traverses longer chains, M08) and undo bloats toward disk-full (15.11). A *trivial* cause (a `SELECT` left open) has a *catastrophic* effect (a database-wide slowdown → outage). For money, the whole platform degrades — transfers slow, then stall. And it's *insidious* because the *cause* (a forgotten transaction) is far from the *symptom* (slow reads everywhere) — hard to diagnose without knowing to look at HLL.

**The fix (recovery).** **Find and kill the long transaction:** `SELECT * FROM information_schema.innodb_trx ORDER BY trx_started` (find the oldest, M08) → `KILL` it → purge resumes → undo reclaims → HLL drops → performance recovers. The HLL bloat is *fully recoverable* once the offending transaction is gone (no data loss — it's a performance/space problem, not a data problem). The fix is *fast* once you know the cause (kill one transaction).

**Prevention.** **The HLL early-warning signal** (M13/13.11 — alert when HLL climbs past a threshold → find and kill the long transaction *before* it bloats) + **transaction timeouts** (don't let transactions stay open indefinitely — application-level timeouts, idle-transaction killing) + **short transactions** (M07/7.15 — the discipline of not holding transactions open) + **avoiding long-running transactions on the primary** (run reporting on replicas, M02/2.17/M10). The HLL alert (M13/13.11) is the key prevention — it turns a silent bomb into a caught-early non-event.

**Generics / MySQL reality.** MVCC-based databases all face this: a long-open transaction prevents version cleanup, bloating storage and slowing reads (the same as Postgres's "long transaction prevents VACUUM" / bloat). In MySQL: HLL + the purge thread (M08/M09), `innodb_trx` to find the culprit, the HLL early-warning signal (M13/13.11), transaction timeouts. The deep link: this is *why* M08/M09 emphasized HLL and *why* M13/13.11 made it an early-warning signal. The Pass C Mermaid draws the long-txn → undo-can't-purge → HLL-bloat → outage path.

**💰 Money verdict.** **Money movement DEGRADES then STOPS (outage)** — but *no data lost/duplicated* (it's a performance/space problem; fully recoverable by killing the transaction). Prevention: the HLL early-warning signal (M13/13.11) + transaction timeouts. The lesson: **one forgotten transaction can take down the database — watch HLL (M13/13.11), enforce transaction timeouts, keep transactions short.**

---

## 15.14 · Replication breaks on a non-deterministic statement / data drift

**Mental model.** With **statement-based replication** (SBR, M10/10.3), a **non-deterministic statement** (`UUID()`, `NOW()`, `RAND()`, `UPDATE … LIMIT` without `ORDER BY`) produces a *different result* when re-executed on the replica → the replica **diverges** (silent data drift) *or* the applier hits an error and **stops** (lag grows, HA is lost). Either way, the source and replica disagree — a forked-ledger-lite (15.3) or a halted replica. The fix is **ROW format** (M10/10.3 — ship the exact row *result*, not the statement, so no re-execution divergence); recovery is re-syncing the replica. It's a *self-inflicted* divergence from using the wrong binlog format for money.

**How it happens (root cause).** SBR ships the *SQL statement* and the replica *re-executes* it (M10/10.3). For *deterministic* statements, re-execution gives the same result. But for *non-deterministic* ones — `INSERT … VALUES (UUID())` (different UUID on the replica), `NOW()` (different timestamp), `RAND()`, `UPDATE … LIMIT 10` without `ORDER BY` (may affect *different rows*) — re-execution gives a *different* result → the replica's data *diverges* from the source's (silent drift). Or, if the statement errors on the replica (a constraint the divergence violates), the **applier stops** (replication breaks → lag grows). The root cause is **SBR + non-determinism** (M10/10.3).

**Why it's catastrophic.** **Silent divergence** (the replica's ledger drifts from the source's — a forked-ledger-lite, 15.3) means a *wrong* copy that you might *fail over to* (promoting a diverged replica → the wrong ledger). **Applier stop** means the replica *falls behind* (lag, M10/10.5 → stale reads, money bugs) and *can't be a failover target* (HA lost). For money, a diverged replica ledger is a money-never-lies violation (which copy is right?); a stopped applier is an HA/lag catastrophe. Both stem from a *preventable* config choice (SBR for money).

**The fix (recovery).** **For a stopped applier:** diagnose the error (`SHOW REPLICA STATUS` — `Last_SQL_Error`, M10), fix the divergence (the row that differs), and resume — or, if diverged, **re-sync the replica** (rebuild from a fresh backup, M13/13.2 — clean copy). **For silent divergence:** detect it (`pt-table-checksum` — compares source vs replica row-by-row), then re-sync the diverged tables. **Switch to ROW format** (M10/10.3) so it can't recur.

**Prevention.** **`binlog_format=ROW`** (M10/10.3 — *the* prevention: ship the exact row result, no re-execution, no non-deterministic divergence — required for money) + **monitoring replication errors + lag** (M10/10.12, M13/13.11 — catch a stopped applier early) + **`pt-table-checksum`** (periodically verify source = replica — detect drift) + **ROW is required for group replication and clean CDC** (M10/M12 — another reason). ROW format is the single prevention; SBR should never be used for money.

**Generics / MySQL reality.** "Command replication needs determinism; ship the result when you can't guarantee it" is universal (Raft/Paxos require deterministic state machines for exactly this reason, M10/10.3). In MySQL: `binlog_format=ROW` (M10/10.3), `pt-table-checksum` (drift detection), replication monitoring (M10/10.12). This is M10/10.3's hazard *realized* — a self-inflicted divergence. The Pass C Mermaid draws SBR + non-determinism → diverge/stop → re-sync.

**💰 Money verdict.** **Money copy DIVERGES (wrong replica ledger) or HA LOST (stopped applier)** — a *self-inflicted, preventable* catastrophe. Prevention: ROW format (M10/10.3). Detection: `pt-table-checksum` + replication-error monitoring. The lesson: **never use statement-based replication for money — ROW format prevents non-deterministic divergence; verify with checksums.**

---

## 15.15 · The "I lost data — now what?" triage tree ★

**Mental model.** The master incident runbook (the *detailed* version of M14/14.8) — the money-safe response to *any* suspected data loss, routing each symptom to the right scenario above: **CONTAIN (stop the bleeding) → ASSESS (blast radius) → RECOVER (the right path) → VERIFY (reconcile) → POST-MORTEM (prevent recurrence)**. The order is *sacred* for money: **contain before you investigate** (an ongoing incident worsens while you diagnose), and **verify (reconcile) before you declare recovery** ("recovered" without reconciliation isn't recovered). This tree is the chapter's *operational synthesis* — it ties every scenario (15.2–15.14) into one response procedure.

**How it works (the procedure).**
1. **CONTAIN first** (before investigating): stop the *cause* of ongoing loss — **halt** the bad deploy/script/query; **fence** a diverging node (15.3 — never let a split-brain keep writing, M10/10.11); **freeze writes** to the affected scope if needed. *An ongoing incident gets worse while you investigate* — containment is *first*.
2. **ASSESS the blast radius:** *what* / *how much* / *since when* / *still spreading*? Classify the failure (route to the scenario): lost commits (15.2)? split-brain (15.3)? corruption (15.5)? a `DROP` (15.8)? an app-level race (15.9)? a backup issue (15.10)? **Quantify with reconciliation** (M12/12.14 — balance ≠ Σ entries → exactly which accounts, how much).
3. **RECOVER** (the right path per the scenario): logical error/`DROP` → **PITR** (15.7/15.8, M13/13.3); node loss → **failover** (M10/10.10); corruption → **restore + PITR** or **force_recovery-extract** (15.5/15.6); split-brain → **stop, pick authoritative, manually reconcile** (15.3); app-level → **re-derive from the immutable ledger** (15.9, M01/1.17); backup-won't-restore → **damage-limitation scramble** (15.10).
4. **VERIFY (non-negotiable):** **reconcile** the recovered data (M12/12.14 — balance = Σ entries, internal = external) — *prove* correctness. **"Recovered" without reconciliation is not recovered.**
5. **POST-MORTEM:** root cause → prevent recurrence (the early-warning signal, M13/13.11; the tested restore, M13/13.5; the config, M09; the fencing, M10 — that *would have* prevented it). Feed the prevention checklist (15.16).

**Why it's catastrophic if done wrong.** The *order* matters: investigating *before* containing lets the incident *worsen* (more loss while you diagnose); declaring recovery *before* verifying ships *wrong* data as "recovered" (undetected ongoing loss). For money, a mis-ordered response *compounds* the catastrophe. The tree exists to make the response *disciplined* under pressure (when instinct says "investigate" or "it looks fixed").

**Generics / MySQL reality.** Incident response — contain → assess → recover → verify → post-mortem — is universal (SRE incident management, the same for any system). In MySQL, it routes to the MySQL recovery mechanisms (PITR, failover, force_recovery, reconciliation). It's M14/14.8 *detailed*, with the MySQL-specific recovery paths. The ★ SVG (Pass C) draws the full triage tree.

**💰 Money verdict.** The *meta*-runbook for *every* money verdict: the tree's discipline (contain → recover → **verify/reconcile**) is what *makes* the money verdict answerable and the recovery trustworthy. The lesson: **contain first, verify (reconcile) before declaring recovery — the order is sacred for money.**

---

## 15.16 · The prevention checklist (so none of this happens) ★

**Mental model.** The consolidated **prevention posture** — the single checklist that, if followed, prevents (or makes recoverable) *every* scenario in this chapter. It's the "money-never-lies in the face of catastrophe" checklist, drawn from the prior modules' guarantees: **durability config** (15.2), **fencing/quorum** (15.3), **`super_read_only`** (15.4), **checksums/doublewrite/honest-fsync** (15.5), **tested backups** (15.6/15.10), **durable+retained binlog** (15.7), **DDL least-privilege** (15.8), **atomic/locked writes + idempotency** (15.9), **disk/HLL/memory early-warning** (15.11/15.12/15.13), **ROW format** (15.14), and **reconciliation** (the universal backstop, all scenarios). Each item *prevents* a specific catastrophe; together they're the platform's *survives-anything* posture — and the foundation of M16's DR.

**How it works (the checklist — catastrophe → prevention).**
- **Lost commits (15.2)** → `flush_log_at_trx_commit=1` + `sync_binlog=1` + **semi-sync** (M09/M10).
- **Split-brain (15.3)** → **fencing/STONITH or quorum** + never fail over without fencing (M10/10.11).
- **Errant transactions (15.4)** → **`super_read_only`** on all replicas (M10/10.7).
- **Silent corruption (15.5)** → **page checksums + doublewrite buffer + honest fsync** (M09) + ECC/ZFS.
- **Need for force_recovery (15.6)** → **tested backups + healthy replicas** (restore-clean instead of salvage).
- **PITR gaps (15.7)** → **`sync_binlog=1` + binlog retention + off-host archive + tested PITR drills** (M13).
- **Dropped table (15.8)** → **DDL least-privilege + the PITR prerequisites** (M13/13.14).
- **App-level loss (15.9)** → **atomic conditional `UPDATE` / `FOR UPDATE` + idempotency + outbox + the immutable ledger** (M07/M08/M12).
- **Backup won't restore (15.10)** → **automated tested restore drills + reconciliation + key management** (M13/13.5).
- **Disk-full / OOM / HLL bloat (15.11/15.12/15.13)** → **the early-warning signals** (disk, memory, HLL — M13/13.11) + capacity right-sizing + transaction timeouts.
- **SBR divergence (15.14)** → **`binlog_format=ROW` + `pt-table-checksum`** (M10/10.3).
- **The universal backstop (all)** → **reconciliation** (M12/12.14 — detect *anything* that slipped through) + **the early-warning signals** (M13/13.11 — catch the buildups) + **tested recovery** (M13/13.5 — *proven* able to recover).

**Why it's the synthesis.** This checklist *is* the chapter's positive statement: every catastrophe (15.2–15.14) has a *specific* prevention, and the three universals (**durability config, reconciliation, tested recovery + early-warning**) underpin them all. A platform that follows the checklist *survives* the catastrophes (prevents them, or recovers cleanly + verifies). It's the bridge to M16's DR challenge — "what does zero-data-loss really cost?" is answered by *this checklist* (the cost is following all of it).

**Generics / MySQL reality.** The prevention posture — durability, redundancy, fencing, tested recovery, monitoring/early-warning, and verification/reconciliation — is universal to all high-value stateful systems. In MySQL, it's the consolidated settings/practices from M09–M13. The ★ SVG (Pass C) draws the checklist (each catastrophe → its prevention).

**💰 Money verdict.** **Money SAFE** — *if* the checklist is followed (every catastrophe prevented or cleanly recoverable + verified). This is the money-never-lies posture *against catastrophe*: durable (1/1 + semi-sync), single-writer (fencing/quorum), corruption-defended (checksums/doublewrite), recoverable (tested backups + durable binlog + PITR drills), app-correct (atomic + idempotent), watched (early-warning), and *verified* (reconciliation). The lesson (the chapter's conclusion): **catastrophes are survivable — with durability config, fencing, checksums, tested recovery, early-warning, and reconciliation, money stays safe even when the system fails.** This is the foundation of M16's failure-and-recovery / DR challenge.

---

*Scenarios 15.12–15.16 — Pass B complete. **M15 Pass B is fully drafted (all 16 scenarios).** Next: M15 Pass C (the catastrophe diagrams + the triage tree — ~9–10 ★ SVGs + Mermaid + the worked catastrophe recoveries).*
