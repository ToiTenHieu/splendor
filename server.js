'use strict';
// Server Splendor không cần thư viện ngoài: HTTP + long-poll.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { Worker } = require('worker_threads');
const engine = require('./engine');
const bot = require('./bot');
const store = require('./store');
const { tr, normalizeLang, LANGS } = require('./public/i18n.js');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const rooms = new Map();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const TIMERS = [0, 45, 60, 90, 120, 180];
const ROOM_TTL = 3 * 86400e3;

const rid = () => crypto.randomBytes(8).toString('hex');
function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (n, fallback) => String(n || '').replace(/[<>]/g, '').trim().slice(0, 16) || fallback;
const newMember = (name, fallback) => ({ id: rid(), token: rid(), name: cleanName(name, fallback), waiters: new Set(), lastSeen: Date.now() });
const roomLang = (room) => normalizeLang(room && room.settings && room.settings.lang);
const tt = (room, key, vars) => tr(roomLang(room), key, vars);
function renameBots(room) {
  let n = 0;
  for (const m of room.members) if (m.bot) {
    n++;
    m.name = `🤖 ${tr(roomLang(room), 'bot.' + (m.style || 'balanced'))}${n > 1 ? ' ' + n : ''}`;
  }
}
const newRoom = (code, host, lang = 'vi') => ({ code, hostId: host.id, members: [host], game: null, created: Date.now(), lastActive: Date.now(), version: 1,
  settings: { timer: 0, lang: normalizeLang(lang), expansions: { ...engine.DEFAULT_EXPANSIONS } }, scores: {}, chat: [], chatSeq: 0, nudge: null, deadline: 0 });

const isOnline = (m) => m.bot || m.waiters.size > 0 || Date.now() - m.lastSeen < 8000;
function lobbyView(room, me) {
  const lang = roomLang(room);
  return {
    code: room.code, started: !!room.game, hostId: room.hostId, me, now: Date.now(),
    members: room.members.map((m) => ({ id: m.id, name: m.name, online: isOnline(m), bot: !!m.bot, style: m.style || null })),
    settings: room.settings, deadline: room.deadline || 0,
    scores: room.scores, chat: room.chat.slice(-40), nudge: room.nudge,
    expansionOptions: engine.EXPANSIONS.map((x) => ({ id: x.id, name: tr(lang, x.nameKey), desc: tr(lang, x.descKey) })),
    bots: Object.entries(bot.STYLES).map(([k]) => ({ key: k, name: tr(lang, 'bot.' + k) })),
  };
}
function snapshot(room, m) {
  return { lobby: lobbyView(room, m.id), game: room.game ? engine.viewFor(room.game, m.id) : null };
}
// Mỗi thay đổi tăng version rồi đánh thức các request long-poll đang chờ.
function pushAll(room) {
  room.version = (room.version || 0) + 1;
  for (const m of room.members) for (const w of [...m.waiters]) w();
}

// ---------- lưu trữ ----------
let saveT = 0;
function serialize() {
  return JSON.stringify({ v: 1, rooms: [...rooms.values()].map((r) => ({
    code: r.code, hostId: r.hostId, created: r.created, lastActive: r.lastActive, version: r.version, game: r.game, settings: r.settings,
    scores: r.scores, chat: r.chat, chatSeq: r.chatSeq, deadline: r.deadline, tkey: r.tkey,
    members: r.members.map((m) => ({ id: m.id, token: m.token, name: m.name, bot: m.bot, style: m.style })),
  })) });
}
function persist() { clearTimeout(saveT); saveT = setTimeout(() => store.save(serialize()), 800); }
async function restore() {
  const d = await store.load();
  if (!d || !Array.isArray(d.rooms)) return;
  for (const r of d.rooms) {
    if (Date.now() - r.lastActive > ROOM_TTL) continue;
    const room = { ...newRoom(r.code, { id: r.hostId }), ...r, version: (r.version || 0) + 1000,
      settings: { timer: 0, ...r.settings, lang: normalizeLang(r.settings && r.settings.lang), expansions: { ...engine.DEFAULT_EXPANSIONS, ...(r.settings && r.settings.expansions) } },
      members: r.members.map((m) => ({ ...m, waiters: new Set(), lastSeen: 0 })) };
    if (room.game) engine.upgradeGame(room.game);
    renameBots(room);
    rooms.set(room.code, room);
    armTimer(room); scheduleBot(room);
  }
  console.log(`Đã khôi phục ${rooms.size} phòng (${store.mode}).`);
}

