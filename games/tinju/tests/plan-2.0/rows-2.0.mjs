import { link, domino } from './oracle-2.0.mjs';
const P=(e,t)=>({elapsed:e,typos:t});
const rows=[
['O-01',18,P(3600,0),P(4800,1)],['O-02',18,P(4500,1),P(4800,0)],['O-03',30,P(6000,0),P(null,0),{ulti:true}],
['O-04',18,P(6000,1),P(6000,2)],['O-05',18,P(6000,1),P(6390,0)],['O-06',18,P(6000,1),P(6399,0)],['O-07',18,P(6000,1),P(6400,0)],
['O-08',18,P(6000,1),P(6401,0)],['O-09',18,P(6000,1),P(6410,0)],['O-10',18,P(6000,1),P(6999,0)],['O-11',18,P(6000,1),P(7000,0)],
['O-12',18,P(6000,1),P(7001,0)],['O-13',18,P(6000,1),P(7010,0)],['O-14',18,P(6000,1),P(null,0)],
['O-15',18,P(3675,0),P(null,0)],['O-16',18,P(3601,0),P(null,0)],['O-17',18,P(3600,0),P(null,0)],['O-18',18,P(3600,1),P(null,0)],
['O-19',15,P(6000,1),P(6100,0)],['O-20',17,P(6000,1),P(6100,0)],['O-21',15,P(3000,0),P(3500,0)],['O-22',27,P(5400,0),P(null,0)],
['O-23',27,P(5400,0),P(null,0),{combo:true}],['O-24',24,P(4800,0),P(null,0),{combo:true}],['O-25',18,P(6000,1),P(6500,0),{combo:true}],
['O-26',24,P(9000,1),P(9500,0),{ulti:true}],['O-27',24,P(9000,1),P(9100,0),{ulti:true}],['O-28',27,P(9000,1),P(9500,0),{ulti:true}],
['O-29',40,P(8000,0),P(8100,0),{ulti:true}],
['O-30',40,P(8000,0),P(null,0)],['O-31',40,P(8001,0),P(null,0)],['O-32',32,P(6400,0),P(null,0)],['O-33',40,P(19999,0),P(20000,0)],
];
for (const [id,len,w,l,o={}] of rows){ const r=link({len,hitter:w,hitee:l,...o}); console.log(id,len,w.elapsed,w.typos,l.elapsed,r.d,r.tier,r.m,r.crit,o.combo?'combo':'-',o.ulti?'ulti':'-',+r.raw.toFixed(4),r.dmg); }
// base 3 parity: 1.0 rows (len/3, elapsed/3 for W) should give same numbers
const p=(n,o={})=>({id:n,hp:100,fire:false,...o});
const D={
 'D-1':{len:25,players:[p('A',{elapsed:5000,typos:0}),p('B',{elapsed:5300,typos:1}),p('C',{elapsed:6800,typos:0})]},
 'D-2':{len:20,players:[p('A',{elapsed:4000,typos:0}),p('B',{elapsed:5000,typos:1,hp:81}),p('C',{elapsed:5000,typos:1,hp:69})]},
 'D-3':{len:30,players:[p('A',{elapsed:6000,typos:0,fire:true}),p('B',{elapsed:6200,typos:2}),p('C',{elapsed:7500,typos:0}),p('D',{elapsed:7600,typos:0}),p('E',{elapsed:null,typos:0})]},
 'D-4':{len:36,ulti:true,players:[p('A',{elapsed:7200,typos:0}),p('B',{elapsed:9000,typos:0,hp:72}),p('C',{elapsed:9500,typos:1,hp:62}),p('D',{elapsed:null,typos:0,hp:85}),p('E',{elapsed:null,typos:0,hp:62})]},
 'D-5':{len:20,players:[[4000,0],[4300,0],[4700,1],[5800,0],[5800,2],[6100,0],[7200,1],[7250,0],[9000,3],[15000,0]].map(([e,t],i)=>p('P'+(i+1),{elapsed:e,typos:t}))},
 'D-6':{len:40,players:[[8000,0,100],[8300,1,40],[9000,0,70,1],[9900,0,50],[10500,1,100],[12000,0,60],[12100,0,30,1],[14000,2,100],[null,0,45],[null,0,90]].map(([e,t,h,f],i)=>p('P'+(i+1),{elapsed:e,typos:t,hp:h,fire:!!f}))},
 'D-7':{len:40,extraLast:true,players:[p('A',{elapsed:8000,typos:0}),p('B',{elapsed:8500,typos:1}),p('C',{elapsed:10000,typos:1})]},
 'D-8':{len:30,players:[p('A',{elapsed:9000,typos:1}),p('B',{elapsed:null,typos:0}),p('C',{elapsed:null,typos:0})]},
 'D-9':{len:30,players:[p('A',{elapsed:null,typos:0}),p('B',{elapsed:null,typos:0}),p('C',{elapsed:null,typos:0}),p('D',{elapsed:null,typos:0}),p('E',{elapsed:null,typos:0})]},
};
for (const [k,v] of Object.entries(D)){ const r=domino(v); console.log('\n'+k,'order',r.order.join(' > ')); for(const h of r.hits) console.log('  ',h.pending?JSON.stringify(h):`${h.from}->${h.to}${h.extra?' (extra)':''} d=${h.d} ${h.tier} m${h.m} crit=${h.crit} combo=${h.combo} raw=${+h.raw.toFixed(4)} dmg=${h.dmg}`); console.log('  recv',JSON.stringify(r.recv),'hp',JSON.stringify(r.hp)); }
