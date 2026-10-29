(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS_NAME='bc_name',LS_SESS='bc_sess';
let ws=null,S=null,me=null,sess=null,tgt=null,inp='',secInp='',offset=0,retry=0,retryTimer=null,intent=null,connected=false;
let seenGuesses=-1,popNext=false,lastCount=0,wasMyTurn=false,endSeen='';


// ---------- theme ----------
const LS_THEME='bc_theme';
function applyTheme(t){document.documentElement.dataset.theme=t;$('btnTheme').textContent=t==='dark'?'☀':'☾';$('themeColor').content=t==='dark'?'#1a1f1c':'#eef3ec';}
applyTheme((()=>{try{return localStorage.getItem(LS_THEME)||'light';}catch(e){return 'light';}})());
$('btnTheme').onclick=()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(LS_THEME,t);}catch(e){}applyTheme(t);};

// ---------- audio (all synthesized with Web Audio — no files) ----------
const LS_SND='bc_snd';
const AU={ctx:null,master:null,sfx:true,music:true,nodes:null,started:false};
try{const s=JSON.parse(localStorage.getItem(LS_SND)||'{}');if(typeof s.sfx==='boolean')AU.sfx=s.sfx;if(typeof s.music==='boolean')AU.music=s.music;}catch(e){}
function saveSnd(){try{localStorage.setItem(LS_SND,JSON.stringify({sfx:AU.sfx,music:AU.music}));}catch(e){}}
function actx(){if(AU.ctx)return AU.ctx;const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;try{AU.ctx=new C();}catch(e){return null;}AU.master=AU.ctx.createGain();AU.master.gain.value=1;AU.master.connect(AU.ctx.destination);return AU.ctx;}
function unlock(){const c=actx();if(!c)return;const go=()=>{if(AU.started)return;AU.started=true;sndUI();if(AU.music)startMusic();};if(c.state==='running')go();else c.resume().then(()=>{if(c.state==='running')go();}).catch(()=>{});}
['pointerdown','keydown','touchend'].forEach(ev=>document.addEventListener(ev,unlock,{passive:true}));
function tone(freq,dur,o){const c=AU.ctx;if(!c||!AU.sfx||c.state!=='running')return;o=o||{};const t0=c.currentTime+(o.at||0);const osc=c.createOscillator(),g=c.createGain();osc.type=o.type||'sine';osc.frequency.setValueAtTime(freq,t0);if(o.to)osc.frequency.exponentialRampToValueAtTime(o.to,t0+dur);const v=o.vol||.1;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(v,t0+.01);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);osc.connect(g);g.connect(AU.master);osc.start(t0);osc.stop(t0+dur+.05);}
const SFX={
  tap(){tone(660,.07,{vol:.07});},
  del(){tone(420,.07,{vol:.06});},
  err(){tone(210,.28,{type:'triangle',to:140,vol:.09});},
  reveal(pattern){const f={x:330,y:440,g:554};pattern.forEach((p,i)=>tone(f[p],.38,{type:'triangle',at:i*.22+.27,vol:.08}));if(pattern.every(p=>p==='g'))[523,659,784,1047].forEach((q,i)=>tone(q,.5,{at:1.3+i*.09,vol:.09}));},
  turn(){tone(784,.18,{vol:.08});tone(1047,.4,{at:.14,vol:.08});},
  win(){[523,659,784,1047,1319].forEach((q,i)=>tone(q,.6,{at:i*.11,vol:.1}));},
  lose(){[440,392,330].forEach((q,i)=>tone(q,.45,{type:'triangle',at:i*.18,vol:.08}));},
  join(){tone(880,.12,{vol:.05});tone(1175,.22,{at:.1,vol:.05});},
  set(){tone(659,.12,{vol:.06});tone(880,.25,{at:.09,vol:.06});}
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

function onMsg(m){
  if(m.t==='joined'){saveSess({code:m.code,token:m.token});me=m.id;return;}
  if(m.t==='state'){S=m.room;me=S.you?S.you.id:me;offset=S.serverTime-Date.now();render();if(AU.music&&!AU.started&&!AU.hinted&&S.state!=='lobby'){AU.hinted=true;toast('Ketuk layar untuk menyalakan musik 🎵');}return;}
  if(m.t==='error'){toast(m.msg||'Terjadi kesalahan');SFX.err();if(S&&S.state==='playing')shake($('guessTiles'));return;}
  if(m.t==='rejoin_failed'){saveSess(null);S=null;show('home');toast('Room sudah tidak ada');return;}
  if(m.t==='left'||m.t==='kicked'){saveSess(null);S=null;tgt=null;inp='';secInp='';lastCount=0;wasMyTurn=false;show('home');if(m.t==='kicked')toast('Kamu dikeluarkan dari room');return;}
}

// ---------- rendering ----------
function shake(el){el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');}
document.addEventListener('animationend',e=>{if(e.animationName==='shake')e.target.classList.remove('shake');if(e.animationName==='pop')e.target.classList.remove('pop');});
let toastT;function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2200);}
function show(name){document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='scr-'+name));$('roomPill').textContent=(S&&name!=='home')?'Room '+S.code:'';if(name==='home'&&location.search){history.replaceState(null,'',location.pathname);}}
const P=id=>S&&S.players.find(p=>p.id===id);
const nameOf=id=>{const p=P(id);return p?p.name:'?';};
function tiles(str,cls,cur){const pop=popNext;popNext=false;let h='';for(let i=0;i<4;i++){const ch=str[i]||'';const c=['tile',cls||'',ch?'fill':'',(cur&&i===str.length)?'cur':'',(pop&&i===str.length-1)?'pop':''].join(' ');h+='<div class="'+c+'">'+esc(ch)+'</div>';}return h;}
function patTiles(guess,pattern,small,anim){const win=anim&&pattern.every(p=>p==='g');return guess.split('').map((d,i)=>'<div class="tile '+(small?'sm ':'')+pattern[i]+(anim?' flip':'')+(win?' win':'')+'" data-d="'+d+'" style="--d:'+(i*0.22)+'s">'+d+'</div>').join('');}
function guessRow(e,i,n,anim,who){return '<div class="gl'+(i===n-1?' latest':' old')+'"><span class="n">'+(i+1)+'</span>'+patTiles(e.guess,e.pattern,true,anim)+'<span class="res"><b>'+e.bulls+'</b> hijau · <b>'+e.cows+'</b> kuning</span><span class="who">'+who+'</span></div>';}
function knowledge(list){const k={};const rank={x:1,y:2,g:3};list.forEach(e=>{for(let i=0;i<4;i++){const d=e.guess[i],p=e.pattern[i];if(!k[d]||rank[p]>rank[k[d]])k[d]=p;}});return k;}
function pad(id,cur,onKey,disabled,know){know=know||{};
  const el=$(id);let h='';
  for(let d=1;d<=9;d++)h+=key(d);h+=key(0);
  h+='<button class="act" data-k="del">⌫ Hapus</button><button class="act primary" data-k="ok" style="grid-column:span 4">'+(id==='secretPad'?'Pasang angka':'Tebak!')+'</button>';
  function key(d){const used=cur.includes(String(d));const kc=know[String(d)]?' k'+know[String(d)]:'';return '<button data-k="'+d+'" class="'+(used?'used':'')+kc+'" '+((used||cur.length>=4||disabled)?'disabled':'')+'>'+d+'</button>';}
  el.innerHTML=h;
  el.querySelector('[data-k=del]').disabled=disabled||!cur.length;
  el.querySelector('[data-k=ok]').disabled=disabled||cur.length!==4;
  el.onclick=e=>{const b=e.target.closest('button');if(!b||b.disabled)return;const k=b.dataset.k;if(k==='del')SFX.del();else if(k==='ok')SFX.set();else SFX.tap();onKey(k);};
}
function playerRow(p,opts){
  const o=opts||{};let tags='';
  if(p.isHost)tags+='<span class="tag">host</span>';
  if(!p.online)tags+='<span class="tag off">offline</span>';
  if(o.lobby)tags+=p.ready?'<span class="tag ok">siap</span>':'<span class="tag">belum</span>';
  if(o.game){if(p.cracked)tags+='<span class="tag dead">tersingkir</span>';else if(S.turn===p.id)tags+='<span class="tag turn">giliran</span>';}
  let kick='';if(o.lobby&&S.hostId===me&&p.id!==me)kick='<button class="sm ghost" data-kick="'+p.id+'">Keluarkan</button>';
  return '<div class="pl '+(p.id===me?'me':'')+'"><span class="nm">'+esc(p.name)+(p.id===me?' <span class="muted">(kamu)</span>':'')+'</span>'+tags+kick+'</div>';
}
function logHtml(){
  if(!S)return '';
  return S.history.slice().reverse().map(e=>{
    if(e.type==='guess')return '<div class="ev"><b>'+esc(e.byName)+'</b> → '+esc(e.targetName)+': <b style="font-family:monospace">'+e.guess+'</b> · '+e.bulls+' hijau, '+e.cows+' kuning</div>';
    if(e.type==='cracked')return '<div class="ev">🎯 <b>'+esc(e.byName)+'</b> menebak angka <b>'+esc(e.targetName)+'</b> ('+e.secret+')</div>';
    if(e.type==='skip')return '<div class="ev">⏱ <b>'+esc(e.byName)+'</b> kehabisan waktu, giliran dilewati</div>';
    if(e.type==='start')return '<div class="ev">▶ Mulai. Urutan: '+e.order.map(esc).join(' → ')+'</div>';
    if(e.type==='end')return '<div class="ev">🏁 Selesai'+(e.winnerId?' — pemenang <b>'+esc(nameOf(e.winnerId))+'</b>':'')+'</div>';
    return '';}).join('');
}
function render(){
  if(!S){show('home');return;}
  if(S.state!=='playing')seenGuesses=-1;
  if(S.state==='lobby')renderLobby();else if(S.state==='playing')renderGame();else renderEnd();
}
function renderLobby(){
  show('lobby');
  if(S.players.length>lastCount&&lastCount>0)SFX.join();lastCount=S.players.length;
  $('lobbyCode').textContent=S.code;
  $('plCount').textContent=S.players.length+'/'+S.maxPlayers;
  $('lobbyPlayers').innerHTML=S.players.map(p=>playerRow(p,{lobby:true})).join('');
  const mine=S.you.secret;
  if(mine&&!secInp){$('secretTiles').innerHTML=tiles(mine,'reveal');$('secretHint').textContent='Angka terpasang. Ketik lagi untuk mengganti.';}
  else{$('secretTiles').innerHTML=tiles(secInp,'',true);$('secretHint').textContent=mine?'Mengganti angka… (angka lama masih berlaku sampai kamu Pasang)':'4 digit, semua berbeda. Lawan akan menebak angka ini.';}
  pad('secretPad',secInp,k=>{
    if(k==='del')secInp=secInp.slice(0,-1);
    else if(k==='ok'){if(secInp.length===4){send({t:'secret',secret:secInp});secInp='';}}
    else if(secInp.length<4&&!secInp.includes(k)){secInp+=k;popNext=true;}
    renderLobby();
  },false);
  const isHost=S.hostId===me;
  const notReady=S.players.filter(p=>!p.ready),offline=S.players.filter(p=>!p.online);
  let reason='';
  if(S.players.length<S.minPlayers)reason='Menunggu pemain lain bergabung (minimal '+S.minPlayers+'). Bagikan kode di atas.';
  else if(offline.length)reason=offline.map(p=>esc(p.name)).join(', ')+' sedang offline.';
  else if(notReady.length)reason='Menunggu angka dari: '+notReady.map(p=>esc(p.name)).join(', ');
  $('btnStart').style.display=isHost?'':'none';
  $('btnStart').disabled=!!reason;
  if(reason)$('startHint').innerHTML=reason;
  else $('startHint').innerHTML=isHost?'Semua siap — tekan Mulai.':'Semua siap — menunggu <b>'+esc(nameOf(S.hostId))+'</b> memulai.';
}
function renderGame(){
  show('game');
  const myTurn=S.turn===me,iAmDead=P(me)&&P(me).cracked;
  const opps=S.players.filter(p=>p.id!==me);
  if(!tgt||!opps.find(p=>p.id===tgt&&!p.cracked)){const a=opps.find(p=>!p.cracked);tgt=a?a.id:(opps[0]&&opps[0].id);}
  const t=P(tgt);
  const banner=$('turnBanner');
  if(iAmDead){banner.className='banner other';banner.textContent='Angkamu sudah tertebak — kamu menonton. Giliran '+nameOf(S.turn)+'.';}
  else if(myTurn){banner.className='banner me';banner.textContent='Giliranmu! Tebak angka '+(t?t.name:'lawan');}
  else{banner.className='banner other';banner.textContent='Giliran '+nameOf(S.turn)+'…';}
  $('targetTabs').innerHTML=opps.map(p=>'<button data-t="'+p.id+'" class="'+(p.id===tgt?'sel':'')+(p.cracked?' dead':'')+'">'+esc(p.name)+(p.cracked?' ✓':'')+'</button>').join('');
  $('targetTabs').onclick=e=>{const b=e.target.closest('button');if(!b)return;tgt=b.dataset.t;renderGame();};
  const allGuesses=S.history.filter(e=>e.type==='guess');allGuesses.forEach((e,i)=>{e._gi=i;});
  const animFrom=seenGuesses<0?allGuesses.length:seenGuesses;seenGuesses=allGuesses.length;
  allGuesses.slice(animFrom).forEach(e=>SFX.reveal(e.pattern));
  if(myTurn&&!iAmDead&&!wasMyTurn)SFX.turn();wasMyTurn=myTurn&&!iAmDead;
  const myGuesses=allGuesses.filter(e=>e.target===tgt);
  $('board').innerHTML=(myGuesses.length?'':'<div class="muted" style="text-align:center">Belum ada tebakan ke '+(t?esc(t.name):'')+'.</div>')+
    myGuesses.map((e,i)=>guessRow(e,i,myGuesses.length,e._gi>=animFrom,e.by===me?'kamu':esc(e.byName))).join('')+
    (t&&t.cracked?'<div class="muted" style="text-align:center;margin-top:6px">Angka '+esc(t.name)+': <b style="font-family:monospace">'+t.secret+'</b> — ditebak oleh '+esc(nameOf(t.crackedBy))+'</div>':'');
  const canGuess=myTurn&&!iAmDead&&t&&!t.cracked;
  $('guessTiles').innerHTML=tiles(inp,'',canGuess);
  pad('guessPad',inp,k=>{
    if(k==='del')inp=inp.slice(0,-1);
    else if(k==='ok'){if(inp.length===4&&canGuess){send({t:'guess',target:tgt,guess:inp});inp='';}}
    else if(inp.length<4&&!inp.includes(k)){inp+=k;popNext=true;}
    renderGame();
  },!canGuess,knowledge(myGuesses));
  $('mySecret').innerHTML=S.you.secret.split('').map(d=>'<div class="tile sm reveal">'+d+'</div>').join('');
  const vsMe=allGuesses.filter(e=>e.target===me);
  $('againstMe').innerHTML=vsMe.length?vsMe.map((e,i)=>guessRow(e,i,vsMe.length,e._gi>=animFrom,esc(e.byName))).join(''):'<div class="muted">Belum ada yang menebak angkamu.</div>';
  $('gamePlayers').innerHTML=S.players.map(p=>playerRow(p,{game:true})).join('');
  $('log').innerHTML=logHtml();
  tickTimer();
}
function renderEnd(){
  show('end');
  const w=S.winnerId?P(S.winnerId):null;
  const key=S.code+':'+S.round;if(endSeen!==key){endSeen=key;wasMyTurn=false;const lastG=S.history.filter(e=>e.type==='guess').pop();const fin=()=>{if(w&&w.id===me)SFX.win();else SFX.lose();};if(lastG&&lastG.pattern.every(q=>q==='g')){SFX.reveal(lastG.pattern);setTimeout(fin,1700);}else fin();}
  $('trophy').textContent=w?(w.id===me?'🏆':'🎯'):'🤝';
  $('winnerName').textContent=w?(w.id===me?'Kamu menang!':w.name+' menang'):'Seri — tidak ada pemenang';
  $('winnerSub').textContent=w?'Ronde '+S.round+' · '+S.history.filter(e=>e.type==='guess').length+' tebakan total':'';
  $('reveal').innerHTML=S.players.map(p=>'<div class="pl '+(p.id===me?'me':'')+'"><span class="nm">'+esc(p.name)+(p.id===me?' <span class="muted">(kamu)</span>':'')+'</span><div class="tiles">'+(p.secret||'????').split('').map(d=>'<div class="tile sm reveal">'+d+'</div>').join('')+'</div>'+(p.cracked?'<span class="tag dead">tertebak</span>':'<span class="tag ok">bertahan</span>')+'</div>').join('');
  $('logEnd').innerHTML=logHtml();
  const isHost=S.hostId===me;
  $('btnAgain').style.display=isHost?'':'none';
  $('againHint').textContent=isHost?'Semua pemain tetap di room, angka rahasia dipasang ulang.':'Menunggu '+nameOf(S.hostId)+' memulai ronde baru…';
}
let timerT=null;
function tickTimer(){
  clearInterval(timerT);
  const bar=$('timerBar');
  const upd=()=>{if(!S||S.state!=='playing'){clearInterval(timerT);document.title='Bulls & Cows — Tebak Angka';return;}
    const left=Math.max(0,S.turnDeadline-(Date.now()+offset));const pct=100*left/S.turnMs;
    bar.style.width=pct+'%';bar.classList.toggle('low',left<15000);
    document.title=S.turn===me?Math.ceil(left/1000)+'s · Giliranmu — Bulls & Cows':'Bulls & Cows — Tebak Angka';};
  upd();timerT=setInterval(upd,250);
}