// ---------- logic phòng ----------
function settle(room) { // ghi thành tích khi ván vừa kết thúc
  const g = room.game;
  if (!g || g.phase !== 'over' || g.recorded) return;
  g.recorded = true;
  for (const p of g.players) {
    const s = room.scores[p.id] || (room.scores[p.id] = { w: 0, g: 0 });
    s.g++; if (g.winners.includes(p.id)) s.w++;
  }
}
function memberOf(room, id) { return room.members.find((x) => x.id === id); }

function armTimer(room) {
  clearTimeout(room._tt); room._tt = null;
  const g = room.game;
  if (!g || g.phase === 'over' || !room.settings.timer) { room.deadline = 0; room.tkey = null; return; }
  const cur = g.players[g.turn], mem = memberOf(room, cur.id), key = `${g.turn}:${g.phase}:${g.round}`;
  if (mem && mem.bot) { room.deadline = 0; room.tkey = key; return; }
  if (key !== room.tkey || !room.deadline) { room.tkey = key; room.deadline = Date.now() + room.settings.timer * 1000; }
  room._tt = setTimeout(() => autoMove(room, key), Math.max(1000, room.deadline - Date.now()));
}
function autoMove(room, key) {
  const g = room.game; room._tt = null;
  if (!g || g.phase === 'over' || key !== `${g.turn}:${g.phase}:${g.round}`) return;
  const p = g.players[g.turn];
  try { bot.play(g, p.id, 'balanced'); engine.addLog(g, tt(room, 'log.timeout', { name: p.name })); } catch (e) { console.error('autoMove', e.message); }
  room.deadline = 0; commit(room);
}

// Máy "Cao thủ" nghĩ trong 1 worker dùng chung (CPU Render free yếu: chạy lần lượt, chia thời gian khi nhiều phòng cùng chờ).
const THINK_MS = +process.env.BOT_THINK_MS || 1500;
let brain = null, brainSeq = 0, brainQueue = 0;
const brainJobs = new Map();
function getBrain() {
  if (brain) return brain;
  brain = new Worker(path.join(__dirname, 'bot-worker.js'));
  brain.on('message', ({ id, action, error }) => { const j = brainJobs.get(id); if (j) { brainJobs.delete(id); j(error ? null : action); } });
  const reset = (e) => { if (e) console.error('bot-worker', e.message || e); brain = null; for (const j of brainJobs.values()) j(null); brainJobs.clear(); brainQueue = 0; };
  brain.on('error', reset); brain.on('exit', (c) => c && reset('exit ' + c));
  brain.unref();
  return brain;
}
function askBrain(game, me) {
  const ms = Math.max(300, THINK_MS / (1 + brainQueue));
  return new Promise((resolve) => {
    const id = ++brainSeq; brainQueue++;
    const t = setTimeout(() => done(null), ms * (brainQueue + 1) + 5000);
    let settled = false;
    const done = (a) => { if (settled) return; settled = true; clearTimeout(t); brainJobs.delete(id); brainQueue = Math.max(0, brainQueue - 1); resolve(a); };
    brainJobs.set(id, done);
    try { getBrain().postMessage({ id, game, me, ms }); } catch (e) { done(null); }
  });
}
function thinkBot(room) {
  const g = room.game, c = g.players[g.turn], key = `${g.turn}:${g.phase}:${g.round}`, t0 = Date.now();
  room._bt = true;
  askBrain(g, c.id).then((a) => {
    setTimeout(() => {
      room._bt = null;
      if (room.game !== g || g.phase === 'over' || key !== `${g.turn}:${g.phase}:${g.round}`) return scheduleBot(room); // ván đã đổi trong lúc nghĩ
      try { if (!a) throw new Error('no move'); engine.apply(g, c.id, a); }
      catch (e) { try { bot.play(g, c.id, 'balanced'); } catch (e2) { console.error('bot', e2.message); return; } }
      commit(room);
    }, Math.max(0, 900 - (Date.now() - t0)));
  });
}

function scheduleBot(room) {
  if (room._bt) return;
  const g = room.game; if (!g || g.phase === 'over') return;
  const cur = g.players[g.turn], mem = memberOf(room, cur.id);
  if (!mem || !mem.bot) return;
  if (g.phase === 'main' && bot.STYLES[mem.style] && bot.STYLES[mem.style].mcts) return thinkBot(room);
  room._bt = setTimeout(() => {
    room._bt = null;
    const g2 = room.game; if (!g2 || g2.phase === 'over') return;
    const c2 = g2.players[g2.turn], m2 = memberOf(room, c2.id);
    if (!m2 || !m2.bot) return;
    try { bot.play(g2, c2.id, m2.style); room._bf = 0; } catch (e) { console.error('bot', e.message); if (++room._bf > 3) return; }
    commit(room);
  }, 1100 + Math.random() * 900);
}

