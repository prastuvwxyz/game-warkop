import { spawn } from 'node:child_process';
const T = process.argv[2]; const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const withRoom of [false, true]) {
  const port = withRoom ? 3561 : 3560;
  const c = spawn(process.execPath, [T + '/server/server.js'], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; c.stdout.on('data', d => out += d); await sleep(700);
  let ws; if (withRoom) { ws = new WebSocket(`ws://127.0.0.1:${port}/tinju/ws`); await new Promise(r => ws.onopen = r); ws.send(JSON.stringify({ t: 'create', name: 'X', skin: 0, v: 2 })); await sleep(200); }
  const t0 = Date.now(); c.kill('SIGTERM'); let exited = null; c.on('exit', (code, sig) => exited = { code, sig, ms: Date.now() - t0 });
  await sleep(4000); console.log(`SIGTERM ${withRoom ? 'with an open WebSocket + room' : 'idle server'}: ${exited ? 'exited ' + JSON.stringify(exited) : 'STILL RUNNING after 4 s'} | log: ${out.trim().split('\n').slice(-1)[0]}`);
  if (!exited) c.kill('SIGKILL'); if (ws) ws.close();
}
process.exit(0);
