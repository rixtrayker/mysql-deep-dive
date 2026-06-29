/* ============================================================
   High-Performance MySQL — site interactions
   progress (localStorage) · checkmarks · fixed section number ·
   reading progress bar · scrollspy · mermaid · theme · search
   ============================================================ */
(function(){
'use strict';
const LS_DONE = 'hpm.done.v1';     // Set of "Mxx:N.M" concept ids marked done
const LS_THEME = 'hpm.theme.v1';
const LS_LAST = 'hpm.last.v1';     // last visited module
const M = window.__MANIFEST__ || [];
const BASE = window.__BASE__ || '';

/* ---------- storage ---------- */
function loadDone(){ try{ return new Set(JSON.parse(localStorage.getItem(LS_DONE)||'[]')); }catch(e){ return new Set(); } }
function saveDone(set){ localStorage.setItem(LS_DONE, JSON.stringify([...set])); }
let DONE = loadDone();

function totalConcepts(){ return M.reduce((s,m)=>s+m.concepts.length,0); }
function moduleIds(code){ const m=M.find(x=>x.code===code); return m?m.concepts.map(c=>code+':'+c.id):[]; }
function moduleDone(code){ const ids=moduleIds(code); const d=ids.filter(i=>DONE.has(i)).length; return {done:d,total:ids.length}; }

/* ---------- theme ---------- */
function applyTheme(t){ document.documentElement.setAttribute('data-theme',t); }
(function initTheme(){
  const t = localStorage.getItem(LS_THEME) || 'dark';
  applyTheme(t);
  document.addEventListener('click',e=>{
    if(e.target.closest('#theme-toggle')){
      const cur=document.documentElement.getAttribute('data-theme');
      const nt=cur==='dark'?'light':'dark';
      applyTheme(nt); localStorage.setItem(LS_THEME,nt);
      // re-render mermaid for the new theme
      reRenderMermaid(nt);
    }
  });
})();

/* ---------- toast + spark ---------- */
let toastEl;
function toast(msg, icon='✓'){
  if(!toastEl){ toastEl=document.createElement('div'); toastEl.id='toast'; document.body.appendChild(toastEl); }
  toastEl.innerHTML=`<span class="t-ic">${icon}</span> ${msg}`;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>toastEl.classList.remove('show'),2200);
}
function celebrate(x,y){
  const colors=['#58a6ff','#7ee2a8','#d2a8ff','#f0c674','#ff7b9c'];
  for(let i=0;i<22;i++){
    const s=document.createElement('div'); s.className='spark';
    s.style.background=colors[i%colors.length];
    s.style.left=x+'px'; s.style.top=y+'px';
    document.body.appendChild(s);
    const ang=Math.random()*Math.PI*2, dist=60+Math.random()*120;
    const dx=Math.cos(ang)*dist, dy=Math.sin(ang)*dist-40;
    s.animate([
      {transform:'translate(0,0) rotate(0deg)',opacity:1},
      {transform:`translate(${dx}px,${dy}px) rotate(${Math.random()*540}deg)`,opacity:0}
    ],{duration:700+Math.random()*500,easing:'cubic-bezier(.2,.7,.3,1)'}).onfinish=()=>s.remove();
  }
}

/* ---------- update all progress UI ---------- */
function refreshUI(){
  // sidebar module checks + percents
  document.querySelectorAll('[data-modcheck]').forEach(el=>{
    const {done,total}=moduleDone(el.getAttribute('data-modcheck'));
    el.classList.remove('done','partial');
    if(total&&done===total) el.classList.add('done');
    else if(done>0) el.classList.add('partial');
  });
  document.querySelectorAll('[data-modprog]').forEach(el=>{
    const {done,total}=moduleDone(el.getAttribute('data-modprog'));
    el.textContent = total? (done===total?'✓':done+'/'+total) : '';
  });
  document.querySelectorAll('[data-mfill]').forEach(el=>{
    const {done,total}=moduleDone(el.getAttribute('data-mfill'));
    el.style.width = total? Math.round(done/total*100)+'%' : '0%';
  });
  document.querySelectorAll('[data-mtext]').forEach(el=>{
    const {done,total}=moduleDone(el.getAttribute('data-mtext'));
    el.textContent = total? Math.round(done/total*100)+'% complete' : '';
  });

  // per-concept checks (rail + concept buttons)
  document.querySelectorAll('[data-check]').forEach(el=>{
    el.classList.toggle('done', DONE.has(el.getAttribute('data-check')));
  });
  document.querySelectorAll('.concept-done').forEach(btn=>{
    const id=btn.getAttribute('data-done');
    const on=DONE.has(id);
    btn.classList.toggle('done',on);
    const sec=document.getElementById('c-'+id.split(':')[1]);
    if(sec) sec.classList.toggle('is-done',on);
  });
  document.querySelectorAll('.rail-item').forEach(item=>{
    const id=item.getAttribute('data-cid');
    item.querySelector('.rail-check')?.classList.toggle('done',DONE.has(id));
  });

  // overall ring in topbar
  const tot=totalConcepts(), dn=[...DONE].filter(id=>M.some(m=>m.code===id.split(':')[0])).length;
  const op=document.getElementById('overall-prog');
  if(op){ const pct=tot?Math.round(dn/tot*100):0; op.innerHTML=`<span style="color:var(--green-2);font-weight:700">${pct}%</span> overall`; }

  // home page
  const hf=document.getElementById('home-fill'); if(hf){
    const pct=tot?Math.round(dn/tot*100):0;
    hf.style.width=pct+'%';
    const hp=document.getElementById('home-pct'); if(hp) hp.textContent=pct+'%';
    const hd=document.getElementById('home-done'); if(hd) hd.textContent=dn;
  }

  // mark-all button state
  const ma=document.getElementById('mark-all');
  if(ma){ const {done,total}=moduleDone(ma.getAttribute('data-module'));
    ma.classList.toggle('all-done',total&&done===total);
    ma.textContent = (total&&done===total)?'✓ Module complete':'✓ Mark module complete';
  }
  // module hero fill is covered by [data-mfill] above
}

/* ---------- toggle a concept ---------- */
function toggleConcept(id, evt){
  const wasDone=DONE.has(id);
  if(wasDone) DONE.delete(id); else DONE.add(id);
  saveDone(DONE);
  refreshUI();
  if(!wasDone){
    if(evt){ celebrate(evt.clientX, evt.clientY); }
    // module-complete celebration
    const code=id.split(':')[0];
    const {done,total}=moduleDone(code);
    if(total&&done===total){
      toast(`${code} complete — every section done!`,'🎉');
      const r=document.querySelector('.module-h1')?.getBoundingClientRect();
      if(r) setTimeout(()=>celebrate(r.left+40,r.top+40),120);
    }
  }
}

/* ---------- wire up clicks ---------- */
document.addEventListener('click', e=>{
  const cd=e.target.closest('.concept-done');
  if(cd){ toggleConcept(cd.getAttribute('data-done'), e); return; }

  const ma=e.target.closest('#mark-all');
  if(ma){
    const code=ma.getAttribute('data-module');
    const ids=moduleIds(code);
    const {done,total}=moduleDone(code);
    if(done===total){ ids.forEach(i=>DONE.delete(i)); toast('Module reset','↺'); }
    else { ids.forEach(i=>DONE.add(i)); toast(`${code} marked complete!`,'🎉');
      const r=ma.getBoundingClientRect(); celebrate(r.left+r.width/2,r.top); }
    saveDone(DONE); refreshUI(); return;
  }

  const rs=e.target.closest('#reset-progress');
  if(rs){
    if(confirm('Reset all progress? This clears your checkmarks across all 16 modules.')){
      DONE=new Set(); saveDone(DONE); refreshUI(); toast('Progress reset','↺');
    } return;
  }

  // mobile nav
  if(e.target.closest('#menu-toggle')){ document.body.classList.toggle('nav-open'); }
  if(e.target.closest('#scrim')){ document.body.classList.remove('nav-open'); }
  if(e.target.closest('#sidebar a')){ document.body.classList.remove('nav-open'); }
});

/* ---------- resume link ---------- */
(function resume(){
  const last=localStorage.getItem(LS_LAST);
  const r=document.getElementById('resume-cta');
  if(r&&last){ r.href='m/'+last.toLowerCase()+'.html'; r.textContent='Resume '+last+' →'; }
  // record current module
  if(window.__ACTIVE__){ localStorage.setItem(LS_LAST,window.__ACTIVE__); }
})();

/* ---------- nav search ---------- */
(function search(){
  const inp=document.getElementById('nav-search'); if(!inp) return;
  inp.addEventListener('input',()=>{
    const q=inp.value.trim().toLowerCase();
    document.querySelectorAll('.nav-mod').forEach(a=>{
      const t=(a.textContent||'').toLowerCase();
      a.style.display = (!q||t.includes(q))?'':'none';
    });
    document.querySelectorAll('.nav-track').forEach(g=>{
      const any=[...g.querySelectorAll('.nav-mod')].some(a=>a.style.display!=='none');
      g.style.display=any?'':'none';
    });
  });
})();

/* ---------- the FIXED section number + reading progress + scrollspy ---------- */
(function scrollSpy(){
  const sections=[...document.querySelectorAll('.concept')];
  const indicator=document.getElementById('section-indicator');
  const fill=document.getElementById('progress-fill');
  const rail=[...document.querySelectorAll('.rail-item')];
  if(!sections.length){ if(indicator) indicator.classList.add('empty'); return; }

  function update(){
    // reading progress = scroll position through the document
    const sc=window.scrollY||document.documentElement.scrollTop;
    const h=document.documentElement.scrollHeight-window.innerHeight;
    const pct=h>0?Math.min(100,Math.max(0,sc/h*100)):0;
    if(fill) fill.style.width=pct+'%';

    // active section = the one whose top is just past the fixed bar
    const probe=70; // px below the topbar
    let active=sections[0];
    for(const s of sections){
      const top=s.getBoundingClientRect().top;
      if(top-probe<=0) active=s; else break;
    }
    const num=active.getAttribute('data-num');
    const title=active.querySelector('.concept-title')?.textContent.replace('★','').trim()||'';
    if(indicator){
      indicator.classList.remove('empty');
      indicator.innerHTML=`<span class="si-num">${num}</span><span class="si-title">${title}</span>`;
    }
    // rail active state
    const cid=active.getAttribute('data-cid');
    rail.forEach(r=>r.classList.toggle('active', r.getAttribute('data-cid')===cid));
    // scroll the active rail item into view (gently)
    const ar=rail.find(r=>r.classList.contains('active'));
    if(ar){ const rc=ar.getBoundingClientRect(), parent=ar.parentElement.parentElement;
      if(rc.top<120||rc.bottom>window.innerHeight-40){ ar.scrollIntoView({block:'nearest'}); } }
  }
  let ticking=false;
  function onScroll(){ if(!ticking){ requestAnimationFrame(()=>{update();ticking=false;}); ticking=true; } }
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll);
  update();
})();

