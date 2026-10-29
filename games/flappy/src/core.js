'use strict';
/*@core*/
// ============================================================================
// CORE — pure game logic. No document / canvas / localStorage / Math.random /
// performance / Date / audio in here: the test harness runs this block in an
// EMPTY Node vm context, so any such reference throws. All randomness comes from
// world.rand (mulberry32). The shell below turns world.ev bits into sound/FX.
// ============================================================================
// physics constants (identical to v2)
const W=360,H=640,GROUND=H-80;
const G=0.45,FLAP=-7.5,GAP=150,PIPE_W=56,SPEED=2.4,SPAWN=95,R=14;
const BX=80;                                   // bird column centre (bird.x at start)
// fairness constants (RFC §3)
const MIN_OPEN=130,TELE=72,CLEAR=90,CLIMB=4.5,BAND_V=2,REROLL=4;
// world.ev bits
const SCORED=1,DIED=2,ROAR=4,NEW_TYPE=8;
const INF=Infinity;

function mulberry32(seed){
  const s={a:seed|0};
  const f=function(){const a=s.a=(s.a+0x6D2B79F5)|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
  f.s=s;return f;
}
function speedFor(score){return SPEED;}        // v3.1 adds the 160..200 ramp here

// ---------- ranks (RFC §5) — append-only, a tier's bit is never reused ----------
const RANKS=[
  {id:'kayu',name:'Kayu',min:1,motif:'wood',c1:'#6b4423',c2:'#b07a42'},
  {id:'batu',name:'Batu',min:5,motif:'stone',c1:'#5d5d66',c2:'#aeb0b8'},
  {id:'perunggu',name:'Perunggu',min:10,motif:'star',c1:'#a3602b',c2:'#e8a66a'},
  {id:'perak',name:'Perak',min:20,motif:'star',c1:'#8c8c94',c2:'#eeeeee'},
  {id:'emas',name:'Emas',min:30,motif:'star',c1:'#d99a12',c2:'#ffe066'},
  {id:'platinum',name:'Platinum',min:40,motif:'star',c1:'#5fc5e6',c2:'#c4f3ff'},
  {id:'zamrud',name:'Zamrud',min:55,motif:'hex',c1:'#14804a',c2:'#5fe39a'},
  {id:'rubi',name:'Rubi',min:70,motif:'rhomb',c1:'#a80f2b',c2:'#ff6178'},
  {id:'berlian',name:'Berlian',min:90,motif:'diamond',c1:'#6fa8d0',c2:'#ffffff'},
  {id:'master',name:'Master',min:120,motif:'wings',c1:'#4b5c86',c2:'#d4def5'},
  {id:'grandmaster',name:'Grandmaster',min:150,motif:'crown',c1:'#6c3fae',c2:'#e6cdff'},
  {id:'legenda',name:'Legenda',min:200,motif:'laurel',c1:'#b86f12',c2:'#ffd25a'},
  {id:'mitos',name:'Mitos',min:250,motif:'phoenix',c1:'#c9381a',c2:'#ffb347'},
  {id:'dewa',name:'Dewa',min:300,motif:'halo',c1:'#c99512',c2:'#fff3a0'}
];
RANKS.forEach((r,i)=>{r.bit=1<<i;});
const DEWA_SPAN=150;                           // Dewa has no next tier: virtual span for its sub-levels
// rankOf(score) -> {tier, sub, next}. tier -1 = no rank yet; sub 0..2 = I..III;
// next = score of the next sub-level / tier, or -1 at the top (Dewa III).
function rankOf(score){
  if(!(score>=1))return{tier:-1,sub:0,next:1,from:0};
  let t=0;for(let i=RANKS.length-1;i>=0;i--){if(score>=RANKS[i].min){t=i;break;}}
  const mn=RANKS[t].min,span=(t<RANKS.length-1?RANKS[t+1].min:mn+DEWA_SPAN)-mn;
  const s2=mn+Math.round(span/3),s3=mn+Math.round(2*span/3);
  const sub=score>=s3?2:score>=s2?1:0,from=sub===0?mn:sub===1?s2:s3;
  const next=sub===0?s2:sub===1?s3:(t<RANKS.length-1?RANKS[t+1].min:-1);
  return{tier:t,sub:sub,next:next,from:from};
}
// once-per-tier: marks every tier <= t as seen (a skipped tier never fanfares later)
function rankUpMask(mask,tier){return tier<0?mask:(mask|((1<<(tier+1))-1));}
// what happens on a death: {tier, toast: first time this tier is reached, mask: the updated ranks_seen}
function rankUpCheck(seen,score){const t=rankOf(score).tier;return{tier:t,toast:t>=0&&(seen&RANKS[t].bit)===0,mask:rankUpMask(seen,t)};}
const MASK_RANKS=(1<<14)-1,MASK_SKINS=(1<<11)-1;
// skins that are unlocked by `best` but not yet announced: {n: how many, mask: seen | those}
function skinNews(seen,best){let n=0,m=seen;for(let i=0;i<SKIN_META.length;i++){const k=SKIN_META[i];if(best>=k.unlock&&(seen&k.bit)===0){n++;m|=k.bit;}}return{n:n,mask:m};}
const PALETTE_SKINS_MASK=7;                     // kuning|biru|merah are unlocked from the start

// ---------- skins (meta only; sprites live in the art section) ----------
const SKIN_META=[
  {id:'kuning',name:'Kuning',unlock:0},{id:'biru',name:'Biru',unlock:0},{id:'merah',name:'Merah',unlock:0},
  {id:'pipit',name:'Pipit',unlock:10},{id:'hantu',name:'Burung Hantu',unlock:25},{id:'penguin',name:'Penguin',unlock:50},
  {id:'elang',name:'Elang',unlock:75},{id:'flamingo',name:'Flamingo',unlock:100},{id:'robo',name:'Robo-Bird',unlock:150},
  {id:'phoenix',name:'Phoenix',unlock:200},{id:'dewa',name:'Dewa',unlock:300}
];
SKIN_META.forEach((s,i)=>{s.bit=1<<i;});
function skinIndex(id){for(let i=0;i<SKIN_META.length;i++)if(SKIN_META[i].id===id)return i;return -1;}
function skinUnlocked(id,best){const i=skinIndex(id);return i>=0&&best>=SKIN_META[i].unlock;}

// ---------- persistence parsers (pure; the shell does the storage I/O) ----------
function parseBest(s){                          // integer 0..99999, else 0
  if(typeof s!=='string')return 0;
  const t=s.trim();if(!/^\d+(\.\d+)?$/.test(t))return 0;
  const n=Math.floor(+t);return n<=99999?n:0;
}
function parseMask(s,max){                      // int bitmask 0..max, else -1 (= missing/malformed)
  if(typeof s!=='string')return -1;
  const t=s.trim();if(!/^\d{1,6}$/.test(t))return -1;
  const n=+t;return n<=max?n:-1;
}

// ---------- obstacle registry (RFC §2/§4) ----------
// o fields (same shape for every type): def,type,x,top,passed,gap,w,t,base,blk,gap2
function makeObs(){return{def:null,type:'',x:W,top:0,passed:false,gap:GAP,w:PIPE_W,t:0,base:0,blk:0,gap2:0};}
function initObs(o,def){o.def=def;o.type=def.id;o.x=W;o.top=0;o.passed=false;o.gap=GAP;o.w=def.w;o.t=0;o.base=0;o.blk=0;o.gap2=0;}
// v2 hit test, verbatim (RFC §2: pipe collision unchanged)
function collidePipe(o,b){
  const inX=b.x+R>o.x&&b.x-R<o.x+o.w;
  const hitY=b.y-R<o.top||b.y+R>o.top+o.gap;
  return inX&&hitY;
}
function collideDouble(o,b){
  if(!(b.x+R>o.x&&b.x-R<o.x+o.w))return false;
  const y0=o.top+o.gap,y1=y0+o.blk;
  return b.y-R<o.top||b.y+R>y1+o.gap2||(b.y+R>y0&&b.y-R<y1);
}
// blocked(o, k, out): open y-ranges (lo,hi) the bird CENTRE cannot use while its column
// overlaps the obstacle, k frames from now, already widened by R. Returns pair count.
function blockedPipe(top,gap,out){out[0]=-INF;out[1]=top+R;out[2]=top+gap-R;out[3]=INF;return 2;}
function noUpdate(o){}
const SLIDE_AMP=40,SLIDE_PERIOD=144,SLIDE_MIN=60,SLIDE_MAX=GROUND-GAP-60;
function slideTop(base,t){const v=base+SLIDE_AMP*Math.sin(2*Math.PI*t/SLIDE_PERIOD);return v<SLIDE_MIN?SLIDE_MIN:v>SLIDE_MAX?SLIDE_MAX:v;}
const DOUBLE_GAP=140,DOUBLE_BLOCK=40,NARROW_GAP=130;

const OBST={
  pipe:{id:'pipe',from:0,w:PIPE_W,special:false,noRepeat:false,
    spawn(o,rand){o.top=60+rand()*(GROUND-GAP-120);},          // v2 l.126: exactly one rand()
    update:noUpdate,collide:collidePipe,
    blocked(o,k,out){return blockedPipe(o.top,o.gap,out);}},
  slide:{id:'slide',from:15,w:PIPE_W,special:false,noRepeat:false,
    spawn(o,rand){o.base=100+rand()*(GROUND-GAP-120-80);o.top=o.base;},   // +-40 stays inside [60,350]
    update(o){o.top=slideTop(o.base,o.t);},
    collide:collidePipe,
    blocked(o,k,out){return blockedPipe(slideTop(o.base,o.t+k),o.gap,out);}},
  double:{id:'double',from:25,w:PIPE_W,special:false,noRepeat:false,
    spawn(o,rand){o.gap=DOUBLE_GAP;o.blk=DOUBLE_BLOCK;o.gap2=DOUBLE_GAP;o.top=60+rand()*(GROUND-380-60);},
    update:noUpdate,collide:collideDouble,
    blocked(o,k,out){const a=o.top+o.gap,b=a+o.blk;
      out[0]=-INF;out[1]=o.top+R;out[2]=a-R;out[3]=b+R;out[4]=b+o.gap2-R;out[5]=INF;return 3;}},   // 3 ranges, not 0-2 (RFC §2)
  narrow:{id:'narrow',from:35,w:PIPE_W,special:false,noRepeat:true,
    spawn(o,rand){o.gap=NARROW_GAP;o.top=60+rand()*(GROUND-NARROW_GAP-120);},
    update:noUpdate,collide:collidePipe,
    blocked(o,k,out){return blockedPipe(o.top,o.gap,out);}}
};
const OBSTS=[OBST.pipe,OBST.slide,OBST.double,OBST.narrow];      // ordered by `from`; v3.1 appends here
OBSTS.forEach((d,i)=>{d.bit=1<<i;});

// ---------- free-interval helper: blocked open ranges -> free closed intervals ----------
// r: n pairs (any order, may overlap; sorted in place). f: output pairs inside [R, GROUND-R].
function freeIntervals(r,n,f){
  for(let i=1;i<n;i++){const lo=r[2*i],hi=r[2*i+1];let j=i-1;
    while(j>=0&&r[2*j]>lo){r[2*j+2]=r[2*j];r[2*j+3]=r[2*j+1];j--;}
    r[2*j+2]=lo;r[2*j+3]=hi;}
  const UB=GROUND-R;let cur=R,m=0;
  for(let i=0;i<n;i++){const lo=r[2*i],hi=r[2*i+1];const e=lo<UB?lo:UB;
    if(e>cur){f[2*m]=cur;f[2*m+1]=e;m++;}
    if(hi>cur)cur=hi;}
  if(cur<UB){f[2*m]=cur;f[2*m+1]=UB;m++;}
  return m;
}
// union of blocked ranges of every obstacle whose column overlaps the bird k frames from now
function blockedAt(w,k,out){
  const b=w.bird,obs=w.obs,tmp=w.t4;let n=0;
  for(let i=0;i<obs.length;i++){const o=obs[i];const px=o.x-w.speed*k;
    if(b.x+R>px&&b.x-R<px+o.w){const c=o.def.blocked(o,k,tmp);for(let j=0;j<2*c;j++)out[2*n+j]=tmp[j];n+=c;}}
  return n;
}

// ---------- fairness (RFC §3). returns 0 = fair, else the number of the broken rule ----------
function fairCheck(prev,o,w){
  const fc=w.fc,s=Math.max(w.speed,speedFor(w.score+3));
  const ke=Math.floor((o.x-(BX+R))/s)+1;                 // first frame the bird column overlaps o
  const kl=Math.ceil((o.x+o.w-(BX-R))/s)-1;              // last frame it overlaps
  if(ke<fc.TELE)return 2;                                // F2: >= 72 frames of warning (cue is visible from spawn)
  if(prev&&o.x-(prev.x+prev.w)<fc.CLEAR)return 3;        // F3: clear distance between obstacles
  const out=w.t1,f=w.t2,pv=w.t3,need=fc.MIN_OPEN-2*R-1e-6;let pn=-1;
  for(let k=ke;k<=kl;k++){
    const n=o.def.blocked(o,k,out);
    if(pn>=0){                                           // F5: no band edge moves faster than BAND_V per frame
      if(n!==pn)return 5;
      for(let i=0;i<2*n;i++){const a=out[i],b=pv[i];if(a===b)continue;if(!(Math.abs(a-b)<=fc.BAND_V+1e-9))return 5;}
    }
    for(let i=0;i<2*n;i++)pv[i]=out[i];pn=n;
    const m=freeIntervals(out,n,f);let best=0;           // F1: some open interval stays >= 130 px (102 px for the centre)
    for(let i=0;i<m;i++){const L=f[2*i+1]-f[2*i];if(L>best)best=L;}
    if(best<need)return 1;
  }
  if(prev){                                              // F4: climb between prev's exit band and o's entry band
    const kp=(prev.x+prev.w-(BX-R))/s;
    if(kp>0){
      const off=Math.max(0,Math.ceil(kp)-1);
      const np=prev.def.blocked(prev,off,out),mp=freeIntervals(out,np,f);
      const nq=o.def.blocked(o,ke,w.t5),mq=freeIntervals(w.t5,nq,w.t6);
      const avail=(o.x-(BX+R))/s-kp;let dist=INF;
      for(let i=0;i<mp;i++)for(let j=0;j<mq;j++){
        const d=Math.max(0,w.t6[2*j]-f[2*i+1],f[2*i]-w.t6[2*j+1]);if(d<dist)dist=d;}
      if(dist>fc.CLIMB*avail)return 4;
    }
  }
  return 0;
}

// ---------- scheduler (RFC §2) ----------
function pickDef(w){
  const prev=w.last,sc=w.score,el=w.el;let n=0,newest=OBSTS[0];
  for(let i=0;i<OBSTS.length;i++){const d=OBSTS[i];if(d.from>sc)continue;newest=d;
    if(prev&&((d.special&&prev.def.special)||(d.noRepeat&&prev.def===d)))continue;   // pacing rules
    el[n++]=d;}
  if(n<=1)return n===1?el[0]:OBST.pipe;                  // below score 15: pipe only, no rand() consumed
  for(let i=0;i<n;i++){const d=el[i];if(d.from>0&&!(w.seen&d.bit))return d;}      // first appearance is forced
  let sum=0;
  for(let i=0;i<n;i++){const d=el[i];sum+=d===OBST.pipe?2:(d===newest&&sc-d.from<10)?3:1;}
  let r=w.rand()*sum;
  for(let i=0;i<n;i++){const d=el[i];r-=d===OBST.pipe?2:(d===newest&&sc-d.from<10)?3:1;if(r<0)return d;}
  return el[n-1];
}
function fallbackPipe(w,o,prev){                         // plain pipe clamped so its band overlaps prev's exit band
  initObs(o,OBST.pipe);let top=60+(GROUND-GAP-120)/2;
  if(prev){
    const s=Math.max(w.speed,speedFor(w.score+3)),kp=(prev.x+prev.w-(BX-R))/s;
    if(kp>0){const np=prev.def.blocked(prev,Math.max(0,Math.ceil(kp)-1),w.t1),m=freeIntervals(w.t1,np,w.t2);
      let bi=-1,bl=-1;for(let i=0;i<m;i++){const L=w.t2[2*i+1]-w.t2[2*i];if(L>bl){bl=L;bi=i;}}
      if(bi>=0){const mid=(w.t2[2*bi]+w.t2[2*bi+1])/2;top=Math.min(GROUND-GAP-60,Math.max(60,mid-GAP/2));}}
  }
  o.top=top;
}
function spawnNext(w){
  const prev=w.last,sc=w.score;let o=w.cand,def=OBST.pipe,ok=false;
  w.speed=speedFor(sc);                                   // speed changes only at spawn time
  for(let a=0;a<=REROLL;a++){
    def=pickDef(w);initObs(o,def);def.spawn(o,w.rand,sc,prev);
    if(fairCheck(prev,o,w)===0){ok=true;break;}
    if(a<REROLL)w.rerolls++;
  }
  if(!ok){fallbackPipe(w,o,prev);def=OBST.pipe;w.fallbacks++;}
  if(def.from>0&&!(w.seen&def.bit)){w.seen|=def.bit;w.ev|=NEW_TYPE;w.newType=def.id;}
  if(w.hook)w.hook(o,prev);
  w.obs.push(o);w.last=o;w.spawns++;
  w.cand=w.free.length?w.free.pop():makeObs();
  w.nextSpawn+=Math.max(SPAWN,Math.ceil((o.w+90)/w.speed));
}

// ---------- world ----------
function createWorld(seed,startScore){
  const w={seed:seed|0,rand:mulberry32(seed),bird:{x:BX,y:H/2,v:0,r:R,rot:0},obs:[],free:[],cand:makeObs(),el:[],
    score:startScore|0,playFrame:0,nextSpawn:SPAWN,speed:SPEED,ev:0,dead:false,deathY:0,seen:0,newType:'',last:null,
    rerolls:0,fallbacks:0,spawns:0,hook:null,
    fc:{MIN_OPEN:MIN_OPEN,TELE:TELE,CLEAR:CLEAR,CLIMB:CLIMB,BAND_V:BAND_V},
    t1:new Float64Array(32),t2:new Float64Array(32),t3:new Float64Array(32),t4:new Float64Array(32),t5:new Float64Array(32),t6:new Float64Array(32)};
  for(let i=0;i<6;i++)w.free.push(makeObs());
  for(let i=0;i<OBSTS.length;i++)if(OBSTS[i].from>0&&OBSTS[i].from<=w.score)w.seen|=OBSTS[i].bit;   // test-only start scores
  return w;
}
function killBird(w){
  if(w.dead)return;
  w.dead=true;w.ev|=DIED;w.deathY=w.bird.y;w.bird.v=Math.max(w.bird.v,0);
}
// obstacle half of a frame (spawn, scroll, score, collide). The oracle drives this alone with a ghost bird.
function stepWorld(w){
  const b=w.bird,obs=w.obs;
  w.playFrame++;
  if(w.playFrame===w.nextSpawn)spawnNext(w);              // v2: playFrame%SPAWN===0
  for(let i=0;i<obs.length;i++){const o=obs[i];
    o.x-=w.speed;o.t++;o.def.update(o);
    if(!o.passed&&o.x+o.w<b.x){o.passed=true;w.score++;w.ev|=SCORED;}   // may still score after killBird() — same as v2
    if(o.def.collide(o,b))killBird(w);
  }
  let j=0;
  for(let i=0;i<obs.length;i++){const o=obs[i];
    if(o.x+o.w>0)obs[j++]=o;else{if(w.last===o)w.last=null;w.free.push(o);}}
  obs.length=j;
}
// one 60 Hz play frame. flap: apply the flap impulse first (the shell normally sets bird.v itself on input).
function step(w,flap){
  const b=w.bird;w.ev=0;
  if(flap)b.v=FLAP;
  b.v+=G;b.y+=b.v;
  stepWorld(w);
  if(b.y+R>GROUND){b.y=GROUND-R;killBird(w);}
  if(b.y-R<0){b.y=R;killBird(w);}
}
// snapshot / restore (plain data, restores IN PLACE so the shell's `bird` / `pipes` references stay valid)
function snapshotWorld(w){
  const o=[];for(let i=0;i<w.obs.length;i++){const p=w.obs[i];
    o.push({type:p.type,x:p.x,top:p.top,passed:p.passed,gap:p.gap,w:p.w,t:p.t,base:p.base,blk:p.blk,gap2:p.gap2});}
  return{rs:w.rand.s.a,seed:w.seed,bird:{x:w.bird.x,y:w.bird.y,v:w.bird.v,rot:w.bird.rot},obs:o,last:w.obs.indexOf(w.last),
    score:w.score,playFrame:w.playFrame,nextSpawn:w.nextSpawn,speed:w.speed,ev:w.ev,dead:w.dead,deathY:w.deathY,seen:w.seen,
    newType:w.newType,rerolls:w.rerolls,fallbacks:w.fallbacks,spawns:w.spawns};
}
function restoreWorld(w,s){
  while(w.obs.length)w.free.push(w.obs.pop());
  for(let i=0;i<s.obs.length;i++){const q=s.obs[i],o=w.free.length?w.free.pop():makeObs();
    o.def=OBST[q.type];o.type=q.type;o.x=q.x;o.top=q.top;o.passed=q.passed;o.gap=q.gap;o.w=q.w;o.t=q.t;o.base=q.base;o.blk=q.blk;o.gap2=q.gap2;w.obs.push(o);}
  w.last=s.last>=0?w.obs[s.last]:null;w.rand.s.a=s.rs;w.seed=s.seed;
  Object.assign(w.bird,s.bird);
  w.score=s.score;w.playFrame=s.playFrame;w.nextSpawn=s.nextSpawn;w.speed=s.speed;w.ev=s.ev;w.dead=s.dead;w.deathY=s.deathY;
  w.seen=s.seen;w.newType=s.newType;w.rerolls=s.rerolls;w.fallbacks=s.fallbacks;w.spawns=s.spawns;
}
/*@endcore*/

