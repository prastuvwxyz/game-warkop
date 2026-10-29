'use strict';
/*@bot*/
// ---------- lookahead bot (RFC §3 layer 3; drives ?bot=1 and the smoke tests) ----------
// Picks flap / no-flap by which survives longer when one more flap is allowed later.
const BOT_N=36,BOT_M=2;
const botT=new Float64Array((BOT_N+1)*32),botC=new Int32Array(BOT_N+1),botF=new Float64Array(32),botG=new Float64Array(32);
function botBlocked(k,y){const n=botC[k],base=k*32;for(let i=0;i<n;i++){if(y>botT[base+2*i]-BOT_M&&y<botT[base+2*i+1]+BOT_M)return true;}return false;}
function botSurvive(y0,v0,flapNow){
  let best=0;
  for(let j=1;j<=BOT_N+1;j++){
    let y=y0,v=flapNow?FLAP:v0,k=1;
    for(;k<=BOT_N;k++){if(k===j)v=FLAP;v+=G;y+=v;if(y<R+BOT_M||y>GROUND-R-BOT_M||botBlocked(k,y))break;}
    if(k>best)best=k;if(best>BOT_N)break;
  }
  return best;
}
function botDecide(w){
  const b=w.bird;
  for(let k=1;k<=BOT_N;k++){botC[k]=blockedAt(w,k,botG);for(let i=0;i<2*botC[k];i++)botT[k*32+i]=botG[i];}
  const a=botSurvive(b.y,b.v,true),n=botSurvive(b.y,b.v,false);
  if(a!==n)return a>n;
  let c=H/2;
  for(let i=0;i<w.obs.length;i++){const o=w.obs[i];
    if(o.x+o.w>b.x-R){const k=Math.max(0,Math.ceil((o.x-(b.x+R))/w.speed)),cn=o.def.blocked(o,k,botG),m=freeIntervals(botG,cn,botF);
      let bi=0,bl=-1;for(let q=0;q<m;q++){const L=botF[2*q+1]-botF[2*q];if(L>bl){bl=L;bi=q;}}
      if(m>0)c=(botF[2*bi]+botF[2*bi+1])/2;break;}}
  return b.y>c+20&&b.v>=0;
}
/*@endbot*/
