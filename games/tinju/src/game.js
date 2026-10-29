(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const VERSION='1.0.0';
// Mirror of the server CFG for DISPLAY only (the server is the authority and sends HP/timings in state.cfg).
const CFG={HP:100,COUNTDOWN_MS:2400,GRACE_MS:1500,WORD_CAP_MS:20000,RESULT_MS:1400,BLOCK_MS:400,JAB_MS:1000,CRIT_CPS:5,COMBO_STREAK:3,ULTI_X:2.5,CAP:60,
  ANIM_MS:{jab:300,uppercut:450,block:350,ouch:500,ko:900}};
const LS_NAME='tk_name',LS_SESS='tk_sess',LS_SKIN='tk_skin';
const SKINS=[{n:'Biru',c:'#3f7fd9',d:'#2c5aa6',g:'#e0453f'},{n:'Merah',c:'#e0554a',d:'#a93a31',g:'#2e63b8'},{n:'Hijau',c:'#43a56c',d:'#2d7a4d',g:'#f0b93a'},{n:'Kuning',c:'#f0b93a',d:'#bf8a1c',g:'#7a4bd0'}];
let ws=null,S=null,me=null,sess=null,offset=0,retry=0,retryTimer=null,intent=null,connected=false;
let lastCount=0,W=null,typed='',bad='',typos=0,revealT=0,sentDone=false,cd=null,lastRes=null,endApplied=false,tilesKey='';
const RM=()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}};
const lsGet=(k,d)=>{try{const v=localStorage.getItem(k);return v==null?d:v;}catch(e){return d;}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v);}catch(e){}};

// ---------- theme ----------
const LS_THEME='tk_theme';
function applyTheme(t){document.documentElement.dataset.theme=t;$('btnTheme').textContent=t==='dark'?'☀':'☾';$('themeColor').content=t==='dark'?'#1a1f1c':'#eef3ec';}
applyTheme((()=>{try{return localStorage.getItem(LS_THEME)||'light';}catch(e){return 'light';}})());
$('btnTheme').onclick=()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(LS_THEME,t);}catch(e){}applyTheme(t);};

// ---------- audio (all synthesized with Web Audio — no files) ----------
const LS_SND='tk_snd';
const AU={ctx:null,master:null,sfx:true,music:true,nodes:null,started:false};
try{const s=JSON.parse(localStorage.getItem(LS_SND)||'{}');if(typeof s.sfx==='boolean')AU.sfx=s.sfx;if(typeof s.music==='boolean')AU.music=s.music;}catch(e){}
function saveSnd(){try{localStorage.setItem(LS_SND,JSON.stringify({sfx:AU.sfx,music:AU.music}));}catch(e){}}
function actx(){if(AU.ctx)return AU.ctx;const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;try{AU.ctx=new C();}catch(e){return null;}AU.master=AU.ctx.createGain();AU.master.gain.value=1;AU.master.connect(AU.ctx.destination);return AU.ctx;}
function unlock(){const c=actx();if(!c)return;const go=()=>{if(AU.started)return;AU.started=true;sndUI();if(AU.music)startMusic();};if(c.state==='running')go();else c.resume().then(()=>{if(c.state==='running')go();}).catch(()=>{});}
['pointerdown','keydown','touchend'].forEach(ev=>document.addEventListener(ev,unlock,{passive:true}));
function tone(freq,dur,o){const c=AU.ctx;if(!c||!AU.sfx||c.state!=='running')return;o=o||{};const t0=c.currentTime+(o.at||0);const osc=c.createOscillator(),g=c.createGain();osc.type=o.type||'sine';osc.frequency.setValueAtTime(freq,t0);if(o.to)osc.frequency.exponentialRampToValueAtTime(o.to,t0+dur);const v=o.vol||.1;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(v,t0+.01);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);osc.connect(g);g.connect(AU.master);osc.start(t0);osc.stop(t0+dur+.05);}
const SFX={
  tap(){tone(660,.07,{vol:.07});},
  err(){tone(210,.28,{type:'triangle',to:140,vol:.09});},
  win(){[523,659,784,1047,1319].forEach((q,i)=>tone(q,.6,{at:i*.11,vol:.1}));},
  lose(){[440,392,330].forEach((q,i)=>tone(q,.45,{type:'triangle',at:i*.18,vol:.08}));},
  join(){tone(880,.12,{vol:.05});tone(1175,.22,{at:.1,vol:.05});},
  set(){tone(659,.12,{vol:.06});tone(880,.25,{at:.09,vol:.06});},
  // new in Tinju Kata (oscillator counts are tested by test-audio.mjs, RFC 4.4)
  roundBell(){tone(988,.7,{type:'triangle',vol:.1});tone(1976,.5,{type:'sine',vol:.05});},                       // 2
  punch(){tone(150,.14,{type:'square',to:60,vol:.1});tone(90,.2,{type:'sawtooth',to:40,vol:.1,at:.02});},       // 2
  block(){tone(320,.12,{type:'square',to:200,vol:.07});},                                                        // 1
  uppercut(){tone(130,.2,{type:'sawtooth',to:50,vol:.12});tone(260,.25,{type:'square',to:90,vol:.08,at:.06});tone(880,.35,{type:'triangle',vol:.06,at:.12});}, // 3
  koBell(){[784,1175,1568].forEach((q,i)=>tone(q,.9,{type:'triangle',at:i*.28,vol:.1}));}                       // 3
};

