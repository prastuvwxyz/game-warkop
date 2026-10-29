'use strict';

// ---------- shell state ----------
const c=document.getElementById('c'),x=c.getContext('2d');
const RESTART_MS=500;
const store={
  get(k){try{return localStorage.getItem(k);}catch(e){return null;}},
  set(k,v){try{localStorage.setItem(k,v);}catch(e){}}
};
let world,bird,pipes,score,best=parseBest(store.get('flappy_best')),state,frame,playFrame,deadAt,deadFrame,deathY;
let night=false,skin=0,scorePop=0,flash=0,shake=0,panelT=0,toast=null,newBest=false;
let muted=store.get('flappy_mute')==='1';
let scoreStr='0',bestStr=String(best);
let ranksSeen=parseMask(store.get('flappy_ranks_seen'),MASK_RANKS);
if(ranksSeen<0){ranksSeen=rankUpMask(0,rankOf(best).tier);store.set('flappy_ranks_seen',ranksSeen);}   // migration: tiers <= best are already "seen", no toast
const ROMAN=['I','II','III'];
function rankLabel(r){return r.tier<0?'':RANKS[r.tier].name+' '+ROMAN[r.sub];}
function nextLabel(r){return r.tier<0?'Kayu I':r.sub<2?RANKS[r.tier].name+' '+ROMAN[r.sub+1]:r.tier<RANKS.length-1?RANKS[r.tier+1].name+' I':'';}
let runRank=rankOf(0),runLabel='',runNextText='',runFrac=0,bestRank=rankOf(best),bestRankLabel=rankLabel(bestRank);
let popT=0,popPending=false;
const sk0=store.get('flappy_skin');
let skinId=typeof sk0==='string'&&skinUnlocked(sk0,best)?sk0:'kuning';            // forged / locked / unknown id -> default
let skinsSeen=parseMask(store.get('flappy_skins_seen'),MASK_SKINS);
if(skinsSeen<0)skinsSeen=PALETTE_SKINS_MASK;                                       // missing/malformed: returning players hear about their unlocks once
let pickIdx=skinIndex(skinId),sparkleT=0,pickName='',pickLock='';
function setRun(sc){                                      // texts for the game-over panel (computed once per death)
  runRank=rankOf(sc);runLabel=runRank.tier<0?'Belum ada pangkat':rankLabel(runRank);
  runNextText=runRank.next<0?'Pangkat tertinggi!':'+'+(runRank.next-sc)+' ke '+nextLabel(runRank);
  runFrac=runRank.next<0?1:Math.max(0,Math.min(1,(sc-runRank.from)/(runRank.next-runRank.from)));
}
const bg={cloud:0,sky:0,bush:0,gnd:0};
const qs=new URLSearchParams(location.search);
const seedQ=qs.get('seed'),botOn=qs.get('bot')==='1';
const baseSeed=seedQ!==null&&/^-?\d+$/.test(seedQ)?(+seedQ|0):(Date.now()|0);
let runNo=0;
function nextSeed(){return(baseSeed+Math.imul(runNo++,0x9E3779B1))|0;}   // run 0 uses ?seed=N as given

// ---------- canvas fit: backing store = CSS px × DPR → crisp on every screen ----------
let SC=1;
const emblemCache=[];
function fit(){
  const r=c.getBoundingClientRect();if(!r.width)return;
  const d=Math.min(window.devicePixelRatio||1,3);
  const w=Math.round(r.width*d),h=Math.round(r.height*d);
  if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
  const sc0=SC;SC=c.width/W;
  if(SC!==sc0)emblemCache.length=0;                       // emblems are painted at 64*SC px: repaint lazily
}
if('ResizeObserver' in window)new ResizeObserver(fit).observe(c);
addEventListener('resize',fit);fit();
function pt(e){const r=c.getBoundingClientRect();return{px:(e.clientX-r.left)*W/r.width,py:(e.clientY-r.top)*H/r.height};}
const inRect=(px,py,r)=>px>=r.x&&px<=r.x+r.w&&py>=r.y&&py<=r.y+r.h;

