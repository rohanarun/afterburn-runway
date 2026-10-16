// Afterburn Runway — static game server + live multiplayer relay + leaderboard
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const BOARD_FILE = path.join(__dirname, 'board.json');
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

let board = [];
try { board = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')); } catch (e) { board = []; }
function saveBoard() { fs.writeFile(BOARD_FILE, JSON.stringify(board), () => {}); }

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (req.url === '/api/leaderboard') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify(board));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(INDEX);
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });
const players = new Map(); // id -> {ws, name, s, seen}
let nextId = 1;

const cleanName = n => String(n || '').replace(/[^\w .\-]/g, '').trim().slice(0, 16) || 'Pilot';
const num = (v, a, b) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : 0; };
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

wss.on('connection', ws => {
  const id = nextId++;
  const p = { ws, name: 'Pilot', s: null, seen: Date.now(), lastScore: 0 };
  players.set(id, p);
  send(ws, { t: 'welcome', id, board });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    p.seen = Date.now();
    if (m.t === 'hello') p.name = cleanName(m.name);
    else if (m.t === 's') {
      p.s = { x: num(m.x, -20, 20), y: num(m.y, -5, 60), d: num(m.d, -100, 1e7), r: num(m.r, -1e4, 1e4),
              v: num(m.v, 0, 200), j: m.j ? 1 : 0, b: m.b ? 1 : 0, c: m.c ? 1 : 0 };
    }
    else if (m.t === 'idle') p.s = null;
    else if (m.t === 'score') {
      const now = Date.now();
      if (now - p.lastScore < 3000) return; // one submission per run
      p.lastScore = now;
      const score = Math.floor(num(m.score, 0, 5e6));
      const dist = Math.floor(num(m.dist, 0, 1e7));
      if (score <= 0) return;
      board.push({ name: cleanName(m.name || p.name), score, dist, rolls: Math.floor(num(m.rolls, 0, 1e4)), at: now });
      board.sort((a, b) => b.score - a.score);
      board = board.slice(0, 25);
      saveBoard();
      for (const q of players.values()) send(q.ws, { t: 'board', board });
    }
  });
  ws.on('close', () => players.delete(id));
  ws.on('error', () => players.delete(id));
});

// 12 Hz snapshot broadcast
setInterval(() => {
  const now = Date.now();
  const list = [];
  let online = 0;
  for (const [id, p] of players) {
    if (now - p.seen > 15000) { try { p.ws.terminate(); } catch (e) {} players.delete(id); continue; }
    online++;
    if (p.s) list.push({ id, n: p.name, ...p.s });
  }
  const msg = JSON.stringify({ t: 'snap', online, p: list });
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
}, 1000 / 12);

server.listen(PORT, () => console.log('Afterburn Runway on :' + PORT));
