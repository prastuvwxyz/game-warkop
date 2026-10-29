// WebSocket link to <base>/ws with reconnect; sends v:2 on create/join/rejoin (protocol 2, DESIGN.md).
export function createNet({ onMessage, onOpen, onClose, getSession }) {
  let ws = null, retry = 0, timer = null, intent = null;
  const net = { connected: false };
  const url = () => { const base = location.pathname.replace(/\/[^/]*$/, ''); return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + base + '/ws'; };
  function connect() {
    clearTimeout(timer);
    try { ws = new WebSocket(url()); } catch (e) { schedule(); return; }
    ws.onopen = () => {
      net.connected = true; retry = 0; onOpen(true);
      const s = getSession();
      if (s) raw({ t: 'rejoin', code: s.code, token: s.token, v: 2 }); else if (intent) { raw(intent); intent = null; }
    };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMessage(m); };
    ws.onclose = () => { net.connected = false; ws = null; onClose(); schedule(); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(connect, Math.min(10000, 500 * Math.pow(2, retry++))); }
  function raw(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; }
  net.send = o => {
    if (o.t === 'create' || o.t === 'join') o.v = 2;
    if (raw(o)) return true;
    if (o.t === 'create' || o.t === 'join') { intent = o; if (!ws) connect(); }
    return false;
  };
  net.connect = connect;
  net.ensure = () => { if (!ws) connect(); };
  net.setIntent = o => { intent = o; };
  return net;
}