// ---------- pixel-art sprites: 11 skins x 3 wing frames + 1 silhouette each, pre-rendered once at load ----------
const PX=2,WING_DY=[-3,0,2];
const BODY=[
'......kkkkkkk.....',
'.....kyyyyykwk....',
'....kyyyyykwwwk...',
'...kyyyyyykwwpwk..',
'..kyyyyyyykwwwwk..',
'..kyyyyyyyykkkkk..',
'.kyyyyyyyyykoooook',
'.kyyyyyyyyykOOOOOk',
'.kyyyyyyyyyYkkkkk.',
'..kyyyyyyyYYYk....',
'...kkkkkYYYYk.....',
'........kkkk......'];
const WING=['.kkkk.','kwwwwk','kwwwwk','.kkkk.'];
const PAL={k:'#3a2a1a',w:'#ffffff',p:'#15110d',o:'#f58a1f',O:'#c9641a'};
// SKINS[i] pairs with SKIN_META[i] in the core. body = 12 rows x 18 chars; wing drawn at (wx+i, wy+j+wingDy).
// fx ('trail' = Phoenix, 'halo' = Dewa) is data for v3.1 step 8; v3.0 draws no particles.
const SKINS=[
  {body:BODY,wing:WING,wx:1,wy:6,pal:{y:'#f8e04a',Y:'#d9a425'},fx:null},
  {body:BODY,wing:WING,wx:1,wy:6,pal:{y:'#6cc6f2',Y:'#3488c4'},fx:null},
  {body:BODY,wing:WING,wx:1,wy:6,pal:{y:'#f2644a',Y:'#bf3a22'},fx:null},
  {body:[
   '..................',
   '......kkkkkk......',
   '....kkyyyyyykk....',
   '...kyyyyyyyyyykk..',
   '..kyyyssyyyykwwk..',
   '..kyyyyyyyyykwpk..',
   '..kyyyyyyyyyykkoo.',
   '..kycccccyyyykkoO.',
   '..kycccccccyyykk..',
   '...kcccccccyYk....',
   '....kkkkkkkkk.....',
   '..................'],
   wing:['.kkkk.','kqqqqk','kqqqk.','.kkk..'],wx:3,wy:5,pal:{'y':'#b27a43','Y':'#7f5128','c':'#f2e0bb','s':'#5b3817','q':'#8d5a2e'},fx:null},
  {body:[
   '...k..........k...',
   '...kk........kk...',
   '...kyk......kyk...',
   '...kyyyyyyyyyyk...',
   '..kykkkkyykkkkyk..',
   '..kykwpkookwpkyk..',
   '..kykwwkOOkwwkyk..',
   '..kykkkkyykkkkyk..',
   '..kyccccccccccyk..',
   '...kyccccccccyk...',
   '....kkyyyyyykk....',
   '......kkkkkk......'],
   wing:['.kk.','kqqk','.kk.'],wx:0,wy:8,pal:{'y':'#bf935a','Y':'#8a6234','c':'#ead7b0','q':'#8a6234'},fx:null},
  {body:[
   '......kkkkkk......',
   '....kknnnnnnkk....',
   '...knnnnnnnnnnk...',
   '..knnnnnnnnkwwwk..',
   '..knnnnnnnnkwpwk..',
   '..knnnnnnnnnnkkooo',
   '.knnnwwwwwwwwwwkO.',
   '.knnnwwwwwwwwwwk..',
   '..knnwwwwwwwwwk...',
   '...knnwwwwwwwk....',
   '....kkkkkkkkkk....',
   '....ooo....ooo....'],
   wing:['.kkk.','kqqqk','kqqqk','.kqk.'],wx:3,wy:6,pal:{'n':'#23262e','q':'#4a5163','w':'#f5f5f0','o':'#f58a1f','O':'#c9641a'},fx:null},
  {body:[
   '..................',
   '......kkkkkk......',
   '....kkyyyyhhkk....',
   '..kkyyyyyyhhhhk...',
   '.kyyyyyyyyhhkwpk..',
   '.kyyyyyyyyyhhkoook',
   '.kyyyyyyyyyyykOOk.',
   '.kYyyyyyyyyyykkk..',
   '..kYYyyyyyyyyk....',
   '...kYYYYYYYYk.....',
   '....kkkkkkkk......',
   '..................'],
   wing:['.kkkkk.','kqqqqqk','kqqqqqk','.kkkkk.'],wx:1,wy:5,pal:{'y':'#6b4a2b','Y':'#46301a','h':'#f4f1e8','q':'#46301a','o':'#f2c230','O':'#c99a14'},fx:null},
  {body:[
   '.........kkkkk....',
   '........kyyyyykk..',
   '........kyywpkkOk.',
   '.........kyykkkk..',
   '.........kyyk.....',
   '..kkkkk..kyyk.....',
   '.kyyyyyykkyyk.....',
   'kyyyyyyyyyyyk.....',
   'kyyyYYyyyyyyk.....',
   '.kyyyYYYyyyk......',
   '..kkyyyyyykk......',
   '....kk..kk........'],
   wing:['.kkkk.','kqqqqk','kqqqqk','.kkkk.'],wx:2,wy:6,pal:{'y':'#f08aa8','Y':'#c75a7d','q':'#d96a8c','O':'#2a2128','w':'#ffffff'},fx:null},
  {body:[
   '......kkkrkkk.....',
   '.....kyyyyykrk....',
   '....kyyyyykrrrk...',
   '...kyhyyyykrrwrk..',
   '..kyyyyyyykrrrrk..',
   '..kyyyyyyyykkkkk..',
   '.kyyyyYyyyykooook.',
   '.kyyyyYyyyykOOOOk.',
   '.kyyyyYyyyyYkkkkk.',
   'kkkyhyyyyyYYYk....',
   'kkkkkkkkYYYYk.....',
   '........kkkk......'],
   wing:['.kkkk.','kqhqhk','kqqqqk','.kkkk.'],wx:1,wy:6,pal:{'y':'#aeb6c4','Y':'#6d7689','h':'#e9eef7','r':'#ff3b30','q':'#7f889b','k':'#20242c','o':'#ffcf40','O':'#c99a14'},fx:null},
  {body:[
   '......kfkfkfk.....',
   '.....kyyyyykwk....',
   '....kyyyyykwwwk...',
   '...kyyyyyykwwpwk..',
   '..kyyyyyyykwwwwk..',
   '..kyyyyyyyykkkkk..',
   '.kyyyyyyyyykoooook',
   '.kyyyyyyyyykOOOOOk',
   '.kyyyyyyyyyYkkkkk.',
   'ffkyyyyyyyYYYk....',
   'fffkkkkkYYYYk.....',
   '.ffff...kkkk......'],
   wing:['.kkkk.','kqqqqk','kqqqqk','.kkkk.'],wx:1,wy:6,pal:{'y':'#ff9a1f','Y':'#e0381a','f':'#ffd94a','k':'#5a1408','q':'#ffd94a','o':'#ffe27a','O':'#e0a82a','w':'#fff7d6','p':'#3a0a05'},fx:'trail'},
  {body:[
   '......c.c.c.......',
   '.....kccccckwk....',
   '....kyyyyykwwwk...',
   '...kyyyyyykwwpwk..',
   '..kyyyyyyykwwwwk..',
   '..kyyyyyyyykkkkk..',
   '.kyyyyyyyyykoooook',
   '.kyyyyyyyyykOOOOOk',
   '.kyyyyyyyyyYkkkkk.',
   '..kyyyyyyyYYYk....',
   '...kkkkkYYYYk.....',
   '........kkkk......'],
   wing:['.kkkk.','kqqqqk','kqqqqk','.kkkk.'],wx:1,wy:6,pal:{'y':'#ffd34a','Y':'#d79a1a','c':'#fff3a0','k':'#5a3a05','q':'#fff3a0','o':'#ff8a3a','O':'#d9541a'},fx:'halo'}
];
function sprite(sk,wingDy){
  const cv=document.createElement('canvas');cv.width=18*PX;cv.height=12*PX;
  const g=cv.getContext('2d');const pal=Object.assign({},PAL,sk.pal);
  const put=(ch,i,j)=>{if(ch==='.'||j<0||j>=12||i<0||i>=18)return;g.fillStyle=pal[ch];g.fillRect(i*PX,j*PX,PX,PX);};
  sk.body.forEach((row,j)=>{for(let i=0;i<row.length;i++)put(row[i],i,j);});
  sk.wing.forEach((row,j)=>{for(let i=0;i<row.length;i++)put(row[i],i+sk.wx,j+sk.wy+wingDy);});
  return cv;
}
function silhouette(cv){                                   // locked skin: dark shape of frame 1
  const o=document.createElement('canvas');o.width=cv.width;o.height=cv.height;const g=o.getContext('2d');
  g.drawImage(cv,0,0);g.globalCompositeOperation='source-in';g.globalAlpha=0.85;g.fillStyle='#1a1a22';g.fillRect(0,0,o.width,o.height);return o;
}
const SPR=SKINS.map(sk=>WING_DY.map(d=>sprite(sk,d)));
const SIL=SPR.map(f=>silhouette(f[1]));
document.getElementById('icon').href=SPR[0][1].toDataURL();