// calm pad: Cmaj7 → Am7 → Dm7 → G6, 8 s each, detuned triangles through a slowly breathing low-pass + soft rain bed
const CHORDS=[[130.81,196,246.94,329.63],[110,164.81,220,261.63],[146.83,220,261.63,349.23],[98,146.83,196,246.94]];
function startMusic(){const c=actx();if(!c||AU.nodes)return;const bus=c.createGain();bus.gain.setValueAtTime(0,c.currentTime);bus.gain.linearRampToValueAtTime(.055,c.currentTime+3);
  const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=650;lp.Q.value=.6;const lfo=c.createOscillator();lfo.frequency.value=.06;const lfoG=c.createGain();lfoG.gain.value=220;lfo.connect(lfoG);lfoG.connect(lp.frequency);lfo.start();lp.connect(bus);bus.connect(AU.master);
  const len=c.sampleRate*2,buf=c.createBuffer(1,len,c.sampleRate),d=buf.getChannelData(0);let last=0;for(let i=0;i<len;i++){const w=Math.random()*2-1;last=(last+.02*w)/1.02;d[i]=last*3.5;}
  const nz=c.createBufferSource();nz.buffer=buf;nz.loop=true;const nf=c.createBiquadFilter();nf.type='lowpass';nf.frequency.value=380;const ng=c.createGain();ng.gain.value=.3;nz.connect(nf);nf.connect(ng);ng.connect(bus);nz.start();
  let idx=0;const CH=8;const play=()=>{if(c.state!=='running')return;const t=c.currentTime;AU.nodes&&(AU.nodes.nextAt=t+CH);const ch=CHORDS[idx++%CHORDS.length];ch.forEach(f=>{[-5,5].forEach(dt=>{const o=c.createOscillator();o.type='triangle';o.frequency.value=f;o.detune.value=dt;const g=c.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.2,t+2.5);g.gain.setValueAtTime(.2,t+CH-2.5);g.gain.linearRampToValueAtTime(0,t+CH+.6);o.connect(g);g.connect(lp);o.start(t);o.stop(t+CH+1);});});};
  AU.nodes={bus,lfo,nz,nextAt:0};AU.nodes.tm=setInterval(()=>{const n=AU.nodes;if(!n||c.state!=='running')return;if(c.currentTime>=n.nextAt-.5)play();},500);play();}
function stopMusic(){const n=AU.nodes;if(!n)return;const c=AU.ctx,t=c.currentTime;n.bus.gain.cancelScheduledValues(t);n.bus.gain.setValueAtTime(n.bus.gain.value,t);n.bus.gain.linearRampToValueAtTime(0,t+1);clearInterval(n.tm);setTimeout(()=>{try{n.lfo.stop();n.nz.stop();n.bus.disconnect();}catch(e){}},1500);AU.nodes=null;}
function sndUI(){$('btnMusic').classList.toggle('off',!AU.music);$('btnMusic').classList.toggle('wait',AU.music&&!AU.started);$('btnSfx').classList.toggle('off',!AU.sfx);}
sndUI();
$('btnMusic').onclick=()=>{AU.music=!AU.music;saveSnd();sndUI();if(AU.music){unlock();startMusic();}else stopMusic();toast(AU.music?'Musik latar: nyala':'Musik latar: mati');};
$('btnSfx').onclick=()=>{AU.sfx=!AU.sfx;saveSnd();sndUI();if(AU.sfx){unlock();setTimeout(SFX.set,30);}toast(AU.sfx?'Efek suara: nyala':'Efek suara: mati');};
document.addEventListener('visibilitychange',()=>{const c=AU.ctx;if(!c)return;if(document.visibilityState==='hidden')c.suspend().catch(()=>{});else if(AU.started&&c.state!=='running')c.resume().catch(()=>{});});

// ---------- connection ----------
function wsUrl(){const base=location.pathname.replace(/\/[^/]*$/,'');return (location.protocol==='https:'?'wss://':'ws://')+location.host+base+'/ws';}
function connect(){
  clearTimeout(retryTimer);
  try{ws=new WebSocket(wsUrl());}catch(e){scheduleRetry();return;}
  ws.onopen=()=>{connected=true;retry=0;$('connDot').classList.add('on');
    if(sess)send({t:'rejoin',code:sess.code,token:sess.token});
    else if(intent){send(intent);intent=null;}
  };
  ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data);}catch(e){return;}onMsg(m);};
  ws.onclose=()=>{connected=false;$('connDot').classList.remove('on');ws=null;scheduleRetry();};
  ws.onerror=()=>{try{ws.close();}catch(e){}};
}
function scheduleRetry(){clearTimeout(retryTimer);const d=Math.min(10000,500*Math.pow(2,retry++));retryTimer=setTimeout(connect,d);}
function send(o){if(ws&&ws.readyState===1){ws.send(JSON.stringify(o));return true;}if(o.t==='create'||o.t==='join'){intent=o;if(!ws)connect();}else toast('Koneksi terputus, menyambung ulang…');return false;}
function saveSess(s){sess=s;try{if(s)localStorage.setItem(LS_SESS,JSON.stringify(s));else localStorage.removeItem(LS_SESS);}catch(e){}}

