import { domino } from './oracle-2.0.mjs';
// mulberry32
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const N=+process.argv[2]||10, BASE=+process.argv[3]||1, EXTRA=process.argv[4]==='1', MATCHES=1000;
const stats={maxKoRound:[],koRounds:[],dur:[],rounds:[],firstKo:[],fastestWins:0};
for(let m=0;m<MATCHES;m++){ const r=rng(1000+m);
  let ps=Array.from({length:N},(_,i)=>({id:'B'+i,hp:100,fire:false,streak:0,cps:3+5*r()}));
  const fastest=ps.reduce((a,b)=>a.cps>b.cps?a:b).id;
  let round=0,t=0,ultiAt=4+Math.floor(r()*3),maxKo=0,koR=0,firstKo=null;
  while(ps.filter(p=>p.hp>0).length>1 && round<200){ round++; const alive=ps.filter(p=>p.hp>0);
    const len=15+Math.floor(r()*26); const ulti=round>=ultiAt; if(ulti) ultiAt=round+4+Math.floor(r()*3);
    for(const p of alive){ let typos=0; for(let c=0;c<len;c++) if(r()<0.02) typos++;
      let e=Math.round(400+len/p.cps*1000*(0.85+0.3*r())+600*typos); p.elapsed=e>20000?null:e; p.typos=typos; }
    const res=domino({len,players:alive,ulti,extraLast:EXTRA,base:BASE});
    const hitters=new Set(res.hits.filter(h=>h.from).map(h=>h.from));
    let ko=0; for(const p of alive){ const was=p.hp; p.hp=res.hp[p.id]; if(was>0&&p.hp===0) ko++;
      if(hitters.has(p.id)){ if(p.fire){p.fire=false;p.streak=0;} else if(++p.streak>=3){p.fire=true;p.streak=0;} } else {p.streak=0;p.fire=false;} }
    if(ko){koR++; if(firstKo==null) firstKo=round;} maxKo=Math.max(maxKo,ko);
    const fin=alive.map(p=>p.elapsed).filter(x=>x!=null); const typing=fin.length<alive.length?20000:Math.max(...fin);
    t+=2400+typing+150*(alive.length-1)+1000+1400;
  }
  const w=ps.filter(p=>p.hp>0); if(w.length===1&&w[0].id===fastest) stats.fastestWins++;
  stats.maxKoRound.push(maxKo); stats.koRounds.push(koR); stats.dur.push(t/1000); stats.rounds.push(round); stats.firstKo.push(firstKo);
}
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(p*(s.length-1))]};
const hist=a=>{const h={};for(const x of a)h[x]=(h[x]||0)+1;return JSON.stringify(h)};
console.log(`N=${N} BASE=${BASE} EXTRA=${EXTRA}`);
console.log('max KOs in one round, histogram:',hist(stats.maxKoRound));
console.log('rounds with >=1 KO: p10/p50/p90',q(stats.koRounds,.1),q(stats.koRounds,.5),q(stats.koRounds,.9));
console.log('match seconds p10/p50/p90',q(stats.dur,.1).toFixed(0),q(stats.dur,.5).toFixed(0),q(stats.dur,.9).toFixed(0),' rounds p50',q(stats.rounds,.5));
console.log('first KO round p10/p50',q(stats.firstKo,.1),q(stats.firstKo,.5),' fastest bot wins',stats.fastestWins/MATCHES);
