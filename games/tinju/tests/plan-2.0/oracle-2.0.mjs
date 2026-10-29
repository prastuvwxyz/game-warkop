// A-na's independent 2.0 oracle from games/tinju/README.md @ c16b253 (Rules). Not derived from any server code.
export const R = { BASE:1, BLOCK:400, JAB:1000, CPS:5, CAP:60, RCAP:60, CRITX:1.5, COMBOX:1.25, ULTIX:2.5 };
export function link({len, hitter, hitee, ulti=false, combo=false, base=R.BASE}) {
  const d = hitee.elapsed==null ? Infinity : hitee.elapsed - hitter.elapsed;
  const [tier,m] = d<=R.BLOCK?['block',0.5]:d<=R.JAB?['jab',1]:['clean',1.25];
  const crit = hitter.typos===0 && len*1000 >= R.CPS*hitter.elapsed;
  const raw = len*base*m*(crit?R.CRITX:1)*(combo?R.COMBOX:1)*(ulti?R.ULTIX:1);
  return { d, tier, m, crit, combo, raw, dmg: Math.min(R.CAP, Math.round(raw)) };
}
// players: [{id, elapsed|null, typos, hp, fire}] ; assumptions T1 (tie group hit by predecessor), X1 (extra last hit)
export function domino({len, players, ulti=false, extraLast=false, base=R.BASE}) {
  const fin = players.filter(p=>p.elapsed!=null).sort((a,b)=>a.elapsed-b.elapsed||a.typos-b.typos);
  const unf = players.filter(p=>p.elapsed==null);
  const groups=[]; for (const p of fin){const g=groups.at(-1); if(g&&g[0].elapsed===p.elapsed&&g[0].typos===p.typos) g.push(p); else groups.push([p]);}
  if (unf.length) groups.push(unf);
  const hits=[];
  for (let i=0;i+1<groups.length;i++){ const hitter=groups[i]; if (hitter.length!==1) { hits.push({pending:'tie group hits next', from:hitter.map(p=>p.id)}); continue; }
    const h=hitter[0]; if (h.elapsed==null) break;
    for (const v of groups[i+1]) hits.push({from:h.id,to:v.id,...link({len,hitter:h,hitee:v,ulti,combo:!!h.fire,base})}); }
  if (extraLast && fin.length && groups.length>1){ const first=groups[0][0]; const lastG=groups.at(-1); for(const v of lastG) hits.push({from:first.id,to:v.id,extra:true,...link({len,hitter:first,hitee:v,ulti,combo:false,base})}); }
  const recv={}; for(const x of hits) if(x.to) recv[x.to]=(recv[x.to]||0)+x.dmg;
  const hp={}; for(const p of players){ const r=Math.min(R.RCAP,recv[p.id]||0); hp[p.id]=Math.max(0,p.hp-r); }
  return {order:groups.map(g=>g.map(p=>p.id).join('=')), hits, recv, hp};
}