// Gọi sau mọi thay đổi trạng thái ván/phòng.
function commit(room) {
  room.lastActive = Date.now();
  settle(room); armTimer(room); pushAll(room); scheduleBot(room); persist();
}

// ---------- HTTP ----------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}
function auth(b) {
  const room = rooms.get(String(b.room || '').toUpperCase());
  if (!room) throw new Error(tr(b.lang, 'server.roomNotFound'));
  const m = b.token && room.members.find((x) => x.token === b.token);
  if (!m) throw new Error(tt(room, 'server.sessionInvalid'));
  return { room, m };
}
const needHost = (room, m) => { if (m.id !== room.hostId) throw new Error(tt(room, 'server.hostOnly')); };

async function api(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/poll') {
      const { room, m } = auth({ room: url.searchParams.get('room'), token: url.searchParams.get('token') });
      const since = +url.searchParams.get('v') || 0;
      const wasOnline = isOnline(m);
      m.lastSeen = Date.now();
      if (!wasOnline) pushAll(room);
      const reply = () => json(res, 200, room.version > since ? { v: room.version, data: snapshot(room, m) } : { v: room.version, same: true });
      if ((room.version || 0) > since) return reply();
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(t); m.waiters.delete(finish); m.lastSeen = Date.now(); reply(); };
      const t = setTimeout(finish, 20000);
      m.waiters.add(finish);
      req.on('close', () => {
        if (done) return; done = true; clearTimeout(t); m.waiters.delete(finish); m.lastSeen = Date.now();
        setTimeout(() => { if (!isOnline(m) && rooms.has(room.code)) pushAll(room); }, 9000); // cập nhật chấm offline
      });
      return;
    }
    const b = await body(req);
    if (url.pathname === '/api/create') {
      const code = roomCode(), m = newMember(b.name, tr(b.lang, 'player.default'));
      rooms.set(code, newRoom(code, m, b.lang));
      json(res, 200, { room: code, token: m.token });
      return persist();
    }
    if (url.pathname === '/api/join') {
      const room = rooms.get(String(b.room || '').toUpperCase().trim());
      if (!room) throw new Error(tr(b.lang, 'server.roomNotFound'));
      if (room.game) throw new Error(tt(room, 'server.started'));
      if (room.members.length >= 4) throw new Error(tt(room, 'server.full'));
      const m = newMember(b.name, tt(room, 'player.default'));
      room.members.push(m);
      json(res, 200, { room: room.code, token: m.token });
      return commit(room);
    }
    const { room, m } = auth(b);
    switch (url.pathname) {
      case '/api/start': {
        needHost(room, m);
        if (room.game && room.game.phase !== 'over') throw new Error(tt(room, 'server.inProgress'));
        if (room.members.length < 2) throw new Error(tt(room, 'server.needTwo'));
        room.game = engine.newGame(room.members.map((x) => ({ id: x.id, name: x.name })), { expansions: room.settings.expansions, lang: roomLang(room) });
        room.deadline = 0; room.tkey = null;
        break;
      }
      case '/api/rematch': { // chơi lại ngay với cùng nhóm
        needHost(room, m);
        if (!room.game || room.game.phase !== 'over') throw new Error(tt(room, 'server.notOver'));
        room.game = engine.newGame(room.members.map((x) => ({ id: x.id, name: x.name })), { expansions: room.settings.expansions, lang: roomLang(room) });
        room.deadline = 0; room.tkey = null;
        break;
      }
      case '/api/action': {
        if (!room.game) throw new Error(tt(room, 'server.notStarted'));
        engine.apply(room.game, m.id, b.action || {}, { recordUndo: true });
        room.deadline = 0;
        break;
      }
      case '/api/undo': {
        if (!room.game) throw new Error(tt(room, 'server.notStarted'));
        engine.undo(room.game, m.id);
        room.deadline = 0; room.tkey = null;
        break;
      }
      case '/api/lobby': needHost(room, m); room.game = null; room.deadline = 0; room.tkey = null; break; // về sảnh
      case '/api/addbot': {
        needHost(room, m);
        if (room.game) throw new Error(tt(room, 'server.addBotsLobbyOnly'));
        if (room.members.length >= 4) throw new Error(tt(room, 'server.full'));
        const style = bot.STYLES[b.style] ? b.style : 'balanced';
        room.members.push({ id: rid(), token: null, name: '', bot: true, style, waiters: new Set(), lastSeen: 0 });
        renameBots(room);
        break;
      }
      case '/api/rmbot': {
        needHost(room, m);
        if (room.game) throw new Error(tt(room, 'server.removeBotsLobbyOnly'));
        room.members = room.members.filter((x) => !(x.bot && x.id === b.id));
        break;
      }
      case '/api/settings': {
        needHost(room, m);
        if (b.timer != null) {
          const t = +b.timer; if (!TIMERS.includes(t)) throw new Error(tt(room, 'server.invalidValue'));
          room.settings.timer = t;
        }
        if (b.lang != null) {
          if (!LANGS.includes(b.lang)) throw new Error(tt(room, 'server.invalidValue'));
          room.settings.lang = b.lang;
          renameBots(room);
        }
        if (b.expansions && typeof b.expansions === 'object') {
          for (const ex of engine.EXPANSIONS) if (Object.prototype.hasOwnProperty.call(b.expansions, ex.id)) {
            room.settings.expansions[ex.id] = !!b.expansions[ex.id];
          }
        }
        break;
      }
      case '/api/chat': {
        const text = String(b.text || '').replace(/[<>]/g, '').trim().slice(0, 140);
        if (!text) throw new Error(tt(room, 'server.emptyMessage'));
        if (Date.now() - (m.lastChat || 0) < 500) throw new Error(tt(room, 'server.slowDown'));
        m.lastChat = Date.now();
        room.chat.push({ i: ++room.chatSeq, id: m.id, name: m.name, text, emo: !!b.emo, t: Date.now() });
        if (room.chat.length > 80) room.chat.shift();
        break;
      }
      case '/api/nudge': {
        const g = room.game;
        if (!g || g.phase === 'over') throw new Error(tt(room, 'server.noGame'));
        const cur = g.players[g.turn];
        if (cur.id === m.id) throw new Error(tt(room, 'server.yourTurn'));
        if (memberOf(room, cur.id).bot) throw new Error(tt(room, 'server.botAuto'));
        if (Date.now() - (room.nudge ? room.nudge.t : 0) < 20000) throw new Error(tt(room, 'server.nudgeCooldown'));
        room.nudge = { t: Date.now(), to: cur.id, from: m.name };
        break;
      }
      case '/api/leave': {
        // Đang có ván: máy chơi thay người rời để ván vẫn tiếp tục; ở sảnh thì xoá khỏi phòng.
        if (room.game) {
          Object.assign(m, { bot: true, style: 'balanced', token: null });
          for (const f of [...m.waiters]) f();
          if (room.game.phase !== 'over') engine.addLog(room.game, tt(room, 'log.leave', { name: m.name }));
        } else room.members = room.members.filter((x) => x !== m);
        if (!room.members.some((x) => !x.bot)) rooms.delete(room.code);
        else if (room.hostId === m.id) room.hostId = room.members.find((x) => !x.bot).id;
        break;
      }
      default: return json(res, 404, { error: 'Not found' });
    }
    json(res, 200, { ok: true });
    if (rooms.has(room.code)) commit(room); else { pushAll(room); persist(); }
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); } // cho UptimeRobot ping
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const art = url.pathname.startsWith('/art/') || url.pathname.startsWith('/bga/'); // ảnh/âm thanh không đổi: cho trình duyệt giữ cache, tránh tải lại mỗi lần vẽ
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': art ? 'public, max-age=86400' : 'no-cache' });
    res.end(data);
  });
});