// ---------- background layers (offscreen tiles) ----------
function tile(w,h,fn){const cv=document.createElement('canvas');cv.width=w;cv.height=h;const g=cv.getContext('2d');fn(g,w,h);return cv;}
const rnd=(a,b)=>a+Math.random()*(b-a);
const cloudSpec=[];for(let i=0;i<5;i++){const cx=i*84+rnd(0,40),cy=rnd(20,55),n=4+(i%3);const puffs=[];for(let k=0;k<n;k++)puffs.push([cx+(k-n/2)*14+rnd(-4,4),cy+rnd(-6,6),rnd(12,20)]);cloudSpec.push(puffs);}
const bldgSpec=[];{let bx=0;while(bx<420){const w=rnd(18,42),h=rnd(28,96);bldgSpec.push([bx,w,h,Math.random()<.4]);bx+=w+rnd(2,8);}}
const bushSpec=[];{let bx=-10;while(bx<260){const r=rnd(18,30);bushSpec.push([bx+r,r]);bx+=r*1.3;}}
function makeLayers(nt){
  // Clouds: puffs are drawn 3x (x-420, x, x+420) so a cloud crossing the tile edge continues on the other side — the tile repeats, so without this the cloud is cut flat at the seam. py is clamped so no puff pokes out of the top row.
  const clouds=tile(420,90,(g,w)=>{const puff=(px,py,r)=>{for(const dx of[-w,0,w]){g.moveTo(px+dx+r,py);g.arc(px+dx,py,r,0,7);}};
    g.fillStyle=nt?'rgba(90,105,150,.85)':'rgba(255,255,255,.92)';for(const puffs of cloudSpec){g.beginPath();for(const[px,py,r]of puffs)puff(px,Math.max(py,r+6),r);g.fill();}
    g.fillStyle=nt?'rgba(120,135,180,.5)':'rgba(255,255,255,.6)';for(const puffs of cloudSpec){g.beginPath();for(const[px,py,r]of puffs)puff(px,Math.max(py,r+6)-4,r*.7);g.fill();}});
  const skyline=tile(420,110,(g,w,h)=>{g.fillStyle=nt?'#1e2c52':'#c4ece8';for(const[bx,bw,bh]of bldgSpec){g.fillRect(bx,h-bh,bw,bh);}
    g.fillStyle=nt?'#f3d27a':'rgba(255,255,255,.55)';for(const[bx,bw,bh,lit]of bldgSpec){if(nt&&!lit)continue;for(let yy=h-bh+8;yy<h-10;yy+=11)for(let xx=bx+5;xx<bx+bw-5;xx+=9)if(((xx*7+yy*3)|0)%5!==0)g.fillRect(xx,yy,3,4);}});
  const bushes=tile(240,44,(g,w,h)=>{g.fillStyle=nt?'#2f6d26':'#6fc542';g.beginPath();for(const[bx,r]of bushSpec){g.moveTo(bx+r,h);g.arc(bx,h,r,0,7);}g.fill();
    g.fillStyle=nt?'#3e8a30':'#8fdb5f';g.beginPath();for(const[bx,r]of bushSpec){g.moveTo(bx-4+r*.6,h-10);g.arc(bx-4,h-8,r*.6,0,7);}g.fill();});
  return{clouds,skyline,bushes};
}
const LAYERS={day:makeLayers(false),night:makeLayers(true)};
const groundTile=tile(24,80,(g,w,h)=>{g.fillStyle='#dfd59a';g.fillRect(0,0,w,h);g.fillStyle='#d2c48a';for(let yy=22;yy<h;yy+=14)g.fillRect(((yy*5)%w),yy,10,3);
  g.fillStyle='#8ed651';g.fillRect(0,0,w,12);g.fillStyle='#6fbf3a';g.beginPath();g.moveTo(0,0);g.lineTo(12,0);g.lineTo(24,12);g.lineTo(12,12);g.closePath();g.fill();
  g.fillStyle='#5a9a2e';g.fillRect(0,12,w,3);g.fillStyle='#7a5a30';g.fillRect(0,15,w,2);});
function layer(t,y,off){const tw=t.width;const s=-((off%tw)+tw);for(let bx=s;bx<W+tw;bx+=tw)x.drawImage(t,Math.round(bx),y);}

// ---------- audio (synthesized, created on first gesture) ----------
let ac;
function audio(){if(muted)return null;try{ac=ac||new(window.AudioContext||window.webkitAudioContext)();if(ac.state==='suspended')ac.resume();return ac;}catch(e){return null;}}
function tone(type,f0,f1,dur,vol,when){const a=audio();if(!a)return;const o=a.createOscillator(),g=a.createGain();o.type=type;const t=a.currentTime+(when||0);
  o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g).connect(a.destination);o.start(t);o.stop(t+dur+0.02);}
function noise(dur,vol){const a=audio();if(!a)return;const n=(a.sampleRate*dur)|0,b=a.createBuffer(1,n,a.sampleRate),d=b.getChannelData(0);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*(1-i/n);
  const s=a.createBufferSource();s.buffer=b;const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=900;const g=a.createGain();g.gain.value=vol;s.connect(f).connect(g).connect(a.destination);s.start();}
const sfx={flap:()=>tone('triangle',520,920,0.09,0.14),point:()=>{tone('square',988,988,0.07,0.07);tone('square',1319,1319,0.12,0.07,0.07);},
  hit:()=>{noise(0.15,0.35);tone('sawtooth',220,60,0.2,0.18);},die:()=>tone('sawtooth',520,120,0.45,0.14,0.2),
  rank:()=>{tone('square',523,523,0.1,0.08);tone('square',659,659,0.1,0.08,0.1);tone('square',784,784,0.1,0.08,0.2);tone('square',1047,1047,0.35,0.09,0.3);}};
function toggleMute(){muted=!muted;store.set('flappy_mute',muted?'1':'0');showToast(muted?'Suara mati':'Suara hidup');}