/* ---------- mermaid render (called from inline module script) ---------- */
function renderMermaid(theme){
  const mm=window.__mermaid__; if(!mm) return;
  const nodes=[...document.querySelectorAll('.mermaid')].filter(n=>!n.getAttribute('data-processed'));
  nodes.forEach((n,i)=>{
    const src=n.textContent;
    n._src=src;
    const id='mmd-'+Math.random().toString(36).slice(2);
    mm.render(id,src).then(({svg,bindFunctions})=>{
      n.innerHTML=svg; n.setAttribute('data-processed','1');
      if(bindFunctions) bindFunctions(n);
    }).catch(err=>{ n.setAttribute('data-processed','err'); /* leave raw text */ });
  });
}
function reRenderMermaid(theme){
  const mm=window.__mermaid__; if(!mm) return;
  mm.initialize(theme==='light' ? (window.__mmLight__||{startOnLoad:false,theme:'default'}) : (window.__mmDark__||{startOnLoad:false,theme:'base'}));
  document.querySelectorAll('.mermaid').forEach(n=>{
    if(n._src){ n.textContent=n._src; n.removeAttribute('data-processed'); delete n.dataset.processed; }
  });
  renderMermaid(theme);
}
window.__renderMermaid__=()=>renderMermaid(document.documentElement.getAttribute('data-theme'));