// ---------- boxers (canvas, chunky blobs) ----------
const cv=$('cv'),cx=cv.getContext('2d');
const B=[{skin:0,anim:'idle',t0:0,power:1},{skin:1,anim:'idle',t0:0,power:1}]; // B[0] = me (left), B[1] = opponent (right)
const animLog=[];
let CW=0,CH=180,DPR=1,raf=0,fxState='';
function ease(x){x=x<0?0:x>1?1:x;return x*x*(3-2*x);}
function lerp(a,b,k){return a+(b-a)*k;}
function logAnim(why){animLog.push({t:Math.round(performance.now()),l:B[0].anim,r:B[1].anim,why});if(animLog.length>400)animLog.shift();$('arena').dataset.anim=B[0].anim+':'+B[1].anim;}
// reduced motion: one-shot anims are skipped (pose stays idle); ko/win jump straight to their final pose.
function setAnim(i,anim,power){
  if(RM()&&(anim==='jab'||anim==='uppercut'||anim==='block'||anim==='ouch'))return;
  B[i].anim=anim;B[i].t0=performance.now();B[i].power=power||1;logAnim('set '+i);
}
function resetAnims(){if(B[0].anim!=='idle'||B[1].anim!=='idle'){B[0].anim='idle';B[1].anim='idle';logAnim('reset');}}
function pose(anim,t0,now,power){
  const el=now-t0,o={ox:0,oy:0,rot:0,fgx:30,fgy:-76,bgx:16,bgy:-70,eyes:'o',mouth:'n',stars:false};
  const bob=RM()?0:Math.sin(now/180);
  if(anim==='idle'){o.oy=bob*2.2;o.fgy+=bob*2;o.bgy-=bob*2;return o;}
  if(anim==='jab'){const p=ease(el/CFG.ANIM_MS.jab),r=p<.4?p/.4:1-(p-.4)/.6;const k=ease(r);o.fgx=30+k*62;o.fgy=-76+k*-2;o.ox=k*12;o.mouth='n';return o;}
  if(anim==='uppercut'){const p=el/CFG.ANIM_MS.uppercut;
    if(p<.3){const k=ease(p/.3);o.fgx=24-8*k;o.fgy=-70+24*k;o.oy=7*k;o.ox=-4*k;}
    else if(p<.7){const k=ease((p-.3)/.4);o.fgx=16+36*k;o.fgy=-46-72*k;o.oy=7-20*k;o.ox=-4+26*k;o.mouth='o';}
    else{const k=ease((p-.7)/.3);o.fgx=lerp(52,30,k);o.fgy=lerp(-118,-76,k);o.oy=lerp(-13,0,k);o.ox=lerp(22,0,k);}
    return o;}
  if(anim==='block'){const p=el/CFG.ANIM_MS.block,k=p<.2?ease(p/.2):p>.8?ease((1-p)/.2):1;o.fgx=lerp(30,27,k);o.fgy=lerp(-76,-88,k);o.bgx=lerp(16,22,k);o.bgy=lerp(-70,-84,k);o.ox=-5*k;o.oy=2*k;o.eyes='-';return o;}
  if(anim==='ouch'){const p=el/CFG.ANIM_MS.ouch,s=Math.sin(Math.PI*Math.min(1,p));o.ox=-s*14*power;o.rot=-.22*s*power;o.fgx=20;o.fgy=-54;o.bgx=6;o.bgy=-60;o.eyes='>';o.mouth='o';return o;}
  if(anim==='ko'){const p=ease(el/CFG.ANIM_MS.ko);o.ox=-34*p;o.rot=-1.5*p;o.oy=-10*p;o.fgx=22;o.fgy=-58;o.bgx=8;o.bgy=-60;o.eyes='x';o.mouth='f';o.stars=!RM();return o;}
  if(anim==='win'){const h=RM()?0:Math.abs(Math.sin(now/170));o.oy=-h*12;o.fgx=40;o.fgy=-122;o.bgx=-4;o.bgy=-124;o.eyes='^';o.mouth='s';return o;}
  return o;
}
function blob(c,x,y,rx,ry,fill,line){c.beginPath();c.ellipse(x,y,rx,ry,0,0,6.2832);c.fillStyle=fill;c.fill();if(line!==false){c.lineWidth=2.2;c.strokeStyle='rgba(30,30,30,.55)';c.stroke();}}
function drawBoxer(c,sk,o,flip,x,y,s,now){
  const K=SKINS[sk%4],FACE='#f6d0a8';
  c.save();c.translate(x,y);if(flip)c.scale(-1,1);c.scale(s,s);
  c.fillStyle='rgba(0,0,0,.16)';c.beginPath();c.ellipse(0,2,30,6,0,0,6.2832);c.fill();
  c.translate(o.ox,o.oy-8);c.rotate(o.rot);c.translate(0,8);
  const arm=(sx,sy,gx,gy)=>{c.lineCap='round';c.lineWidth=12;c.strokeStyle='rgba(30,30,30,.5)';c.beginPath();c.moveTo(sx,sy);c.lineTo(gx,gy);c.stroke();c.lineWidth=9;c.strokeStyle=FACE;c.beginPath();c.moveTo(sx,sy);c.lineTo(gx,gy);c.stroke();blob(c,gx,gy,12,11.5,K.g);blob(c,gx-3,gy-4,3.4,3,'rgba(255,255,255,.55)',false);};
  arm(-10,-62,o.bgx,o.bgy);                                   // back arm
  blob(c,-12,-17,8,13,FACE);blob(c,10,-17,8,13,FACE);         // legs
  blob(c,-14,-4,13,6,'#3a3a3a');blob(c,10,-4,13,6,'#3a3a3a'); // shoes
  blob(c,0,-48,26,28,K.c);blob(c,-8,-56,9,12,'rgba(255,255,255,.18)',false); // torso + shine
  c.beginPath();c.roundRect(-23,-34,46,17,7);c.fillStyle=K.d;c.fill();c.lineWidth=2.2;c.strokeStyle='rgba(30,30,30,.55)';c.stroke(); // shorts
  c.fillStyle='rgba(255,255,255,.7)';c.fillRect(-23,-27,46,3);
  blob(c,-14,-88,5,6,FACE);                                   // ear
  blob(c,4,-88,21,21,FACE);                                   // head
  c.beginPath();c.ellipse(2,-104,19,8,0,3.14,6.2832);c.fillStyle='#4a3426';c.fill();               // hair
  c.fillStyle=K.c;c.fillRect(-15,-98,40,5);                                                        // headband
  const ex=[9,20],ey=-89;
  if(o.eyes==='o'){ex.forEach(px=>{blob(c,px,ey,4.4,5,'#fff');blob(c,px+1.6,ey+.5,2.2,2.6,'#222',false);});}
  else{c.lineWidth=2.6;c.lineCap='round';c.strokeStyle='#222';ex.forEach(px=>{c.beginPath();
    if(o.eyes==='x'){c.moveTo(px-3.5,ey-3.5);c.lineTo(px+3.5,ey+3.5);c.moveTo(px+3.5,ey-3.5);c.lineTo(px-3.5,ey+3.5);}
    else if(o.eyes==='>'){c.moveTo(px-3.5,ey-3.5);c.lineTo(px+2,ey);c.lineTo(px-3.5,ey+3.5);}
    else if(o.eyes==='^'){c.arc(px,ey+2,4,3.4,6.0);}
    else{c.moveTo(px-4,ey);c.lineTo(px+4,ey);}
    c.stroke();});}
  c.lineWidth=2.4;c.strokeStyle='#7a2b22';c.beginPath();
  if(o.mouth==='o'){c.fillStyle='#7a2b22';c.arc(16,-78,4,0,6.2832);c.fill();}
  else if(o.mouth==='s'){c.arc(15,-80,6,.15,2.9);c.stroke();}
  else if(o.mouth==='f'){c.moveTo(11,-77);c.lineTo(21,-77);c.stroke();}
  else{c.moveTo(12,-77);c.quadraticCurveTo(16,-75,21,-78);c.stroke();}
  arm(12,-62,o.fgx,o.fgy);                                    // front arm
  if(o.stars){for(let i=0;i<3;i++){const a=now/260+i*2.094;const sx=4+Math.cos(a)*19,sy=-116+Math.sin(a)*5;c.fillStyle='#f6c945';c.beginPath();for(let k=0;k<10;k++){const r=k%2?2.5:5.5,an=k*.628-1.57;c.lineTo(sx+Math.cos(an)*r,sy+Math.sin(an)*r);}c.closePath();c.fill();}}
  c.restore();
}
function sizeCanvas(){
  const w=Math.max(1,Math.min(520,Math.round($('arena').clientWidth)));const d=window.devicePixelRatio||1;
  if(w!==CW||d!==DPR){CW=w;DPR=d;cv.width=Math.round(w*d);cv.height=Math.round(CH*d);}
}
function drawArena(now){
  sizeCanvas();if(!CW)return;
  const dark=document.documentElement.dataset.theme==='dark';
  cx.setTransform(DPR,0,0,DPR,0,0);cx.clearRect(0,0,CW,CH);
  cx.fillStyle=dark?'#202723':'#e9f1eb';cx.fillRect(0,0,CW,CH);
  cx.fillStyle=dark?'#2d3833':'#d3e0d7';cx.fillRect(0,152,CW,CH-152);                                     // mat
  const ropes=['#d9534f','#f4f4f4','#3f7fd9'];ropes.forEach((col,i)=>{const y=46+i*26;cx.fillStyle='rgba(0,0,0,.14)';cx.fillRect(10,y+3,CW-20,5);cx.fillStyle=col;cx.fillRect(10,y,CW-20,5);});
  cx.fillStyle=dark?'#55645c':'#aab8ae';cx.fillRect(6,34,10,118);cx.fillRect(CW-16,34,10,118);                // corner posts
  const s=Math.min(1.2,CW/300),gap=140*s;
  B.forEach((b,i)=>{
    const cxp=CW/2+(i===0?-gap/2:gap/2);
    // one-shot anims return to idle by themselves
    const dur=CFG.ANIM_MS[b.anim];
    if(dur&&b.anim!=='ko'&&now-b.t0>=dur){b.anim='idle';b.t0=now;logAnim('auto idle '+i);}
    drawBoxer(cx,b.skin,pose(b.anim,b.t0,now,b.power),i===1,cxp,150,s,now);
  });
}
function loop(now){raf=requestAnimationFrame(loop);drawArena(now);tickCountdown();}
function startLoop(){if(!raf)raf=requestAnimationFrame(loop);}
function stopLoop(){if(raf){cancelAnimationFrame(raf);raf=0;}}
window.addEventListener('resize',()=>{if(raf)drawArena(performance.now());});