// ---------- events ----------
$('name').value=(()=>{try{return localStorage.getItem(LS_NAME)||'';}catch(e){return '';}})();
function getName(){const n=$('name').value.trim().slice(0,16);try{localStorage.setItem(LS_NAME,n);}catch(e){}return n;}
$('btnCreate').onclick=()=>{const n=getName();if(!n){toast('Isi nama dulu');$('name').focus();return;}send({t:'create',name:n});};
$('btnJoin').onclick=()=>{const n=getName();if(!n){toast('Isi nama dulu');$('name').focus();return;}const c=$('joinCode').value.trim().toUpperCase();if(c.length!==5){toast('Kode room 5 karakter');$('joinCode').focus();return;}send({t:'join',code:c,name:n});};
$('joinCode').addEventListener('keydown',e=>{if(e.key==='Enter')$('btnJoin').click();});
$('name').addEventListener('keydown',e=>{if(e.key==='Enter'){if($('joinCode').value.trim())$('btnJoin').click();else $('joinCode').focus();}});
$('btnStart').onclick=()=>send({t:'start'});
$('btnAgain').onclick=()=>{inp='';secInp='';tgt=null;send({t:'restart'});};
const leave=()=>{if(S&&S.state==='playing'&&!confirm('Keluar dari permainan yang sedang berjalan?'))return;send({t:'leave'});};
$('btnLeaveLobby').onclick=leave;$('btnLeaveGame').onclick=leave;$('btnLeaveEnd').onclick=leave;
$('lobbyPlayers').onclick=e=>{const b=e.target.closest('[data-kick]');if(b&&confirm('Keluarkan '+nameOf(b.dataset.kick)+'?'))send({t:'kick',id:b.dataset.kick});};
function roomLink(){return location.origin+location.pathname.replace(/[^/]*$/,'')+'?room='+(S?S.code:'');}
async function copy(txt){try{await navigator.clipboard.writeText(txt);return true;}catch(e){const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy');}catch(_){}ta.remove();return ok;}}
$('btnCopyCode').onclick=async()=>{toast((await copy(S.code))?'Kode disalin':'Kode: '+S.code);};
$('btnShare').onclick=async()=>{const url=roomLink();if(navigator.share){try{await navigator.share({title:'Bulls & Cows',text:'Gabung room '+S.code,url});return;}catch(e){if(e&&e.name==='AbortError')return;}}toast((await copy(url))?'Link disalin':url);};
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.metaKey||e.ctrlKey||e.altKey)return;
  if(!S)return;
  const padId=S.state==='lobby'?'secretPad':(S.state==='playing'?'guessPad':null);if(!padId)return;
  let k=null;if(/^[0-9]$/.test(e.key))k=e.key;else if(e.key==='Backspace')k='del';else if(e.key==='Enter')k='ok';
  if(!k)return;e.preventDefault();
  const b=$(padId).querySelector('[data-k="'+k+'"]');if(b&&!b.disabled)b.click();
});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!connected&&!ws)connect();});

// ---------- boot ----------
try{const s=JSON.parse(localStorage.getItem(LS_SESS)||'null');if(s&&s.code&&s.token)sess=s;}catch(e){}
const qp=new URLSearchParams(location.search).get('room');
if(qp&&!sess){$('joinCode').value=qp.toUpperCase().slice(0,5);setTimeout(()=>{($('name').value?$('btnJoin'):$('name')).focus();},50);}
connect();
window.__bc={get state(){return S;},get me(){return me;},send,get audio(){return AU;}};
})();