/* ---------- keyboard: j/k between sections, [ ] between modules ---------- */
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea')) return;
  const secs=[...document.querySelectorAll('.concept')];
  if((e.key==='j'||e.key==='k')&&secs.length){
    const y=window.scrollY+80;
    let idx=secs.findIndex(s=>s.offsetTop>y); if(idx<0)idx=secs.length;
    const target= e.key==='j' ? secs[Math.min(idx,secs.length-1)] : secs[Math.max(0,idx-2)];
    if(target) window.scrollTo({top:target.offsetTop-66,behavior:'smooth'});
  }
});

/* ============================================================
   READING-COMFORT TOOLS (ADHD-friendly)
   font size · focus mode · bionic reading · reading ruler · calm mode
   ============================================================ */
const LS_PREFS='hpm.prefs.v1';
function loadPrefs(){ try{ return JSON.parse(localStorage.getItem(LS_PREFS)||'{}'); }catch(e){ return {}; } }
function savePrefs(p){ localStorage.setItem(LS_PREFS, JSON.stringify(p)); }
let PREFS=loadPrefs();

function applyPrefs(){
  // font size
  document.documentElement.setAttribute('data-fs', PREFS.fs||'M');
  document.querySelectorAll('.dock-seg button').forEach(b=>b.classList.toggle('on', b.dataset.fs===(PREFS.fs||'M')));
  // toggles
  document.body.classList.toggle('focus-mode', !!PREFS.focus);
  document.body.classList.toggle('calm-mode', !!PREFS.calm);
  document.documentElement.classList.toggle('bionic', !!PREFS.bionic);
  // dock button states
  document.querySelectorAll('.dock-opt[data-opt]').forEach(b=>{
    const o=b.dataset.opt;
    if(o==='theme') return;
    b.classList.toggle('on', !!PREFS[o]);
  });
  // ruler
  const ruler=document.getElementById('reading-ruler');
  if(ruler) ruler.hidden = !PREFS.ruler;
  document.querySelector('.dock-opt[data-opt="ruler"]')?.classList.toggle('on', !!PREFS.ruler);
  // apply derived effects
  if(PREFS.bionic) applyBionic(); else removeBionic();
  if(PREFS.calm) applyCalm();
  if(PREFS.focus) updateFocus();
}