// ---------- fx overlays ----------
function fxAdd(cls,text,ms){const d=document.createElement('div');d.className=cls;d.textContent=text;$('fx').appendChild(d);setTimeout(()=>d.remove(),ms||1100);return d;}
function tickCountdown(){
  if(!S||S.state!=='countdown'||!cd||cd.round!==S.round){if(fxState){clearCd();}return;}
  const rem=cd.endsAt-(Date.now()+offset),step=cd.ms/3,n=Math.max(0,Math.ceil(rem/step));
  const key=n>0?String(n):'';
  if(key!==fxState){clearCd();fxState=key;if(key)fxAdd('cdnum',key,step+200).dataset.cd='1';}
}
function clearCd(){fxState='';$('fx').querySelectorAll('[data-cd]').forEach(e=>e.remove());}

// ---------- screens ----------
const P=id=>S&&S.players.find(p=>p.id===id);
const meP=()=>P(me);
const oppP=()=>S&&S.players.find(p=>p.id!==me);
function show(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='scr-'+name));
  $('roomPill').textContent=(S&&name!=='home')?'Room '+S.code:'';
  if(name==='home'&&location.search){history.replaceState(null,'',location.pathname);}
  if(name==='game')startLoop();else stopLoop();
}
let toastT;function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2200);}
function shakeEl(el){el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');setTimeout(()=>el.classList.remove('shake'),350);}

function renderLobby(){
  $('lobbyCode').textContent=S.code;
  const m=meP(),host=m&&m.isHost;
  $('plCount').textContent=S.players.length+'/2';
  $('lobbyPlayers').innerHTML=S.players.map(p=>'<div class="pl'+(p.id===me?' me':'')+'"><span class="sk" style="background:'+SKINS[p.skin%4].c+'"></span><span class="nm">'+esc(p.name)+'</span>'+(p.isHost?'<span class="tag">Host</span>':'')+(p.online?'':'<span class="tag off">offline</span>')+(p.id===me?'<span class="tag ok">Kamu</span>':'')+'</div>').join('');
  const taken=new Set(S.players.filter(p=>p.id!==me).map(p=>p.skin));
  $('swatches').innerHTML=SKINS.map((k,i)=>'<button class="swatch'+(m&&m.skin===i?' sel':'')+'" data-skin="'+i+'" aria-label="Warna '+k.n+'" title="'+k.n+(taken.has(i)?' (dipakai lawan)':'')+'" style="background:'+k.c+'"'+(taken.has(i)?' disabled':'')+'></button>').join('');
  const two=S.players.length>=2,allOn=S.players.every(p=>p.online);
  $('btnStart').disabled=!(host&&two&&allOn);
  $('startHint').textContent=!two?'Menunggu lawan bergabung — bagikan kode room':!allOn?'Ada pemain yang offline — tunggu sebentar':host?'Siap? Tekan Mulai':'Menunggu host menekan Mulai…';
}
function hudFill(el,p,isMe){
  el.classList.toggle('hot',!!(p&&p.fire));el.classList.toggle('off',!!(p&&!p.online));
  el.querySelector('.nm').textContent=p?p.name+(isMe?' (kamu)':''):'Menunggu lawan…';
  el.querySelector('.sk').style.background=p?SKINS[p.skin%4].c:'var(--line2)';
  const hp=p?p.hp:CFG.HP,max=(S&&S.cfg&&S.cfg.HP)||CFG.HP,pc=Math.max(0,Math.min(100,hp/max*100)),bar=el.querySelector('.hpbar i');
  bar.style.width=pc+'%';bar.className=pc<=25?'low':pc<=50?'mid':'';
  el.querySelector('.hptxt').textContent='HP '+hp+'/'+max+(p&&p.streak?'  ·  '+p.streak+' menang beruntun':'');
}
function tilesHtml(w){let h='';for(let i=0;i<w.text.length;i++)h+='<div class="tile'+(w.ulti?' rainbow':'')+'" style="--i:'+i+'">'+esc(w.text[i])+'</div>';return h;}
function renderTiles(force){
  if(!W){$('tiles').innerHTML='';tilesKey='';return;}
  const key=W.round+':'+W.text;
  if(force||tilesKey!==key){const n=W.text.length;$('tiles').style.setProperty('--cols',n<=9?n:Math.ceil(n/2));$('tiles').innerHTML=tilesHtml(W);tilesKey=key;}
  const el=$('tiles').children;
  for(let i=0;i<el.length;i++){
    const c=el[i].classList;
    c.toggle('ok',i<typed.length);c.toggle('bad',!!bad&&i===typed.length);c.toggle('cur',!sentDone&&!bad&&i===typed.length);
  }
}
function typingPhase(){return !!(S&&(S.state==='word'||S.state==='resolving')&&W&&W.round===S.round);}
function updateFocusHint(){$('focusHint').classList.toggle('on',typingPhase()&&!sentDone&&document.activeElement!==$('typer'));}
function focusTyper(){try{$('typer').focus({preventScroll:true});}catch(e){}updateFocusHint();}
function statusText(){
  const o=oppP();
  if(!S)return '';
  if(S.state==='countdown')return S.ultiIn===0?'Bersiap… ronde ULTI!':'Bersiap…';
  if(S.state==='paused')return (o&&!o.online?o.name+' terputus':'Menunggu pemain')+' — pertandingan dijeda';
  if(S.state==='word'||S.state==='resolving'){
    if(!W||W.round!==S.round)return 'Ronde berjalan — tunggu';
    if(sentDone)return S.state==='resolving'?'Selesai! Menunggu hasil…':'Selesai! Menunggu lawan…';
    return W.ulti?'ULTI! Huruf besar & tanda baca harus pas':'Ketik secepatnya!';
  }
  if(S.state==='result'&&lastRes&&lastRes.round===S.round){
    const r=lastRes;if(r.tier==='draw')return 'Seri — tidak ada yang kena';
    const mine=r.winner===me;return (mine?'Pukulanmu kena ':'Kamu kena pukul ')+r.damage+(r.critical?' · KRITIKAL':'')+(r.combo?' · 🔥 kombo':'');
  }
  return '';
}
function endTexts(){
  const m=meP(),o=oppP(),r=S.endReason,won=S.winnerId===me,hpTxt='HP kamu '+(m?m.hp:0)+' · HP '+(o?o.name:'lawan')+' '+(o?o.hp:0);
  if(r==='ko')return {t:won?'KO! Kamu menang 🥊':'KO! Kamu kalah',s:hpTxt};
  if(r==='walkover')return S.winnerId==null?{t:'Pertandingan dibatalkan',s:'Dua-duanya terputus terlalu lama'}:{t:won?'Kamu menang (walkover)':'Kamu kalah (walkover)',s:won?'Lawan keluar atau terputus lebih dari '+Math.round(((S.cfg&&S.cfg.WALKOVER_MS)||20000)/1000)+' detik':'Kamu terputus terlalu lama'};
  if(r==='bank')return {t:S.winnerId==null?'Seri':(won?'Kamu menang':'Kamu kalah'),s:'Kata habis — '+hpTxt};
  return {t:'Selesai',s:hpTxt};
}
function applyEndAnims(){
  if(endApplied)return;endApplied=true;
  const r=S.endReason,w=S.winnerId;
  if(w==null){resetAnims();return;}
  const wi=w===me?0:1,li=1-wi;
  if(RM()){B[wi].anim='win';B[li].anim=r==='ko'?'ko':'idle';B[0].t0=B[1].t0=-1e6;logAnim('end rm');return;}
  setAnim(wi,'win');if(r==='ko')setAnim(li,'ko');
}
function renderGame(){
  const m=meP(),o=oppP();
  if(m)B[0].skin=m.skin;
  if(o)B[1].skin=o.skin;else if(m)B[1].skin=(m.skin+1)%4;
  hudFill($('hudL'),m,true);hudFill($('hudR'),o,false);
  $('ultiBadge').classList.toggle('on',S.state!=='ended'&&S.state!=='lobby'&&(S.ultiIn===1));
  $('status').textContent=statusText();
  const ended=S.state==='ended',typing=typingPhase();
  $('endCard').hidden=!ended;$('leaveRow').hidden=ended;
  $('wordbox').hidden=ended;
  $('tiles').hidden=!typing;
  $('ph').textContent=typing?'':(S.state==='word'||S.state==='resolving')?'Ronde berjalan — tunggu':'';
  if(typing)renderTiles(false);
  if(S.state!=='ended'&&endApplied){endApplied=false;resetAnims();}
  if(ended){
    applyEndAnims();
    const t=endTexts();$('endTitle').textContent=t.t;$('endSub').textContent=t.s;
    const alone=S.players.length<2,btn=$('btnRematch');
    btn.textContent=alone?'Ke lobby':(m&&m.rematch)?'Menunggu '+(o?o.name:'lawan')+'…':(o&&o.rematch)?o.name+' mau rematch — ayo!':'Rematch';
    btn.disabled=!alone&&!!(m&&m.rematch);
    $('rematchHint').textContent=alone?'Lawan sudah keluar':(o&&!o.online)?o.name+' offline — rematch mulai begitu dia kembali':'';
  }
  updateFocusHint();
}
function render(){
  if(!S){show('home');return;}
  if(S.state==='lobby'){show('lobby');renderLobby();}
  else{show('game');renderGame();}
}

// ---------- messages ----------
function onMsg(m){
  if(m.t==='joined'){saveSess({code:m.code,token:m.token});me=m.id;return;}
  if(m.t==='state'){
    S=m.room;me=S.you?S.you.id:me;offset=S.serverTime-Date.now();
    if(S.state==='lobby'){W=null;typed='';bad='';if(lastCount&&S.players.length>lastCount)SFX.join();lastCount=S.players.length;}else lastCount=0;
    render();
    if(AU.music&&!AU.started&&!AU.hinted&&S.state!=='lobby'){AU.hinted=true;toast('Ketuk layar untuk menyalakan musik 🎵');}
    return;}
  if(m.t==='countdown'){
    cd=m;if(m.round===1)lastRes=null;offset=m.serverTime-Date.now();W=null;typed='';bad='';typos=0;sentDone=false;$('typer').value='';
    resetAnims();endApplied=false;clearCd();
    if(S)render();return;}
  if(m.t==='word'){onWord(m);return;}
  if(m.t==='result'){onResult(m);return;}
  if(m.t==='end'){onEnd(m);return;}
  if(m.t==='error'){
    if(m.code==='stale'||m.code==='dup')return;           // expected races, no toast (RFC 3)
    toast(m.msg||'Terjadi kesalahan');SFX.err();return;}
  if(m.t==='rejoin_failed'){saveSess(null);S=null;W=null;show('home');toast('Room sudah tidak ada');return;}
  if(m.t==='left'){saveSess(null);S=null;W=null;cd=null;typed='';bad='';resetAnims();endApplied=false;show('home');return;}
}
function onWord(m){
  W=m;typed='';bad='';typos=0;sentDone=false;revealT=performance.now();
  $('typer').value='';clearCd();
  SFX.roundBell();
  if(S)renderGame();
  renderTiles(true);focusTyper();
  if(m.ulti)fxAdd('burst ulti','ULTI!',900);
}
function onResult(m){
  lastRes=m;
  const w=m.winner;
  if(m.tier==='draw'){resetAnims();fxAdd('burst alt','Seri',1000);}
  else{
    const wi=w===me?0:1,li=1-wi;
    setAnim(wi,m.critical?'uppercut':'jab');
    setAnim(li,m.tier==='block'?'block':'ouch',m.tier==='clean'?1.6:1);
    if(m.critical)SFX.uppercut();else if(m.tier==='block')SFX.block();else SFX.punch();
    if(m.damage>0)fxAdd('dmg '+(li===0?'l':'r'),'-'+m.damage,1100);
    if(m.critical)fxAdd('burst','KRITIKAL!',1000);
    else if(m.combo)fxAdd('burst','🔥 KOMBO!',1000);
    if(m.ulti&&!RM())shakeEl($('arena'));
  }
  // keep the HUD in step with the result before the next state broadcast arrives
  if(S)S.players.forEach(p=>{if(m.hp&&m.hp[p.id]!=null)p.hp=m.hp[p.id];if(m.fire&&m.fire[p.id]!=null)p.fire=m.fire[p.id];});
  if(S)renderGame();
}
function onEnd(m){
  endApplied=true;
  if(m.winner==null){resetAnims();}
  else{
    const wi=m.winner===me?0:1,li=1-wi;
    if(RM()){B[wi].anim='win';B[li].anim=m.reason==='ko'?'ko':'idle';B[0].t0=B[1].t0=-1e6;logAnim('end rm');}
    else{setAnim(wi,'win');if(m.reason==='ko')setAnim(li,'ko');}
  }
  if(m.reason==='ko'){SFX.koBell();setTimeout(()=>{if(m.winner===me)SFX.win();else SFX.lose();},800);}
  else if(m.winner===me)SFX.win();
  if(S)renderGame();
}

// ---------- typing (RFC 4.2) ----------
const typer=$('typer');
function finishWord(){
  sentDone=true;
  const elapsed=Math.round(performance.now()-revealT);
  send({t:'done',round:W.round,elapsed,typos});
  renderTiles(false);$('status').textContent=statusText();updateFocusHint();
}
function onTyperInput(){
  const cur=typed+bad;
  if(!typingPhase()||sentDone){typer.value=cur;return;}
  const v=typer.value;
  let i=0;while(i<v.length&&i<cur.length&&v[i]===cur[i])i++;
  for(let n=cur.length;n>i;n--){if(bad){bad='';typos++;}else typed=typed.slice(0,-1);}            // removals: deleting a red tile = 1 typo
  for(let k=i;k<v.length;k++){const ch=v[k];if(bad)continue;                                       // strict D8: ignore input while a red tile is pending
    if(typed.length<W.text.length&&ch===W.text[typed.length]){typed+=ch;SFX.tap();}else{bad=ch;SFX.err();}}
  typer.value=typed+bad;
  renderTiles(false);
  if(typed===W.text)finishWord();
}
typer.addEventListener('input',e=>{if(e.isComposing)return;onTyperInput();});
typer.addEventListener('compositionend',onTyperInput);
typer.addEventListener('blur',()=>setTimeout(updateFocusHint,0));
typer.addEventListener('focus',updateFocusHint);
$('focusHint').addEventListener('pointerdown',e=>{e.preventDefault();focusTyper();});
['wordbox','arena'].forEach(id=>$(id).addEventListener('pointerdown',()=>{if(typingPhase()&&!sentDone)focusTyper();}));
document.addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey||e.target===typer||e.target.tagName==='INPUT')return;
  if(typingPhase()&&!sentDone&&(e.key.length===1||e.key==='Backspace'))focusTyper();
});

