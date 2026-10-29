import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.goto('https://nalar.prastya.net/bullscows/'); await p.click('#name'); await p.keyboard.type('x');
await p.waitForTimeout(3500); // past 3 s fade-in
const r = await p.evaluate(async () => { const A = window.__bc.audio; const an = A.ctx.createAnalyser(); an.fftSize = 2048; A.master.connect(an); const buf = new Float32Array(an.fftSize); let peak = 0, rms = 0, n = 0; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) { peak = Math.max(peak, Math.abs(v)); s += v * v; } rms += Math.sqrt(s / buf.length); n++; } return { peak: +peak.toFixed(3), rmsAvg: +(rms / n).toFixed(3), dbfsPeak: +(20 * Math.log10(peak)).toFixed(1), dbfsRms: +(20 * Math.log10(rms / n)).toFixed(1), state: A.ctx.state, music: !!A.nodes }; });
console.log(JSON.stringify(r)); await b.close();