// ---------- game flow (shell) ----------
function reset(){
  world=createWorld(nextSeed(),0);bird=world.bird;pipes=world.obs;
  score=0;scoreStr='0';frame=0;playFrame=0;state='ready';
  panelT=0;newBest=false;flash=0;shake=0;popT=0;popPending=false;night=Math.random()<0.35;skin=skinIndex(skinId);pickIdx=skin;refreshPick();announceSkins();
}
function flap(){
  if(state==='paused'){state='play';return;}
  if(state==='ready'){state='play';skin=skinIndex(skinId);}      // a locked skin being browsed never starts a run
  if(state==='play'){bird.v=FLAP;sfx.flap();}
  else if(state==='dead'&&performance.now()-deadAt>RESTART_MS)reset();
}
function refreshPick(){const m=SKIN_META[pickIdx];pickName=best>=m.unlock?m.name:'';pickLock=best>=m.unlock?'':'Terbaik '+m.unlock+' untuk buka';}
function selectSkin(id){if(!skinUnlocked(id,best))return false;skinId=id;store.set('flappy_skin',id);return true;}
function pickStep(d){                                       // browse with the arrows; only unlocked skins become the selection
  pickIdx=(pickIdx+d+SKINS.length)%SKINS.length;selectSkin(SKIN_META[pickIdx].id);refreshPick();
}
function announceSkins(){                                   // one title toast for everything newly unlocked
  const r=skinNews(skinsSeen,best);
  if(r.n>0){skinsSeen=r.mask;store.set('flappy_skins_seen',skinsSeen);showToast(r.n+' burung baru terbuka — geser untuk memilih');sparkleT=100;}
}
function pause(){if(state==='play'){state='paused';}else if(state==='paused'){state='play';}}
function scroll(sp){bg.gnd+=sp;bg.bush+=sp*0.5;bg.sky+=sp*0.2;bg.cloud+=sp*0.08;}
const WING_SEQ=[0,1,2,1];
function update(){
  frame++;
  if(sparkleT>0)sparkleT--;
  if(scorePop>0)scorePop--;if(flash>0)flash--;if(shake>0)shake--;if(toast&&--toast.t<=0)toast=null;
  if(state==='ready'){bird.y=H/2+Math.sin(frame/12)*6;bird.rot=0;scroll(SPEED);if(botOn&&frame>30)flap();return;}
  if(state==='paused')return;
  if(state==='dead'){
    if(bird.y+R<GROUND){bird.v+=G;bird.y+=bird.v;if(bird.y+R>GROUND)bird.y=GROUND-R;}
    bird.rot+=(Math.PI/2-bird.rot)*0.12;
    if(bird.y+R>=GROUND||frame-deadFrame>60)panelT=Math.min(1,panelT+1/18);
    if(panelT>=1&&popPending){popPending=false;popT=1;}
    if(popT>0)popT=Math.max(0,popT-1/36);
    if(botOn&&panelT>=1&&performance.now()-deadAt>1200)reset();
    return;
  }
  // play
  if(botOn&&botDecide(world)){bird.v=FLAP;sfx.flap();}
  step(world,false);
  const ev=world.ev;
  const target=bird.v<0?-0.42:Math.min(Math.PI/2,Math.max(-0.42,(bird.v-2)*0.22));
  bird.rot+=(target-bird.rot)*0.18;
  scroll(world.speed);playFrame=world.playFrame;
  if(ev&SCORED){score=world.score;scoreStr=String(score);scorePop=10;sfx.point();}
  if(ev&NEW_TYPE)showToast('Awas: '+(OBST_NAME[world.newType]||world.newType)+'!');
  if(ev&DIED)die();
}
const OBST_NAME={slide:'Pipa Geser',double:'Pipa Dobel',narrow:'Pipa Sempit'};
function die(){
  if(state!=='play')return;
  state='dead';deadAt=performance.now();deadFrame=frame;deathY=world.deathY;flash=8;shake=14;panelT=0;
  score=world.score;scoreStr=String(score);
  newBest=score>best;if(newBest){best=score;bestStr=String(best);bestLine='Terbaik: '+best;store.set('flappy_best',best);bestRank=rankOf(best);bestRankLabel=rankLabel(bestRank);}
  setRun(score);
  const ru=rankUpCheck(ranksSeen,score);                  // once per tier; skipped tiers never fanfare later
  if(ru.mask!==ranksSeen){ranksSeen=ru.mask;store.set('flappy_ranks_seen',ranksSeen);}
  if(ru.toast){showToast('Pangkat baru: '+RANKS[ru.tier].name+'!');sfx.rank();popPending=true;}
  sfx.hit();sfx.die();
}
function showToast(t){toast={text:t,t:110};}
async function share(){
  const text='Skor saya '+score+' di Flappy Bird. Bisa kalahkan?';const url=location.href;
  try{
    if(navigator.share){await navigator.share({title:'Flappy Bird',text,url});}
    else if(navigator.clipboard){await navigator.clipboard.writeText(text+' '+url);showToast('Tersalin ke clipboard');}
    else showToast('Berbagi tidak didukung');
  }catch(e){if(!e||e.name!=='AbortError')showToast('Tidak bisa berbagi');}
}

// ---------- input ----------
const MUTE={x:W-48,y:12,w:38,h:38},PAUSE={x:10,y:12,w:38,h:38};
const ARROW_L={x:8,y:H/2-22,w:44,h:44},ARROW_R={x:112,y:H/2-22,w:44,h:44};
function panelLayout(){const pw=272,ph=176,px=(W-pw)/2;const ease=1-Math.pow(1-panelT,3);const py=H/2-96+(1-ease)*70;
  return{px,py,pw,ph,again:{x:W/2-132,y:py+ph+16,w:124,h:50},share:{x:W/2+8,y:py+ph+16,w:124,h:50}};}
addEventListener('keydown',e=>{
  if(e.repeat)return;
  if(e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW'){e.preventDefault();flap();}
  else if(e.code==='ArrowLeft'&&state==='ready'){pickStep(-1);}
  else if(e.code==='ArrowRight'&&state==='ready'){pickStep(1);}
  else if(e.code==='KeyP'||e.code==='Escape'){pause();}
  else if(e.code==='KeyM'){toggleMute();}
});
// Title start is on pointerup (a swipe must not start the run); play/pause/restart stay on pointerdown.
let down=null;
addEventListener('pointerdown',e=>{
  if(e.button!==undefined&&e.button!==0)return;
  e.preventDefault();
  const{px,py}=pt(e);
  down={px:px,py:py,t:e.timeStamp,ready:state==='ready',ui:false};
  if(inRect(px,py,MUTE)){down.ui=true;toggleMute();return;}
  if((state==='play'||state==='paused')&&inRect(px,py,PAUSE)){down.ui=true;pause();return;}
  if(state==='dead'&&panelT>=1&&inRect(px,py,panelLayout().share)){down.ui=true;share();return;}
  if(state==='ready')return;
  flap();
});
addEventListener('pointerup',e=>{
  const d=down;down=null;
  if(!d||!d.ready||d.ui||state!=='ready')return;
  if(e.button!==undefined&&e.button!==0)return;
  const{px,py}=pt(e),dx=px-d.px,dy=py-d.py;
  if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)&&e.timeStamp-d.t<500){pickStep(dx<0?1:-1);return;}   // swipe browses, never starts a run
  if(Math.hypot(dx,dy)>=10)return;
  if(inRect(px,py,ARROW_L)){pickStep(-1);return;}
  if(inRect(px,py,ARROW_R)){pickStep(1);return;}
  flap();
});
addEventListener('pointercancel',()=>{down=null;});
addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='play')state='paused';});

// ---------- drawing ----------
function rr(X,Y,w,h,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();}
const F9={},F7={};                                           // font strings cached per size (no per-call concat)
function fontOf(weight,size){const m=weight==='700'?F7:F9;return m[size]||(m[size]=weight+' '+size+'px "Trebuchet MS",Verdana,system-ui,sans-serif');}
function txt(s,X,Y,size,o){
  o=o||O_NONE;const fill=o.fill||'#fff',stroke=o.stroke||'#2a2118',lw=o.lw===undefined?Math.max(3,size/7):o.lw;
  x.font=fontOf(o.weight||'900',size);x.textAlign=o.align||'center';x.textBaseline='middle';x.lineJoin='round';
  if(lw>0&&o.shadow!==false){x.fillStyle=stroke;x.fillText(s,X,Y+Math.max(2,size/12));}
  if(lw>0){x.lineWidth=lw;x.strokeStyle=stroke;x.strokeText(s,X,Y);}
  x.fillStyle=fill;x.fillText(s,X,Y);
}
const O_NONE={};
const O_T1={fill:'#f8e04a',stroke:'#3a2a1a',lw:7},O_T2={fill:'#fff',stroke:'#3a2a1a',lw:7},O_SIAP={fill:'#7ee04a'},O_BEST={fill:'#fff',stroke:'#7a5a30',lw:3},
  O_HELP={fill:'#f3ecc8',stroke:'#7a5a30',lw:2,weight:'700'},O_SC={lw:6},O_JEDA={fill:'#f8e04a'},O_GO={fill:'#f5a623',stroke:'#3a2a1a',lw:6},
  O_LBL={fill:'#c0783a',lw:0,align:'right'},O_NUM={align:'right',lw:4},O_BARU={lw:0},O_TXT3={lw:3},O_BTN={lw:3},O_TOAST={lw:0,weight:'700'},
  O_LOCK={fill:'#ffd9a0',stroke:'#3a2a1a',lw:3},O_NAME={fill:'#fff',stroke:'#3a2a1a',lw:3},
  O_Q={fill:'#e8dba1',stroke:'#a08a52',lw:2,shadow:false},O_MED={fill:'#8a6b33',lw:0},
  O_BESTL={fill:'#fff',stroke:'#7a5a30',lw:3,align:'left'},O_RANKL={fill:'#f3ecc8',stroke:'#7a5a30',lw:2,align:'left',weight:'700'};
