// Simulates the iOS Safari path: a pointerdown that carries no user activation (touch pointerdown on Safari), then the real tap.
import { chromium, devices } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:3101/bullscows/';
let pass=0,failN=0; const check=(n,ok,x='')=>{ok?pass++:failN++;console.log((ok?'PASS ':'FAIL ')+n+(ok?'':'  '+x));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await chromium.launch({args:['--autoplay-policy=user-gesture-required']});
const init=()=>{window.__osc=0;const P=AudioContext.prototype;const co=P.createOscillator;P.createOscillator=function(){window.__osc++;return co.apply(this,arguments);};const OC=window.AudioContext;window.AudioContext=function(){const c=new OC();const rs=c.resume.bind(c);c.suspend();c.resume=()=>navigator.userActivation.hasBeenActive?rs():new Promise(()=>{});return c;};window.AudioContext.prototype=OC.prototype;};
const ctx=await browser.newContext({...devices['iPhone 12']}); await ctx.addInitScript(init);
const p=await ctx.newPage(); const errors=[]; p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const au=()=>p.evaluate(()=>({state:window.__bc.audio.ctx&&window.__bc.audio.ctx.state,music:!!window.__bc.audio.nodes,started:window.__bc.audio.started,osc:window.__osc,wait:document.getElementById('btnMusic').classList.contains('wait')}));
await p.goto(URL); await sleep(300);
check('music button pulses (waiting for tap) before any gesture', (await au()).wait);
// untrusted pointerdown = no activation → ctx created suspended, resume() pending
await p.evaluate(()=>document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))); await sleep(400);
const s1=await au(); console.log('after activation-less pointerdown:',JSON.stringify(s1));
check('ctx suspended, NOT marked started, no music nodes yet', s1.state==='suspended'&&!s1.started&&!s1.music, JSON.stringify(s1));
// real tap (touchend/pointerdown with activation)
await p.tap('#name'); await sleep(500);
const s2=await au(); console.log('after real tap:',JSON.stringify(s2));
check('real tap → running, started, music nodes, first chord played (osc>=9)', s2.state==='running'&&s2.started&&s2.music&&s2.osc>=9, JSON.stringify(s2));
check('pulse hint cleared once music started', !s2.wait);
// hidden → suspended for 9 s → visible: next chord must arrive within ~1 s, not up to 8 s
await p.evaluate(()=>window.__bc.audio.ctx.suspend()); await sleep(9000);
const o0=(await au()).osc; await p.evaluate(()=>{const n=window.__bc.audio.nodes;if(n)n.nextAt=window.__bc.audio.ctx.currentTime;}); await p.evaluate(()=>window.__bc.audio.ctx.resume()); await sleep(1200);
const o1=(await au()).osc; console.log('osc before/after resume:',o0,o1);
check('no chord scheduled while suspended', o0===s2.osc, o0+' vs '+s2.osc);
check('chord catches up within 1.2 s after resume (+8 osc)', o1-o0>=8, 'delta='+(o1-o0));
console.log('errors:',errors); console.log(`done ${pass} pass / ${failN} fail`); await browser.close();
