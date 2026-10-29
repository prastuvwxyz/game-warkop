import { chromium, devices } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:3101/bullscows/';
let pass=0,failN=0; const check=(n,ok,x='')=>{ok?pass++:failN++;console.log((ok?'PASS ':'FAIL ')+n+(ok?'':'  '+x));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browser = await chromium.launch(); // REAL autoplay policy, no flag
const init=()=>{window.__osc=0;window.__oscT=[];const P=AudioContext.prototype;const co=P.createOscillator;P.createOscillator=function(){window.__osc++;window.__oscT.push(performance.now());return co.apply(this,arguments);};const rs=P.resume;P.resume=function(){window.__resumeCalls=(window.__resumeCalls||0)+1;return rs.apply(this,arguments);};};
const ctxA=await browser.newContext({viewport:{width:1200,height:900}}); const ctxB=await browser.newContext({...devices['iPhone 12']});
await ctxA.addInitScript(init); await ctxB.addInitScript(init);
const A=await ctxA.newPage(), B=await ctxB.newPage();
const errors=[]; for(const [n,p] of [['A',A],['B',B]]){p.on('pageerror',e=>errors.push(n+': '+e.message));p.on('console',m=>{if(m.type()==='error')errors.push(n+' console: '+m.text());});}
const au=p=>p.evaluate(()=>({ctx:!!window.__bc.audio.ctx,state:window.__bc.audio.ctx&&window.__bc.audio.ctx.state,music:!!window.__bc.audio.nodes,started:window.__bc.audio.started,osc:window.__osc,resumeCalls:window.__resumeCalls||0}));
const typeNum=async(p,padId,num)=>{for(const d of num)await p.click(`#${padId} [data-k="${d}"]`);await p.click(`#${padId} [data-k="ok"]`);};

// fresh load, first gesture
await A.goto(URL); await sleep(300);
await A.click('#name'); const a0=await au(A); await sleep(400); const a1=await au(A);
console.log('A right after first gesture:',JSON.stringify(a0)); console.log('A 400ms later:',JSON.stringify(a1));
check('fresh load: ctx running after gesture', a1.state==='running', JSON.stringify(a1));
check('fresh load: first chord played (osc>=9) — real autoplay policy', a1.osc>=9, 'osc='+a1.osc);

await A.keyboard.type('Pras'); await A.click('#btnCreate'); await A.waitForSelector('#scr-lobby.active');
const code=(await A.textContent('#lobbyCode')).trim();
await B.goto(URL+'?room='+code); await sleep(300); await B.click('#name'); await B.keyboard.type('Budi'); await B.click('#btnJoin'); await B.waitForSelector('#scr-lobby.active');
await A.waitForFunction(()=>window.__bc.state.players.length===2);
await typeNum(A,'secretPad','3657'); await typeNum(B,'secretPad','1234');
await A.waitForSelector('#btnStart:not([disabled])'); await A.click('#btnStart');
await A.waitForSelector('#scr-game.active'); await B.waitForSelector('#scr-game.active'); await sleep(300);

// mid-game refresh on B (mobile)
const bBefore=await au(B); console.log('B before reload:',JSON.stringify(bBefore));
await B.reload(); await B.waitForSelector('#scr-game.active'); await sleep(400);
const b0=await au(B); console.log('B after reload, before gesture:',JSON.stringify(b0));
check('after reload: no ctx before gesture', !b0.ctx, JSON.stringify(b0));
// first gesture = tap a keypad digit (what a player actually does)
const myTurnB=await B.evaluate(()=>window.__bc.state.turn===window.__bc.me);
const digit = myTurnB ? '5' : null;
if(digit){await B.click(`#guessPad [data-k="${digit}"]`);} else {await B.tap('#roomPill');}
const b1=await au(B); await sleep(600); const b2=await au(B);
console.log('B right after gesture:',JSON.stringify(b1)); console.log('B 600ms later:',JSON.stringify(b2));
check('after reload: ctx running after first tap', b2.state==='running', JSON.stringify(b2));
check('after reload: music nodes exist', b2.music);
check('after reload: first chord played (osc>=9)', b2.osc>=9, 'osc='+b2.osc);
// wait 9s: does chord #2 arrive via setInterval?
await sleep(8600); const b3=await au(B); console.log('B 9s later:',JSON.stringify(b3));
check('chord arrives by 9s (osc>=9)', b3.osc>=9, 'osc='+b3.osc);
console.log('errors:',errors); console.log(`done ${pass} pass / ${failN} fail`);
await browser.close();