// ---------- events ----------
$('name').value=lsGet(LS_NAME,'');
function getName(){const n=$('name').value.trim().slice(0,16);lsSet(LS_NAME,n);return n;}
const mySkin=()=>{const v=parseInt(lsGet(LS_SKIN,'0'),10);return v>=0&&v<=3?v:0;};
$('btnCreate').onclick=()=>{const n=getName();if(!n){toast('Isi nama dulu');$('name').focus();return;}send({t:'create',name:n,skin:mySkin()});};
$('btnJoin').onclick=()=>{const n=getName();if(!n){toast('Isi nama dulu');$('name').focus();return;}const c=$('joinCode').value.trim().toUpperCase();if(c.length!==5){toast('Kode room 5 karakter');$('joinCode').focus();return;}send({t:'join',code:c,name:n,skin:mySkin()});};
$('joinCode').addEventListener('keydown',e=>{if(e.key==='Enter')$('btnJoin').click();});
$('name').addEventListener('keydown',e=>{if(e.key==='Enter'){if($('joinCode').value.trim())$('btnJoin').click();else $('joinCode').focus();}});
$('btnStart').onclick=()=>send({t:'start'});
$('swatches').onclick=e=>{const b=e.target.closest('[data-skin]');if(!b||b.disabled)return;const k=Number(b.dataset.skin);lsSet(LS_SKIN,String(k));send({t:'skin',skin:k});};
$('btnRematch').onclick=()=>send({t:'rematch'});
const leave=()=>{if(S&&S.state!=='lobby'&&S.state!=='ended'&&!confirm('Keluar dari pertandingan? Lawan menang walkover.'))return;send({t:'leave'});};
$('btnLeaveLobby').onclick=leave;$('btnLeaveGame').onclick=leave;$('btnLeaveEnd').onclick=leave;
function roomLink(){return location.origin+location.pathname.replace(/[^/]*$/,'')+'?room='+(S?S.code:'');}
async function copy(txt){try{await navigator.clipboard.writeText(txt);return true;}catch(e){const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy');}catch(_){}ta.remove();return ok;}}
$('btnCopyCode').onclick=async()=>{toast((await copy(S.code))?'Kode disalin':'Kode: '+S.code);};
$('btnShare').onclick=async()=>{const url=roomLink();if(navigator.share){try{await navigator.share({title:'Tinju Kata',text:'Gabung room '+S.code,url});return;}catch(e){if(e&&e.name==='AbortError')return;}}toast((await copy(url))?'Link disalin':url);};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!connected&&!ws)connect();});

// ---------- boot ----------
try{const s=JSON.parse(localStorage.getItem(LS_SESS)||'null');if(s&&s.code&&s.token)sess=s;}catch(e){}
const qp=new URLSearchParams(location.search).get('room');
if(qp&&!sess){$('joinCode').value=qp.toUpperCase().slice(0,5);setTimeout(()=>{($('name').value?$('btnJoin'):$('name')).focus();},50);}
connect();
// test hook (RFC 4.3): arena also carries data-anim="<left>:<right>"
window.__tinju=window.__tk={version:VERSION,CFG,SKINS,get state(){return S;},get me(){return me;},get anims(){return animLog;},get boxers(){return B;},
  get word(){return W;},get typing(){return {typed,bad,typos,sentDone};},get lastResult(){return lastRes;},send,get audio(){return AU;},sfx:SFX};

})();
