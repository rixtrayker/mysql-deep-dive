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
  mm.initialize({startOnLoad:false, theme: theme==='light'?'default':'dark'});
  document.querySelectorAll('.mermaid').forEach(n=>{
    if(n._src){ n.textContent=n._src; n.removeAttribute('data-processed'); }
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

/* ---------- init ---------- */
refreshUI();
})();