/* ---- dock open/close ---- */
document.addEventListener('click',e=>{
  if(e.target.closest('#dock-toggle')){
    const p=document.getElementById('dock-panel'); if(p) p.hidden=!p.hidden; return;
  }
  if(!e.target.closest('#reading-dock')){ const p=document.getElementById('dock-panel'); if(p) p.hidden=true; }

  const fsBtn=e.target.closest('.dock-seg button[data-fs]');
  if(fsBtn){ PREFS.fs=fsBtn.dataset.fs; savePrefs(PREFS); applyPrefs(); return; }

  const opt=e.target.closest('.dock-opt[data-opt]');
  if(opt){
    const o=opt.dataset.opt;
    if(o==='theme'){
      const cur=document.documentElement.getAttribute('data-theme');
      const nt=cur==='dark'?'light':'dark'; applyTheme(nt); localStorage.setItem(LS_THEME,nt); reRenderMermaid(nt); return;
    }
    PREFS[o]=!PREFS[o]; savePrefs(PREFS); applyPrefs();
    if(o==='focus'&&PREFS.focus) toast('Focus mode on — everything else dims','◎');
    if(o==='bionic'&&PREFS.bionic) toast('Bionic reading on','𝐛');
    if(o==='calm'&&PREFS.calm) toast('Calm mode — diagrams hidden until you click','🍃');
    return;
  }

  // calm-mode reveal on click
  const blurred=e.target.closest('.mermaid, .pass-visual img');
  if(blurred && document.body.classList.contains('calm-mode') && !blurred.classList.contains('revealed')){
    blurred.classList.add('revealed'); blurred.querySelector?.('.reveal-tag')?.remove(); e.preventDefault();
  }
});