let skyDay=null,skyNight=null;
function skyGrad(nt){
  if(nt){if(!skyNight){skyNight=x.createLinearGradient(0,0,0,GROUND);skyNight.addColorStop(0,'#0c173a');skyNight.addColorStop(1,'#3b4f7e');}return skyNight;}
  if(!skyDay){skyDay=x.createLinearGradient(0,0,0,GROUND);skyDay.addColorStop(0,'#4ec0ca');skyDay.addColorStop(1,'#a9e7ec');}return skyDay;
}
function drawSky(){
  x.fillStyle=skyGrad(night);x.fillRect(-20,-20,W+40,GROUND+20);
  if(night){x.fillStyle='#fff';for(let i=0;i<40;i++){const sx=(i*97+13)%W,sy=(i*61+7)%(GROUND-200);const tw=0.5+0.5*Math.sin(frame/20+i);x.globalAlpha=0.4+0.6*tw;x.fillRect(sx,sy,2,2);}x.globalAlpha=1;
    x.fillStyle='#f6f1d0';x.beginPath();x.arc(W-70,90,22,0,7);x.fill();x.fillStyle='#0f1b40';x.beginPath();x.arc(W-62,84,19,0,7);x.fill();}
  else{x.fillStyle='rgba(255,255,255,.85)';x.beginPath();x.arc(W-62,78,26,0,7);x.fill();x.fillStyle='rgba(255,250,200,.9)';x.beginPath();x.arc(W-62,78,20,0,7);x.fill();}
}
function drawPipes(){
  for(let i=0;i<pipes.length;i++){const o=pipes[i];o.def.draw(o);}
}
// pipe palettes: [outline, body, highlight, shade]
const P_GREEN=['#2f5e1a','#73c43f','#a6e55a','#4e9a2b'],P_BLUE=['#1c4f6e','#3fa7c4','#8fe3f2','#2b7f9a'],
  P_GOLD=['#5a3d14','#c98f2a','#f2cf6a','#9a6a1c'],P_RED=['#6e1f14','#d4573a','#f59a7a','#a33a24'];
