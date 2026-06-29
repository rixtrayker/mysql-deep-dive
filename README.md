# High-Performance MySQL — Deep Revision (Fintech-focused)

A concept-first, **staff/architect-depth** MySQL revision resource modeled on *High Performance MySQL* (Schwartz, Zaitsev, Tkachenko) — built for revision, system-design interviews, and production decisions. **Concepts and diagrams over code**: real SQL/config appears only in clearly-labeled "Code-specifics" boxes.

**16 modules · 264 sections · 78 custom diagrams** — a single running payments/wallet domain throughout, with four threads running through every module: **durability** ("what survives a crash?"), **money-never-lies** ("did money get lost or duplicated?"), **generics-first** (the agnostic principle before the MySQL specifics), and **tradeoff** (nothing is free).

## The journey

| Track | Modules |
|-------|---------|
| **A · Foundations** | M01 Relational Foundations · M02 Normalization · M03 Data Types |
| **B · Performance** | M04 Query Execution · M05 Indexing ★ · M06 Optimization/EXPLAIN |
| **C · Concurrency & Internals** | M07 Transactions/ACID · M08 Locking/MVCC ★ · M09 InnoDB Internals & Disk Durability ★ |
| **D · Scale & Distribution** | M10 Replication ★ · M11 Sharding ★ · M12 Distributed Data ★ |
| **E · Operations** | M13 Operations/Backups/Observability ★ · M14 Cheat-Sheet/Decision-Guides · M15 Failure Modes & Data Loss ★ |
| **F · Capstone** | M16 Fintech System Design ★ |

## The website

A polished dark-theme static site (zero runtime dependencies) presents all 16 modules with:

- **Merged-per-concept reading** — each concept's core notes, diagram + worked example, and deep-dive enrichment stitched into one flowing section.
- **A fixed section-number indicator** in the top bar, a **reading progress bar**, and **per-section completion checkmarks** tracked in your browser (localStorage) — with module/overall progress and a resume link.
- **Mermaid diagrams** + **78 hand-authored SVGs** (dark-theme, GitHub-dark palette) rendered inline.

### Build & run locally

```bash
cd site
node build.js          # generates site/dist/ (no npm install needed)
# then open site/dist/index.html, or serve it:
npx serve dist         # or any static server
```

The site is also deployed via Netlify (config in `netlify.toml`).

## Repository layout

```
M01…M16/                 # the 16 modules — markdown source + per-module assets/ (SVGs)
  NN-*.md                #   Pass A skeleton, B core notes, C diagrams/examples, D enrichment
  assets/*.svg           #   custom diagrams
site/                    # the static-site generator (vanilla Node + a tiny markdown renderer)
  build.js · md.js · modules.js · style.css · app.js
README.md                # the master index + per-module status
netlify.toml             # Netlify build config
```

## Conventions

- Money is modeled as **integer minor units / `DECIMAL`** — never `FLOAT`.
- Crow's-foot notation for ER diagrams; the reserved word `transaction` is written `transaction_` in DDL.
- Every concept follows a 12-point content contract (mental model → how it works → why → tradeoffs → generics → MySQL reality → code-specifics → worked example → failure modes → fintech lens → interview angle → diagram).

---

*Concept-first revision content. Authored as a study/interview-prep resource.*
