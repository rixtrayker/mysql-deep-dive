#!/usr/bin/env node
// Zero-dependency-ish static site builder for the MySQL deep-revision resource.
// Uses `marked` (already present via npx) for markdown→HTML. Merges the 4 passes
// (skeleton / core notes / diagrams / enrichment) per concept into one section.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderMarkdown } from './md.js';
import { MODULES, TRACKS } from './modules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');          // the mysql/ content root
const OUT = join(__dirname, 'dist');          // build output

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- parse a module: split every file into concept sections by `## N.M · Title` ----------
const CONCEPT_RE = /^##\s+(\d+\.\d+[a-z]?)\s*·?\s*(.*)$/;

function splitConcepts(md) {
  // returns { preamble, sections: [{id, title, body}] }
  const lines = md.split('\n');
  const sections = [];
  let cur = null;
  let preamble = [];
  for (const line of lines) {
    const m = line.match(CONCEPT_RE);
    if (m) {
      if (cur) sections.push(cur);
      cur = { id: m[1], title: m[2].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (cur) sections.push(cur);
  return { preamble: preamble.join('\n'), sections };
}

function passKind(filename) {
  // classify a file by which pass it represents
  if (/^00-/.test(filename)) return 'A';                       // skeleton
  if (/passC/.test(filename) || /-passC-/.test(filename)) return 'C';
  if (/passD/.test(filename)) return 'D';
  // everything else with a leading 01/02/03 numeric and not passC/D = core notes (B)
  return 'B';
}

function loadModule(mod) {
  const dir = join(ROOT, mod.dir);
  const files = readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  const concepts = new Map(); // id -> { id, title, parts: {B,C,D}, order }
  let order = 0;
  const appendices = []; // module-level files with no per-concept headings (e.g. M14 consolidated Pass D)

  for (const file of files) {
    const kind = passKind(file);
    if (kind === 'A') continue; // skeleton: planning doc, not reader content
    const md = readFileSync(join(dir, file), 'utf8');
    const { sections } = splitConcepts(md);

    if (sections.length === 0) {
      // a module-level file (no ## N.M concepts) — keep as an appendix, minus the H1
      const body = md.replace(/^#\s+.*$/m, '').trim();
      if (body) appendices.push({ kind, body });
      continue;
    }
    for (const s of sections) {
      if (!concepts.has(s.id)) {
        concepts.set(s.id, { id: s.id, title: s.title, parts: {}, order: order++ });
      }
      const c = concepts.get(s.id);
      if (!c.title || (kind === 'B' && s.title)) c.title = s.title;
      c.parts[kind] = (c.parts[kind] ? c.parts[kind] + '\n\n' : '') + s.body.join('\n').trim();
    }
  }

  const list = [...concepts.values()].sort((a, b) => cmpId(a.id, b.id));
  return { ...mod, concepts: list, appendices };
}

function cmpId(a, b) {
  const pa = a.split('.'), pb = b.split('.');
  const n1 = parseInt(pa[0]) - parseInt(pb[0]);
  if (n1) return n1;
  const sa = pa[1], sb = pb[1];
  const na = parseInt(sa), nb = parseInt(sb);
  if (na !== nb) return na - nb;
  return sa.localeCompare(sb); // 13 vs 13b
}

// ---------- merge a concept's 3 passes into one rendered HTML block ----------
function renderConcept(c, mod) {
  // Pass B = core notes (the prose). Pass C = diagram + worked example. Pass D = enrichment boxes.
  // We present: Core notes → Diagram & example → Enrichment, with subtle dividers.
  let html = '';

  if (c.parts.B) {
    html += `<div class="pass pass-notes">${md2html(c.parts.B, mod)}</div>`;
  }
  if (c.parts.C) {
    html += `<div class="pass pass-visual"><div class="pass-label">Diagram & worked example</div>${md2html(c.parts.C, mod)}</div>`;
  }
  if (c.parts.D) {
    html += `<div class="pass pass-enrich"><div class="pass-label">Deep dive</div>${enrichBoxes(md2html(c.parts.D, mod))}</div>`;
  }
  return html;
}

// Turn the emoji-headed enrichment paragraphs into styled cards.
// Pattern: <p><strong>🔧 Code-specifics.</strong> ...</p> [more content] until the next emoji header.
const BOX_META = {
  '🔧': { cls: 'box-code',    label: 'Code-specifics' },
  '⚠️': { cls: 'box-warn',    label: 'Failure modes & gotchas' },
  '⚠':  { cls: 'box-warn',    label: 'Failure modes & gotchas' },
  '💰': { cls: 'box-money',   label: 'Fintech lens' },
  '🎯': { cls: 'box-interview', label: 'Interview / system-design angle' },
  '✅': { cls: 'box-check',   label: 'Self-check' },
};
const EMOJI = '🔧|⚠️|⚠|💰|🎯|✅';
function enrichBoxes(html) {
  // Two header shapes carry the enrichment markers:
  //   <p><strong>{emoji} Title.</strong> ...        (per-concept Pass D)
  //   <h2>{emoji} Title …</h2>                       (M14 consolidated appendix)
  const pRe = new RegExp(`<p>\\s*<strong>(${EMOJI})\\s*([^<]*?)<\\/strong>`);
  const hRe = new RegExp(`<h[234]>\\s*(${EMOJI})\\s*([^<]*?)<\\/h[234]>`);
  if (!pRe.test(html) && !hRe.test(html)) return html;

  const splitRe = new RegExp(`(?=<p>\\s*<strong>(?:${EMOJI})|<h[234]>\\s*(?:${EMOJI}))`);
  const parts = html.split(splitRe);
  let out = '';
  for (const part of parts) {
    const mp = part.match(pRe), mh = part.match(hRe);
    if (mp) {
      const meta = BOX_META[mp[1]] || { cls: '', label: '' };
      let inner = part.replace(pRe, '<p>').replace(/^<p>\s*\.?\s*/, '<p>').replace(/^<p>\s*<\/p>/, '');
      out += boxHtml(mp[1], mp[2], meta, inner);
    } else if (mh) {
      const meta = BOX_META[mh[1]] || { cls: '', label: '' };
      let inner = part.replace(hRe, '');
      out += boxHtml(mh[1], mh[2], meta, inner);
    } else {
      out += part;
    }
  }
  return out;
}
function boxHtml(emoji, title, meta, inner) {
  const t = escapeHtml((title || '').replace(/\.$/, '').replace(/^—\s*/, '').trim()) || meta.label;
  return `<div class="ebox ${meta.cls}"><div class="ebox-h"><span class="ebox-ic">${emoji}</span>${t}</div><div class="ebox-b">${inner}</div></div>`;
}

function md2html(md, mod) {
  // rewrite assets/ image paths so they resolve from dist root: content/<dir>/assets/...
  let html = renderMarkdown(md);
  html = html.replace(/(<img[^>]+src=")assets\//g, `$1../content/${mod.dir}/assets/`);
  return html;
}

// ---------- HTML page template ----------
function star(s) { return s ? ' <span class="star">★</span>' : ''; }

function shell({ title, body, activeCode, nav, isHome }) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${isHome ? '' : '../'}style.css">
</head>
<body>
<div id="progress-rail"><div id="progress-fill"></div></div>
${nav}
<div class="layout">
${body}
</div>
<button id="theme-toggle" title="Toggle theme" aria-label="Toggle theme">◐</button>
<script>window.__BASE__='${isHome ? '' : '../'}';window.__ACTIVE__='${activeCode || ''}';</script>
<script src="${isHome ? '' : '../'}manifest.js"></script>
<script src="${isHome ? '' : '../'}app.js"></script>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad:false, theme:'dark', themeVariables:{
  fontFamily:'ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto',
  fontSize:'14px', primaryColor:'#11161c', primaryTextColor:'#e6edf3',
  primaryBorderColor:'#30363d', lineColor:'#8b98a5', secondaryColor:'#1b2430',
  tertiaryColor:'#161b22', background:'#0f1419', mainBkg:'#11161c',
  nodeBorder:'#30363d', clusterBkg:'#0d1117', clusterBorder:'#30363d',
  edgeLabelBackground:'#0f1419', noteBkgColor:'#1c2430', noteTextColor:'#e6edf3', noteBorderColor:'#30363d'
}});
window.__mermaid__ = mermaid;
window.__renderMermaid__ && window.__renderMermaid__();
</script>
</body>
</html>`;
}

// ---------- sidebar nav (modules grouped by track) ----------
function buildNav(modules, activeCode, isHome) {
  const base = isHome ? '' : '../';
  let groups = '';
  let curTrack = null;
  for (const m of modules) {
    if (m.track !== curTrack) {
      if (curTrack !== null) groups += '</div>';
      curTrack = m.track;
      const t = TRACKS[m.track];
      groups += `<div class="nav-track"><div class="nav-track-name" style="--accent:${t.accent}">${m.track} · ${t.name}</div>`;
    }
    const active = m.code === activeCode ? ' active' : '';
    const t = TRACKS[m.track];
    groups += `<a class="nav-mod${active}" href="${base}m/${m.code}.html" data-code="${m.code}" style="--accent:${t.accent}">
      <span class="nav-check" data-modcheck="${m.code}"></span>
      <span class="nav-code">${m.code}</span>
      <span class="nav-title">${escapeHtml(m.title)}${star(m.star)}</span>
      <span class="nav-modprog" data-modprog="${m.code}"></span>
    </a>`;
  }
  groups += '</div>';

  return `<header id="topbar">
  <button id="menu-toggle" aria-label="Menu">☰</button>
  <a id="brand" href="${base}index.html"><span class="brand-mark">⌬</span> <b>High-Performance MySQL</b> <span class="brand-sub">deep revision · fintech</span></a>
  <div id="section-indicator" aria-live="polite"></div>
  <div id="overall-prog" title="Overall progress"></div>
</header>
<aside id="sidebar">
  <a class="nav-home${activeCode ? '' : ' active'}" href="${base}index.html">⌂ Overview</a>
  <div class="nav-search-wrap"><input id="nav-search" placeholder="Filter modules…" autocomplete="off"></div>
  ${groups}
  <div class="nav-foot">16 modules · 78 diagrams · staff/architect depth</div>
</aside>
<div id="scrim"></div>`;
}

// ---------- module page ----------
function renderModulePage(mod, modules, idx) {
  const t = TRACKS[mod.track];
  const concepts = mod.concepts;
  const prev = idx > 0 ? modules[idx - 1] : null;
  const next = idx < modules.length - 1 ? modules[idx + 1] : null;

  // concept rail (right-side TOC)
  const rail = concepts.map(c =>
    `<a class="rail-item" href="#c-${c.id}" data-cid="${mod.code}:${c.id}">
       <span class="rail-check" data-check="${mod.code}:${c.id}"></span>
       <span class="rail-id">${c.id}</span>
       <span class="rail-title">${escapeHtml(stripStar(c.title))}</span>
     </a>`).join('');

  const sections = concepts.map((c, i) => {
    const starred = /★/.test(c.title);
    return `<section class="concept${starred ? ' starred' : ''}" id="c-${c.id}" data-cid="${mod.code}:${c.id}" data-num="${c.id}">
      <div class="concept-head">
        <div class="concept-num">${c.id}</div>
        <h2 class="concept-title">${escapeHtml(stripStar(c.title))}${starred ? ' <span class="star">★</span>' : ''}</h2>
        <button class="concept-done" data-done="${mod.code}:${c.id}" title="Mark this section complete">
          <span class="cd-box"></span><span class="cd-label">Mark done</span>
        </button>
      </div>
      <div class="concept-body">${renderConcept(c, mod)}</div>
    </section>`;
  }).join('\n');

  const body = `
  <main id="content" class="module-page" data-module="${mod.code}" data-track="${mod.track}" style="--accent:${t.accent}">
    <div class="module-hero">
      <div class="module-kicker">${mod.track} · ${TRACKS[mod.track].name}</div>
      <h1 class="module-h1"><span class="module-code">${mod.code}</span> ${escapeHtml(mod.title)}${star(mod.star)}</h1>
      <div class="module-meta">
        <span>${concepts.length} sections</span>
        <span class="module-prog-wrap"><span class="module-prog-bar"><span class="module-prog-fill" data-mfill="${mod.code}"></span></span><span data-mtext="${mod.code}">0%</span></span>
      </div>
    </div>
    ${sections}
    ${(mod.appendices && mod.appendices.length) ? `<section class="concept appendix" id="c-appendix">
      <div class="concept-head">
        <div class="concept-num">＋</div>
        <h2 class="concept-title">Module enrichment <span class="appendix-tag">cross-cutting</span></h2>
      </div>
      <div class="concept-body">${mod.appendices.map(a => enrichBoxes(md2html(a.body, mod))).join('<hr>')}</div>
    </section>` : ''}
    <nav class="module-flips">
      ${prev ? `<a class="flip prev" href="${prev.code}.html"><span>← ${prev.code}</span><b>${escapeHtml(prev.title)}</b></a>` : '<span></span>'}
      ${next ? `<a class="flip next" href="${next.code}.html"><span>${next.code} →</span><b>${escapeHtml(next.title)}</b></a>` : '<span></span>'}
    </nav>
  </main>
  <aside id="concept-rail" data-module="${mod.code}">
    <div class="rail-head">On this page</div>
    <div class="rail-list">${rail}</div>
    <div class="rail-foot"><button id="mark-all" data-module="${mod.code}">✓ Mark module complete</button></div>
  </aside>`;

  return shell({
    title: `${mod.code} · ${mod.title} — High-Performance MySQL`,
    body,
    activeCode: mod.code,
    nav: buildNav(modules, mod.code, false),
  });
}

function stripStar(s) { return s.replace(/\s*★\s*$/, '').trim(); }

// ---------- home page ----------
function renderHome(modules) {
  const cards = modules.map(m => {
    const t = TRACKS[m.track];
    return `<a class="home-card" href="m/${m.code}.html" style="--accent:${t.accent}">
      <div class="hc-top"><span class="hc-code">${m.code}</span><span class="hc-check" data-modcheck="${m.code}"></span></div>
      <div class="hc-title">${escapeHtml(m.title)}${star(m.star)}</div>
      <div class="hc-track">${m.track} · ${TRACKS[m.track].name}</div>
      <div class="hc-count"><span data-modcount="${m.code}">${m.concepts.length} sections</span></div>
      <div class="hc-bar"><span class="hc-fill" data-mfill="${m.code}"></span></div>
    </a>`;
  }).join('');

  // track legend
  const legend = Object.entries(TRACKS).map(([k, t]) =>
    `<span class="leg"><i style="background:${t.accent}"></i>${k} · ${t.name}</span>`).join('');

  const totalConcepts = modules.reduce((s, m) => s + m.concepts.length, 0);

  const body = `
  <main id="content" class="home">
    <div class="hero">
      <div class="hero-glow"></div>
      <h1 class="hero-title">High-Performance <span class="grad">MySQL</span></h1>
      <p class="hero-sub">A concept-first, fintech-focused deep-revision resource at staff / architect depth — modeled on <i>High Performance MySQL</i>.</p>
      <div class="hero-stats">
        <div class="stat"><b>16</b><span>modules</span></div>
        <div class="stat"><b>${totalConcepts}</b><span>sections</span></div>
        <div class="stat"><b>78</b><span>diagrams</span></div>
        <div class="stat"><b id="home-done">0</b><span>completed</span></div>
      </div>
      <div class="hero-progress">
        <div class="hp-bar"><div class="hp-fill" id="home-fill"></div></div>
        <div class="hp-text"><span id="home-pct">0%</span> of the journey complete</div>
      </div>
      <div class="hero-cta">
        <a class="cta primary" href="m/M01.html">Start at M01 →</a>
        <a class="cta" id="resume-cta" href="m/M01.html">Resume</a>
        <button class="cta ghost" id="reset-progress">Reset progress</button>
      </div>
    </div>

    <div class="threads">
      <h3>Four threads run through every module</h3>
      <div class="thread-grid">
        <div class="thread"><b>Durability</b><span>"What survives a crash?"</span></div>
        <div class="thread"><b>Money-never-lies</b><span>"Did money get lost or duplicated?"</span></div>
        <div class="thread"><b>Generics-first</b><span>The agnostic principle before the MySQL specifics</span></div>
        <div class="thread"><b>Tradeoff</b><span>Nothing is free; the cost is always named</span></div>
      </div>
    </div>

    <div class="track-legend">${legend}</div>
    <div class="home-grid">${cards}</div>

    <footer class="home-foot">
      Single running payments/wallet domain · money in integer minor units / DECIMAL (never FLOAT) · crow's-foot ER · 12-point content contract.
      <br>Progress is saved locally in your browser.
    </footer>
  </main>`;

  return shell({
    title: 'High-Performance MySQL — Deep Revision',
    body,
    activeCode: '',
    nav: buildNav(modules, '', true),
    isHome: true,
  });
}

// ---------- main build ----------
function build() {
  console.log('Loading modules…');
  const modules = MODULES.map(loadModule);
  modules.forEach(m => console.log(`  ${m.code}: ${m.concepts.length} concepts`));

  // clean + create dirs
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  mkdirSync(join(OUT, 'm'), { recursive: true });
  mkdirSync(join(OUT, 'content'), { recursive: true });

  // copy each module's assets
  for (const m of modules) {
    const src = join(ROOT, m.dir, 'assets');
    if (existsSync(src)) {
      cpSync(src, join(OUT, 'content', m.dir, 'assets'), { recursive: true });
    }
  }

  // home
  writeFileSync(join(OUT, 'index.html'), renderHome(modules));
  // module pages
  modules.forEach((m, i) => {
    writeFileSync(join(OUT, 'm', `${m.code}.html`), renderModulePage(m, modules, i));
  });

  // emit a manifest for the app (module codes + concept ids) so JS can compute progress
  const manifest = modules.map(m => ({
    code: m.code, title: m.title, track: m.track,
    concepts: m.concepts.map(c => ({ id: c.id, title: stripStar(c.title) })),
  }));
  writeFileSync(join(OUT, 'manifest.js'), 'window.__MANIFEST__=' + JSON.stringify(manifest) + ';');

  // copy static assets (css/js)
  cpSync(join(__dirname, 'style.css'), join(OUT, 'style.css'));
  cpSync(join(__dirname, 'app.js'), join(OUT, 'app.js'));

  console.log(`\n✓ Built ${modules.length} module pages + home → ${OUT}`);
  console.log(`  Total sections: ${modules.reduce((s, m) => s + m.concepts.length, 0)}`);
}

build();
