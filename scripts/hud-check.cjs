/**
 * Persistent-HUD check (docs/specs/persistent-hud-2026-10-30.md): visits home and every world at 412×915 and asserts the core
 * buttons are present, tappable and overlap nothing; no galaxy-camera control survives in a world; no world control is covered;
 * Settings opens above the world. MOVES the brain between worlds — run against a test brain.
 *   BASE_URL=http://localhost:3001 SPACE_ID=<brain key> node scripts/hud-check.cjs [world ...]
 */
const { chromium } = require('playwright'); const fs=require('fs');
const S='./hud-check-out'; fs.mkdirSync(S,{recursive:true});
const BASE=(process.env.BASE_URL||'http://localhost:3001').replace(/\/$/,'');
const ID=process.env.SPACE_ID; if(!ID){console.error('Set SPACE_ID to the brain key to test.');process.exit(2);} const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const H={'x-space-id':ID,'content-type':'application/json'}; const api=async(p,b)=>(await fetch(BASE+'/api/travel'+p,{method:b?'POST':'GET',headers:H,body:b&&JSON.stringify(b)})).json();
async function travelTo(w){ let st=await api('/state'); if(st.activeJourney) await api('/arrive',{journeyId:st.activeJourney.id}); st=await api('/state'); if(st.currentWorld===w) return;
 const d=await api('/depart',{clientKey:'h'+Date.now(),kind:'drift',destination:w}); await sleep(11000); await api('/state'); await api('/arrive',{journeyId:d.journey.id}); }
const CORE=['Tools','Panels','Settings','Talk to Soumaya','Add a memory','Open the Observatory home','Search your memories','Ambient music'];
const probe=(core)=>{const R=e=>e.getBoundingClientRect(); const vis=e=>{const r=R(e),cs=getComputedStyle(e);return r.width>1&&r.height>1&&cs.visibility!=='hidden'&&cs.display!=='none'&&cs.opacity!=='0'&&r.bottom>0&&r.top<innerHeight;};
 const all=[...document.querySelectorAll('button,[role=button],summary,a[href]')].filter(vis);
 const lab=e=>(e.getAttribute('aria-label')||e.innerText||e.title||'').trim();
 const found={},hit={},boxes={}; for(const c of core){const e=all.find(x=>lab(x).startsWith(c)); found[c]=!!e; if(e){const r=R(e);const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);hit[c]=!!t&&(t===e||e.contains(t)); boxes[c]=r;}}
 const world=[...document.querySelectorAll('.worlds-surface button, .worlds-surface [role=button], .worlds-surface summary')].filter(vis);
 const covered=world.filter(w=>{const r=R(w); if(r.x+r.width/2>=innerWidth-2||r.x+r.width/2<=2) return false; const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return !(t&&(t===w||w.contains(t)||t.contains(w)));}).map(w=>lab(w).slice(0,24));
 const overlaps=[]; for(const [c,b] of Object.entries(boxes)){ for(const w of world){const r=R(w); const ix=Math.min(b.right,r.right)-Math.max(b.left,r.left), iy=Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top); if(ix>6&&iy>6) overlaps.push(c+' x '+lab(w).slice(0,22)); }}
 const camera=['Recenter galaxy','Zoom in','Zoom out','Camera focus targets','Galaxy views'].filter(c=>all.some(x=>lab(x).startsWith(c)));
 return {covered,missing:core.filter(c=>!found[c]),notTappable:core.filter(c=>found[c]&&!hit[c]),overlaps,cameraLeft:camera,inWorld:document.body.classList.contains('in-world')};};
(async()=>{ const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
 const worlds=process.argv.slice(2).length?process.argv.slice(2):['home','great-station','growing-place','deep-past','people','quiet-archive','scale','eternity'];
 let bad=0;
 for(const w of worlds){ await travelTo(w); const p=await b.newPage({viewport:{width:412,height:915}}); const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,100)));
  await p.addInitScript(i=>{localStorage.setItem('brain.spaceId',i);localStorage.setItem(`brain.legendSeen.${i}`,'1');localStorage.setItem('worlds.lookHintSeen','1');['great-station','growing-place','deep-past','people','quiet-archive','scale','eternity'].forEach(x=>localStorage.setItem('worlds.purposeSeen.'+x,'1'));},ID);
  await p.goto(BASE+'/'); await sleep(8000); await p.getByText("Let's go").click().catch(()=>{}); await sleep(500);
  await p.getByRole('button',{name:/Close and enter/}).click().catch(()=>{}); await sleep(1500);
  if(w!=='home'){ await p.evaluate(()=>window.dispatchEvent(new Event('worlds:enter'))); await p.waitForSelector('.worlds-surface canvas',{timeout:60000}).catch(()=>{}); await sleep(6000); }
  await p.evaluate(()=>{document.querySelectorAll('.toast-dismiss,.perf-suggest button:last-child').forEach(b=>b.click());}); await sleep(600);
  const r=await p.evaluate(probe,CORE); await p.screenshot({path:`${S}/hudpre-${w}.png`});
  let settingsAbove='n/a'; if(w!=='home'){ await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Settings'); b&&b.click();}); await p.waitForSelector('.settings-overlay',{timeout:20000}).catch(()=>{}); await sleep(500);
    settingsAbove=await p.evaluate(()=>{const e=document.querySelector('.settings-overlay'); if(!e) return 'no panel'; const r=e.getBoundingClientRect(); const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return t&&e.contains(t)?'opens above the world':'covered'; }); }
  await p.screenshot({path:`${S}/hud-${w}.png`});
  const ok=!r.missing.length&&!r.notTappable.length&&!r.overlaps.length&&!r.covered.length&&(w==='home'||(!r.cameraLeft.length&&r.inWorld&&settingsAbove==='opens above the world')); if(!ok)bad++;
  console.log((ok?'PASS ':'FAIL ')+w.padEnd(14),JSON.stringify({missing:r.missing,notTappable:r.notTappable,overlaps:r.overlaps,covered:r.covered,cameraLeft:w==='home'?undefined:r.cameraLeft,settings:settingsAbove,errors:errs}));
  await p.close(); await sleep(7000); }
 await b.close(); console.log(bad?bad+' scene(s) FAILED':'ALL SCENES PASS'); })();