/* ---- BIONIC: bold the leading chunk of each word in prose paragraphs/list items ---- */
function bionicWord(w){
  if(w.length<=1) return w;
  const n = w.length<=3?1 : w.length<=6?2 : Math.ceil(w.length*0.42);
  return '<b class="bi">'+w.slice(0,n)+'</b>'+w.slice(n);
}
function applyBionic(){
  document.querySelectorAll('.concept-body p, .concept-body li').forEach(el=>{
    if(el.dataset.bionic) return;
    el.dataset.orig = el.innerHTML;
    // walk text nodes only (skip code/links/strong markup targets lightly)
    const walk=node=>{
      for(const child of [...node.childNodes]){
        if(child.nodeType===3){ // text
          const html=child.textContent.replace(/([A-Za-zÀ-ɏ]{2,})/g, m=>bionicWord(m));
          if(html!==child.textContent){ const span=document.createElement('span'); span.innerHTML=html; child.replaceWith(span); }
        } else if(child.nodeType===1 && !/^(CODE|A|PRE)$/.test(child.tagName)){ walk(child); }
      }
    };
    walk(el); el.dataset.bionic='1';
  });
}
function removeBionic(){
  document.querySelectorAll('.concept-body [data-bionic]').forEach(el=>{
    if(el.dataset.orig!=null){ el.innerHTML=el.dataset.orig; delete el.dataset.orig; delete el.dataset.bionic; }
  });
}

/* ---- CALM: tag blurred media with a 'click to reveal' overlay ---- */
function applyCalm(){
  document.querySelectorAll('.mermaid, .pass-visual .concept-body img').forEach(el=>{
    if(el.classList.contains('revealed')||el.querySelector?.('.reveal-tag')) return;
    if(el.tagName==='IMG'){ /* imgs can't hold children; wrap */ return; }
    const tag=document.createElement('div'); tag.className='reveal-tag'; tag.textContent='🍃 click to reveal diagram';
    el.style.position='relative'; el.appendChild(tag);
  });
}

/* ---- FOCUS: mark the section nearest the top as active ---- */
let focusEls=[];
function updateFocus(){
  if(!document.body.classList.contains('focus-mode')) return;
  if(!focusEls.length) focusEls=[...document.querySelectorAll('.concept')];
  const probe=120; let active=focusEls[0];
  for(const s of focusEls){ if(s.getBoundingClientRect().top-probe<=0) active=s; else break; }
  focusEls.forEach(s=>s.classList.toggle('focus-active', s===active));
}

/* ---- READING RULER follows the cursor ---- */
document.addEventListener('mousemove',e=>{
  if(!PREFS.ruler) return;
  const r=document.getElementById('reading-ruler'); if(!r) return;
  r.style.top=(e.clientY-21)+'px';
},{passive:true});

/* hook focus updates into scroll */
window.addEventListener('scroll',()=>{ if(PREFS.focus) updateFocus(); },{passive:true});

/* keyboard: f = focus toggle */
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea')) return;
  if(e.key==='f'){ PREFS.focus=!PREFS.focus; savePrefs(PREFS); applyPrefs(); toast(PREFS.focus?'Focus mode on':'Focus mode off','◎'); }
});

applyPrefs();

/* one-time discoverability hint on the reading-tools dock */
(function dockHint(){
  if(localStorage.getItem('hpm.dockhint')) return;
  const b=document.getElementById('dock-toggle');
  if(b){ b.classList.add('hint'); setTimeout(()=>b.classList.remove('hint'),6500); }
  // mark seen once they open it OR after a while
  const seen=()=>{ localStorage.setItem('hpm.dockhint','1'); b&&b.classList.remove('hint'); };
  document.getElementById('dock-toggle')?.addEventListener('click',seen,{once:true});
  setTimeout(seen,8000);
})();

/* ---------- init ---------- */
refreshUI();
})();