function pipeBody(px,y0,h,P){if(h<=0)return;x.fillStyle=P[0];x.fillRect(px,y0,PIPE_W,h);x.fillStyle=P[1];x.fillRect(px+3,y0,PIPE_W-6,h);x.fillStyle=P[2];x.fillRect(px+7,y0,8,h);x.fillStyle=P[3];x.fillRect(px+PIPE_W-15,y0,10,h);}
function pipeCap(px,y0,P){const cx=px-3,cw=PIPE_W+6,ch=24;x.fillStyle=P[0];x.fillRect(cx,y0,cw,ch);x.fillStyle=P[1];x.fillRect(cx+3,y0+3,cw-6,ch-6);x.fillStyle=P[2];x.fillRect(cx+9,y0+3,8,ch-6);x.fillStyle=P[3];x.fillRect(cx+cw-18,y0+3,10,ch-6);}
function pipeRim(px,y0,P){const cx=px-3,cw=PIPE_W+6;x.fillStyle=P[0];x.fillRect(cx,y0,cw,8);x.fillStyle=P[1];x.fillRect(cx+3,y0+2,cw-6,4);x.fillStyle=P[2];x.fillRect(cx+9,y0+2,8,4);}
function drawPipeFamily(o,P){                               // plain pipe, slide and narrow share the two-piece shape
  const px=Math.round(o.x),top=Math.round(o.top),bot=top+o.gap;
  pipeBody(px,0,top-24,P);pipeCap(px,top-24,P);
  pipeCap(px,bot,P);pipeBody(px,bot+24,GROUND-bot-24,P);
}
OBST.pipe.draw=function drawPipeObj(o){drawPipeFamily(o,P_GREEN);};
OBST.slide.draw=function drawSlideObj(o){drawPipeFamily(o,P_BLUE);};
OBST.narrow.draw=function drawNarrowObj(o){drawPipeFamily(o,P_RED);};
OBST.double.draw=function drawDoubleObj(o){                 // top piece, a floating block between the two gaps, bottom piece
  const px=Math.round(o.x),top=Math.round(o.top),a=top+o.gap,b=a+o.blk,P=P_GOLD;
  pipeBody(px,0,top-24,P);pipeCap(px,top-24,P);
  pipeBody(px,a,o.blk,P);pipeRim(px,a,P);pipeRim(px,b-8,P);
  pipeCap(px,b+o.gap2,P);pipeBody(px,b+o.gap2+24,GROUND-b-o.gap2-24,P);
};
function drawBird(){
  const ready=state==='ready',idx=ready?pickIdx:skin;
  const sp=ready&&pickLock!==''?SIL[idx]:SPR[idx][state==='dead'?1:WING_SEQ[((frame/5)|0)%4]];
  x.save();x.translate(Math.round(bird.x),Math.round(bird.y));x.rotate(bird.rot);
  x.globalAlpha=0.25;x.fillStyle='#000';x.beginPath();x.ellipse(2,4,14,10,0,0,7);x.fill();x.globalAlpha=1;
  x.drawImage(sp,-13,-12);x.restore();
}
function drawArrow(r,dir){
  rr(r.x,r.y,r.w,r.h,10);x.fillStyle='rgba(0,0,0,.35)';x.fill();
  x.fillStyle='#fff';x.beginPath();const cx=r.x+r.w/2,cy=r.y+r.h/2;
  x.moveTo(cx+dir*7,cy-11);x.lineTo(cx-dir*7,cy);x.lineTo(cx+dir*7,cy+11);x.closePath();x.fill();
}
function drawPicker(){
  drawArrow(ARROW_L,1);drawArrow(ARROW_R,-1);
  if(pickLock!=='')txt(pickLock,80,H/2+44,13,O_LOCK);else txt(pickName,80,H/2+44,14,O_NAME);
  if(sparkleT>0){                                           // unlock sparkle: four twinkling stars around the bird
    for(let i=0;i<4;i++){const a=frame/14+i*1.57,r=26+Math.sin(frame/5+i)*5,sx=80+Math.cos(a)*r,sy=H/2+Math.sin(a)*r*0.8,q=3+Math.abs(Math.sin(frame/4+i*2))*3;
      x.globalAlpha=Math.min(1,sparkleT/30);x.fillStyle='#fff7c0';x.beginPath();x.moveTo(sx,sy-q);x.lineTo(sx+q*0.3,sy-q*0.3);x.lineTo(sx+q,sy);x.lineTo(sx+q*0.3,sy+q*0.3);x.lineTo(sx,sy+q);x.lineTo(sx-q*0.3,sy+q*0.3);x.lineTo(sx-q,sy);x.lineTo(sx-q*0.3,sy-q*0.3);x.closePath();x.fill();}
    x.globalAlpha=1;
  }
}
// ---------- rank emblems: procedural, painted once per tier into a lazy 64*SC px canvas ----------
function poly(g,p,fill,line,lw){g.beginPath();g.moveTo(p[0],p[1]);for(let i=2;i<p.length;i+=2)g.lineTo(p[i],p[i+1]);g.closePath();if(fill){g.fillStyle=fill;g.fill();}if(line){g.lineWidth=lw||2;g.lineJoin='round';g.strokeStyle=line;g.stroke();}}
function disc(g,cx,cy,r,fill,line,lw){g.beginPath();g.arc(cx,cy,r,0,7);if(fill){g.fillStyle=fill;g.fill();}if(line){g.lineWidth=lw||2;g.strokeStyle=line;g.stroke();}}
function spark(g,cx,cy,r,col){poly(g,[cx,cy-r,cx+r*.28,cy-r*.28,cx+r,cy,cx+r*.28,cy+r*.28,cx,cy+r,cx-r*.28,cy+r*.28,cx-r,cy,cx-r*.28,cy-r*.28],col);}
function mirror(p){const q=[];for(let i=0;i<p.length;i+=2){q.push(64-p[i],p[i+1]);}return q;}
function ngon(g,cx,cy,r,n,rot,fill,line,lw){const p=[];for(let i=0;i<n;i++){const a=rot+i*2*Math.PI/n;p.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r);}poly(g,p,fill,line,lw);}
const EMBLEM={
  wood(g,r){disc(g,32,32,30,'#2e1a0a');disc(g,32,32,27,r.c1);disc(g,32,32,23,r.c2);
    g.strokeStyle=r.c1;g.lineWidth=1.6;for(let k=5;k<=17;k+=6){g.beginPath();g.arc(29,35,k,3.5,6.1);g.stroke();}
    disc(g,41,24,3.2,r.c1);disc(g,41,24,1.4,r.c2);g.strokeStyle='rgba(255,255,255,.3)';g.lineWidth=2;g.beginPath();g.arc(32,32,19,3.6,4.7);g.stroke();},
  stone(g,r){poly(g,[8,26,20,8,42,7,56,20,56,42,42,57,20,56,7,42],r.c2,'#33333a',3);
    poly(g,[56,42,42,57,20,56,7,42,30,40],'rgba(0,0,0,.18)');
    g.strokeStyle='#45454d';g.lineWidth=1.8;g.beginPath();g.moveTo(24,14);g.lineTo(30,27);g.lineTo(25,35);g.lineTo(34,48);g.moveTo(44,19);g.lineTo(38,30);g.stroke();
    g.strokeStyle='rgba(255,255,255,.35)';g.lineWidth=2;g.beginPath();g.moveTo(14,24);g.lineTo(22,13);g.stroke();},
  star(g,r){disc(g,32,32,30,'#8a6b33');disc(g,32,32,26,r.c1);disc(g,32,32,20,r.c2);
    const p=[];for(let i=0;i<10;i++){const rad=i%2?6.5:14.5,a=-Math.PI/2+i*Math.PI/5;p.push(32+Math.cos(a)*rad,32+Math.sin(a)*rad);}poly(g,p,r.c1,'rgba(0,0,0,.25)',1);
    g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=2;g.beginPath();g.arc(32,32,23,3.6,4.9);g.stroke();spark(g,46,17,5,'rgba(255,255,255,.9)');},
  hex(g,r){ngon(g,32,32,30,6,-Math.PI/2,r.c1,'#0b2f1b',3);ngon(g,32,32,22,6,-Math.PI/2,r.c2);
    g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=1.4;for(let i=0;i<6;i++){const a=-Math.PI/2+i*Math.PI/3;g.beginPath();g.moveTo(32,32);g.lineTo(32+Math.cos(a)*22,32+Math.sin(a)*22);g.stroke();}
    poly(g,[32,10,13,21,32,32],'rgba(255,255,255,.3)');spark(g,44,18,5,'#fff');},
  rhomb(g,r){poly(g,[32,3,59,32,32,61,5,32],r.c1,'#3d0510',3);
    poly(g,[32,3,5,32,32,32],r.c2);poly(g,[32,3,59,32,32,32],'rgba(255,255,255,.28)');poly(g,[5,32,32,61,32,32],'rgba(0,0,0,.28)');poly(g,[59,32,32,61,32,32],'rgba(0,0,0,.12)');
    spark(g,22,20,5,'#fff');},
  diamond(g,r){poly(g,[15,8,49,8,61,24,32,59,3,24],r.c2,r.c1,3);
    poly(g,[15,8,49,8,43,24,21,24],'#dff1ff');poly(g,[3,24,21,24,32,59],'rgba(111,168,208,.35)');poly(g,[61,24,43,24,32,59],'rgba(111,168,208,.55)');
    g.strokeStyle=r.c1;g.lineWidth=1.3;g.beginPath();g.moveTo(21,24);g.lineTo(15,8);g.moveTo(43,24);g.lineTo(49,8);g.moveTo(21,24);g.lineTo(32,59);g.moveTo(43,24);g.lineTo(32,59);g.moveTo(3,24);g.lineTo(61,24);g.stroke();
    spark(g,50,11,7,'#fff');spark(g,12,40,4,'rgba(255,255,255,.9)');},
  wings(g,r){const wl=[22,16,10,6,3,12,9,18,2,25,11,28,6,35,22,31];poly(g,wl,r.c2,r.c1,2);poly(g,mirror(wl),r.c2,r.c1,2);
    poly(g,[21,12,43,12,43,34,32,52,21,34],r.c1,'#1a2440',3);poly(g,[25,16,39,16,39,32,32,44,25,32],r.c2);disc(g,32,28,4,r.c1);},
  crown(g,r){poly(g,[17,28,47,28,47,46,32,60,17,46],r.c1,'#2a1550',3);poly(g,[21,32,43,32,43,44,32,54,21,44],r.c2);
    poly(g,[19,26,17,8,26,16,32,5,38,16,47,8,45,26],'#ffd25a','#6a4510',2.5);disc(g,17,8,2.4,'#fff3a0');disc(g,32,5,2.6,'#fff3a0');disc(g,47,8,2.4,'#fff3a0');disc(g,32,18,2.8,'#e0493a');},
  laurel(g,r){g.fillStyle=r.c1;for(let i=0;i<7;i++){const a=2.1+i*0.32,rx=32+Math.cos(a)*23,ry=36+Math.sin(a)*21;g.save();g.translate(rx,ry);g.rotate(a+1.2);g.beginPath();g.ellipse(0,0,7,3.2,0,0,7);g.fill();g.restore();
      g.save();g.translate(64-rx,ry);g.rotate(Math.PI-(a+1.2));g.beginPath();g.ellipse(0,0,7,3.2,0,0,7);g.fill();g.restore();}
    g.beginPath();g.moveTo(32,8);g.bezierCurveTo(46,24,48,40,32,57);g.bezierCurveTo(16,40,19,26,32,8);g.fillStyle=r.c2;g.fill();g.lineWidth=2.5;g.strokeStyle='#7a3a08';g.stroke();
    g.beginPath();g.moveTo(32,26);g.bezierCurveTo(39,35,39,45,32,52);g.bezierCurveTo(25,45,26,36,32,26);g.fillStyle='#fff3c0';g.fill();},
  phoenix(g,r){disc(g,32,32,30,'#3b0f06');disc(g,32,32,27,r.c1);
    const wg=[31,36,20,28,9,12,5,30,12,40,22,46];poly(g,wg,r.c2,'#7a2008',1.8);poly(g,mirror(wg),r.c2,'#7a2008',1.8);
    poly(g,[28,46,24,62,32,52,40,62,36,46],'#ffd25a','#a23a0c',1.5);
    g.beginPath();g.ellipse(32,36,6,11,0,0,7);g.fillStyle='#ffe6a0';g.fill();g.lineWidth=1.6;g.strokeStyle='#7a2008';g.stroke();
    disc(g,32,22,5.5,'#ffe6a0','#7a2008',1.6);poly(g,[37,22,43,24,37,26],'#f58a1f');disc(g,34,21,1.3,'#15110d');poly(g,[29,18,27,10,32,15],'#ff6a2a');},
  halo(g,r){disc(g,32,33,29,'#161c4a','#c99512',3);
    for(let i=0;i<7;i++)disc(g,10+((i*37)%44),16+((i*23)%38),0.9,'#fff');
    g.lineWidth=3.4;g.strokeStyle=r.c1;g.beginPath();g.ellipse(32,12,15,5,0,0,7);g.stroke();g.lineWidth=1.4;g.strokeStyle=r.c2;g.beginPath();g.ellipse(32,11,15,5,0,0,7);g.stroke();
    poly(g,[37,18,22,36,31,36,26,57,44,30,34,30],r.c2,'#c99512',2);spark(g,48,22,4,'#fff');spark(g,16,42,4,'#fff');}
};
function getEmblem(t){
  let cv=emblemCache[t];if(cv)return cv;
  const S=Math.max(16,Math.ceil(64*SC));cv=document.createElement('canvas');cv.width=cv.height=S;
  const g=cv.getContext('2d');g.scale(S/64,S/64);EMBLEM[RANKS[t].motif](g,RANKS[t]);
  emblemCache[t]=cv;return cv;
}
function drawEmblem(t,cx,cy,size){
  if(t<0){x.beginPath();x.arc(cx,cy,size*0.47,0,7);x.fillStyle='#8a6b33';x.fill();x.beginPath();x.arc(cx,cy,size*0.41,0,7);x.fillStyle='#cbbd86';x.fill();txt('?',cx,cy+1,26,O_Q);return;}
  x.imageSmoothingEnabled=true;x.drawImage(getEmblem(t),cx-size/2,cy-size/2,size,size);x.imageSmoothingEnabled=false;
}
function drawDots(cx,cy,n,tier){                              // sub-level I/II/III
  for(let i=0;i<3;i++){x.beginPath();x.arc(cx+(i-1)*12,cy,3.6,0,7);x.fillStyle=i<n?(tier>=0?RANKS[tier].c1:'#8a6b33'):'rgba(138,107,51,.25)';x.fill();x.lineWidth=1.2;x.strokeStyle='#8a6b33';x.stroke();}
}
function drawRankPanel(L){
  const cx=L.px+62,cy=L.py+58,pop=popT>0?1+0.4*Math.sin(popT*Math.PI):1;
  drawEmblem(runRank.tier,cx,cy,60*pop);
  if(runRank.tier>=0)drawDots(cx,L.py+98,runRank.sub+1,runRank.tier);
  txt(runLabel,cx,L.py+116,runRank.tier<0?11:14,O_MED);
  const bx=L.px+16,bw=L.pw-32,by=L.py+138;
  rr(bx,by,bw,10,5);x.fillStyle='rgba(138,107,51,.28)';x.fill();
  if(runFrac>0){rr(bx,by,Math.max(10,bw*runFrac),10,5);x.fillStyle=runRank.tier>=0?RANKS[runRank.tier].c2:'#c0783a';x.fill();}
  rr(bx,by,bw,10,5);x.lineWidth=1.6;x.strokeStyle='#8a6b33';x.stroke();
  txt(runNextText,L.px+L.pw/2,L.py+L.ph-12,12,O_MED);
}
function button(r,label,color,dark){rr(r.x,r.y+3,r.w,r.h,8);x.fillStyle=dark;x.fill();rr(r.x,r.y,r.w,r.h,8);x.fillStyle=color;x.fill();x.lineWidth=3;x.strokeStyle='#2a2118';x.stroke();txt(label,r.x+r.w/2,r.y+r.h/2+1,17,O_BTN);}
function drawIcons(){
  // mute
  rr(MUTE.x,MUTE.y,MUTE.w,MUTE.h,8);x.fillStyle='rgba(0,0,0,.35)';x.fill();
  x.fillStyle='#fff';x.beginPath();x.moveTo(MUTE.x+9,MUTE.y+15);x.lineTo(MUTE.x+15,MUTE.y+15);x.lineTo(MUTE.x+22,MUTE.y+9);x.lineTo(MUTE.x+22,MUTE.y+29);x.lineTo(MUTE.x+15,MUTE.y+23);x.lineTo(MUTE.x+9,MUTE.y+23);x.closePath();x.fill();
  x.strokeStyle='#fff';x.lineWidth=2.5;x.beginPath();x.arc(MUTE.x+22,MUTE.y+19,8,-0.9,0.9);x.stroke();
  if(muted){x.strokeStyle='#ff5a4a';x.lineWidth=3.5;x.beginPath();x.moveTo(MUTE.x+8,MUTE.y+30);x.lineTo(MUTE.x+30,MUTE.y+8);x.stroke();}
  // pause
  if(state==='play'||state==='paused'){rr(PAUSE.x,PAUSE.y,PAUSE.w,PAUSE.h,8);x.fillStyle='rgba(0,0,0,.35)';x.fill();x.fillStyle='#fff';
    if(state==='play'){x.fillRect(PAUSE.x+12,PAUSE.y+10,5,18);x.fillRect(PAUSE.x+21,PAUSE.y+10,5,18);}
    else{x.beginPath();x.moveTo(PAUSE.x+13,PAUSE.y+10);x.lineTo(PAUSE.x+28,PAUSE.y+19);x.lineTo(PAUSE.x+13,PAUSE.y+28);x.closePath();x.fill();}}
}
let bestLine='';
function drawUI(){
  if(state==='ready'){
    const bob=Math.sin(frame/14)*4;
    txt('FLAPPY',W/2,140+bob,56,O_T1);
    txt('BIRD',W/2,196+bob,56,O_T2);
    txt('Siap?',W/2,H/2-70,30,O_SIAP);
    drawPicker();
    const a=0.55+0.45*Math.sin(frame/8);x.globalAlpha=a;txt('Tap / Spasi untuk terbang',W/2,H/2+96,18,O_TXT3);x.globalAlpha=1;
    const k=(frame%45)/45;x.globalAlpha=1-k;x.strokeStyle='#fff';x.lineWidth=3;x.beginPath();x.arc(W/2,H/2+150,10+k*22,0,7);x.stroke();x.globalAlpha=1;
    x.fillStyle='#fff';x.beginPath();x.arc(W/2,H/2+150,7,0,7);x.fill();
    if(best>0){drawEmblem(bestRank.tier,W/2-80,GROUND+34,34);txt(bestLine,W/2-56,GROUND+32,16,O_BESTL);txt(bestRankLabel,W/2-56,GROUND+52,12,O_RANKL);}
    txt('P: jeda  ·  M: suara',W/2,GROUND+70,11,O_HELP);
  }else if(state==='play'||state==='paused'){
    const s=1+scorePop/10*0.35;x.save();x.translate(W/2,74);x.scale(s,s);txt(scoreStr,0,0,50,O_SC);x.restore();
    if(state==='paused'){x.fillStyle='rgba(0,0,0,.45)';x.fillRect(0,0,W,H);txt('JEDA',W/2,H/2-20,44,O_JEDA);txt('Tap untuk lanjut',W/2,H/2+30,18);}
  }else if(state==='dead'){
    if(panelT<=0)txt(scoreStr,W/2,74,50,O_SC);
    if(panelT>0){
      const L=panelLayout();x.globalAlpha=Math.min(1,panelT*1.5);
      txt('GAME OVER',W/2,L.py-44,40,O_GO);
      rr(L.px,L.py+4,L.pw,L.ph,10);x.fillStyle='#8a6b33';x.fill();
      rr(L.px,L.py,L.pw,L.ph,10);x.fillStyle='#e8dba1';x.fill();x.lineWidth=3;x.strokeStyle='#c9a064';x.stroke();
      rr(L.px+6,L.py+6,L.pw-12,L.ph-12,7);x.lineWidth=2;x.strokeStyle='#f6eec9';x.stroke();
      drawRankPanel(L);
      const rx=L.px+L.pw-26;
      txt('SKOR',rx,L.py+30,13,O_LBL);txt(scoreStr,rx,L.py+56,32,O_NUM);
      txt('TERBAIK',rx,L.py+94,13,O_LBL);txt(bestStr,rx,L.py+120,32,O_NUM);
      if(newBest){rr(L.px+L.pw-124,L.py+84,46,20,5);x.fillStyle='#e0493a';x.fill();txt('BARU',L.px+L.pw-101,L.py+95,12,O_BARU);}
      if(panelT>=1){button(L.again,'MAIN LAGI','#6cc83a','#3e8a1e');button(L.share,'BAGIKAN','#3b9bd8','#1f6ea3');}
      x.globalAlpha=1;
    }
  }
}
function draw(){
  x.setTransform(SC,0,0,SC,0,0);x.imageSmoothingEnabled=false;
  const L=night?LAYERS.night:LAYERS.day;
  x.save();
  if(shake>0)x.translate((Math.random()-.5)*shake*0.7,(Math.random()-.5)*shake*0.7);
  drawSky();
  layer(L.clouds,GROUND-250,bg.cloud);
  layer(L.skyline,GROUND-144,bg.sky);
  layer(L.bushes,GROUND-44,bg.bush);
  drawPipes();
  layer(groundTile,GROUND,bg.gnd);
  x.fillStyle='#dfd59a';x.fillRect(-20,GROUND+80,W+40,40);
  drawBird();
  x.restore();
  drawUI();drawIcons();
  if(flash>0){x.globalAlpha=flash/8;x.fillStyle='#fff';x.fillRect(0,0,W,H);x.globalAlpha=1;}
  if(toast){x.globalAlpha=Math.min(1,toast.t/20);x.font='700 14px system-ui,sans-serif';const tw=x.measureText(toast.text).width+28;rr((W-tw)/2,H-62,tw,32,8);x.fillStyle='rgba(20,20,30,.85)';x.fill();txt(toast.text,W/2,H-46,14,O_TOAST);x.globalAlpha=1;}
}