restore().catch((e) => console.error('restore', e)).then(() => server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nSplendor đang chạy!\n  Máy này:   http://localhost:${PORT}\n  Lưu ván:   ${store.mode === 'upstash' ? 'Upstash Redis' : 'file data/rooms.json'}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list) if (i.family === 'IPv4' && !i.internal) console.log(`  Cùng WiFi: http://${i.address}:${PORT}`);
  console.log('');
}));

// Dọn phòng cũ
setInterval(() => {
  let n = 0;
  for (const [c, r] of rooms) if (Date.now() - r.lastActive > ROOM_TTL && r.members.every((m) => !isOnline(m))) { rooms.delete(c); n++; }
  if (n) persist();
}, 3600e3);

// Render free ngủ sau 15 phút không có request: tự gọi chính mình khi còn phòng đang hoạt động gần đây.
const SELF = process.env.RENDER_EXTERNAL_URL;
if (SELF) setInterval(() => {
  if ([...rooms.values()].some((r) => Date.now() - r.lastActive < 3 * 3600e3)) https.get(SELF + '/health', (r) => r.resume()).on('error', () => {});
}, 10 * 60e3);

// Lưu lần cuối khi Render tắt/khởi động lại server
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { clearTimeout(saveT); store.save(serialize()).finally(() => process.exit(0)); });