// ---------- test / QA hooks ----------
window.__flappy={
  version:'3.0.1',
  get seed(){return world.seed;},
  get score(){return score;},
  get rank(){return rankOf(score);},
  get panel(){return{label:runLabel,next:runNextText,tier:runRank.tier,sub:runRank.sub,frac:runFrac};},
  get ranksSeen(){return ranksSeen;},
  step(n,f){for(let i=0;i<n;i++){if(f&&state==='play'&&f(i))bird.v=FLAP;update();}return score;},
  blocked(k){const out=new Float64Array(32),n=blockedAt(world,k||0,out);return Array.from(out.subarray(0,2*n));},
  corridors(k){const r=new Float64Array(32),f=new Float64Array(32),n=blockedAt(world,k||0,r),m=freeIntervals(r,n,f);return Array.from(f.subarray(0,2*m));},
  snapshot(){return{w:snapshotWorld(world),state:state,frame:frame,playFrame:playFrame,score:score,night:night,skin:skin,panelT:panelT,deadFrame:deadFrame,deathY:deathY,scoreStr:scoreStr};},
  restore(s){restoreWorld(world,s.w);state=s.state;frame=s.frame;playFrame=s.playFrame;score=s.score;night=s.night;skin=s.skin;panelT=s.panelT;deadFrame=s.deadFrame;deathY=s.deathY;scoreStr=s.scoreStr;},
  rankOf(n){return rankOf(n);},
  skinUnlocked(id,b){return skinUnlocked(id,b);},
  selectSkin(id){return selectSkin(id);},
  pickStep(d){pickStep(d);return pickIdx;},
  get pick(){return{pickIdx:pickIdx,pickId:SKIN_META[pickIdx].id,skinId:skinId,locked:pickLock!=='',text:pickLock||pickName};},
  get skinsSeen(){return skinsSeen;}
};

// ---------- fixed 60 Hz timestep: identical speed on 60/90/120/144 Hz displays ----------
const STEP=1000/60;let last=performance.now(),acc=0;
function loop(now){
  acc+=Math.min(now-last,250);last=now;
  while(acc>=STEP){update();acc-=STEP;}
  draw();requestAnimationFrame(loop);
}
bestLine='Terbaik: '+best;
reset();requestAnimationFrame(loop);
