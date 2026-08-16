/**
 * HSC Overlay broadcast server — zero dependencies.
 *
 *   node server/index.js
 *
 *   Overlay (OBS browser source, 1920x1080) : http://localhost:8787/overlay
 *   Control panel (operator)                : http://localhost:8787/admin
 *
 * State lives in memory, is pushed to every connected client over SSE, and is
 * mirrored to data/match.json so a crash or a restart mid-series costs nothing.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_GAMEDATA } from './gamedata.js';
import { initialState, reduce, derive, setGameData, setActor } from './state.js';
import {
  loadAuth, findOperator, verifyPassword, makeToken, readToken,
  parseCookies, cookieHeader, clearCookie, throttled, noteAttempt, COOKIE,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const ASSETS = path.join(ROOT, 'assets');
const DATA = path.join(ROOT, 'data');
const SAVE = path.join(DATA, 'match.json');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const INGEST_KEY = process.env.INGEST_KEY || 'hsc';
/** Set behind a reverse proxy / tunnel so Secure cookies are set correctly. */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

const auth = loadAuth();
/**
 * With no operators configured the panel stays open, so a fresh clone or a
 * purely local setup still works with zero setup. The moment you add one,
 * every write and the panel itself require a sign-in.
 */
const authRequired = () => auth.operators.length > 0;

const isSecure = (req) =>
  TRUST_PROXY ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' : false;

const clientIp = (req) =>
  (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())
  || req.socket.remoteAddress || 'unknown';

/** Operator name for this request, or null when not signed in. */
function whoIs(req) {
  if (!authRequired()) return 'operator';
  const token = parseCookies(req.headers.cookie)[COOKIE];
  return token ? readToken(auth, token) : null;
}

/* ------------------------------------------------------------------ *
 * Game data (defaults + user overrides)
 * ------------------------------------------------------------------ */

let GD = DEFAULT_GAMEDATA;
try {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA, 'gamedata.json'), 'utf8'));
  GD = {
    ...DEFAULT_GAMEDATA,
    ...raw,
    WEAPONS: { ...DEFAULT_GAMEDATA.WEAPONS, ...(raw.WEAPONS || {}) },
    SHIELDS: { ...DEFAULT_GAMEDATA.SHIELDS, ...(raw.SHIELDS || {}) },
    AGENTS: { ...DEFAULT_GAMEDATA.AGENTS, ...(raw.AGENTS || {}) },
    RULES: { ...DEFAULT_GAMEDATA.RULES, ...(raw.RULES || {}) },
    BUY_PRESETS: { ...DEFAULT_GAMEDATA.BUY_PRESETS, ...(raw.BUY_PRESETS || {}) },
  };
  console.log('[hsc] merged data/gamedata.json overrides');
} catch { /* defaults are fine */ }
setGameData(GD);

/* ------------------------------------------------------------------ *
 * State + undo
 * ------------------------------------------------------------------ */

let state = load() || initialState();
const undoStack = [];
const UNDO_LIMIT = 60;

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
    console.log(`[hsc] restored match from data/match.json (round ${s?.round?.number})`);
    return migrate(s);
  } catch { return null; }
}

/**
 * A match saved by an older build can be missing keys this build expects.
 * Anything absent falls back to the current default rather than to `undefined`
 * — otherwise a new overlay toggle would read as "off" and silently hide an
 * element mid-broadcast.
 */
function migrate(s) {
  const base = initialState();
  s.overlay = { ...base.overlay, ...(s.overlay || {}) };
  s.overlay.show = { ...base.overlay.show, ...(s.overlay.show || {}) };
  s.overlay.lowerThird = { ...base.overlay.lowerThird, ...(s.overlay.lowerThird || {}) };
  s.overlay.layout = { ...base.overlay.layout, ...(s.overlay.layout || {}) };
  s.broadcast = { ...base.broadcast, ...(s.broadcast || {}) };
  s.format = { ...base.format, ...(s.format || {}) };
  s.veto = { ...base.veto, ...(s.veto || {}) };
  if (!Array.isArray(s.veto.maps)) s.veto.maps = [];
  s.screens = { ...base.screens, ...(s.screens || {}) };
  s.screens.agentPick = { ...base.screens.agentPick, ...(s.screens.agentPick || {}) };
  {
    // `revealed` used to be one flat array for whichever team was showing;
    // it is now per side. `focus` moved from an index to a player id.
    const ap = s.screens.agentPick;
    const blank = () => [false, false, false, false, false];
    if (Array.isArray(ap.revealed)) ap.revealed = { A: ap.revealed, B: blank() };
    if (!ap.revealed || typeof ap.revealed !== 'object') ap.revealed = { A: blank(), B: blank() };
    for (const t of ['A', 'B']) {
      if (!Array.isArray(ap.revealed[t]) || ap.revealed[t].length !== 5) ap.revealed[t] = blank();
    }
    if (typeof ap.focus === 'number') ap.focus = ap.focus >= 0 ? `${ap.team || 'A'}${ap.focus + 1}` : '';
    if (typeof ap.focus !== 'string') ap.focus = '';
  }
  s.screens.banner = { ...base.screens.banner, ...(s.screens.banner || {}) };
  s.round = { ...base.round, ...(s.round || {}) };
  if (!s.round.clutch || !('A' in s.round.clutch)) s.round.clutch = { A: null, B: null };
  for (const t of ['A', 'B']) {
    s.teams[t] = { ...base.teams[t], ...(s.teams[t] || {}) };
    s.teams[t].stats = { ...base.teams[t].stats, ...(s.teams[t].stats || {}) };
    s.teams[t].players = (s.teams[t].players || []).map((p, i) => ({ ...base.teams[t].players[i], ...p }));
  }
  return s;
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fsp.mkdir(DATA, { recursive: true });
      await fsp.writeFile(SAVE, JSON.stringify(state, null, 1));
    } catch (e) { console.error('[hsc] save failed:', e.message); }
  }, 400);
}

function snapshot() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

/* ------------------------------------------------------------------ *
 * SSE fan-out
 * ------------------------------------------------------------------ */

/** res -> operator name, so the panel can show who else is on the desk. */
const clients = new Map();

const whosOnline = () =>
  [...new Set([...clients.values()].filter(Boolean))].sort();

function payload() {
  return JSON.stringify({
    state, derived: derive(state), undo: undoStack.length, operators: whosOnline(),
  });
}

function broadcast() {
  const msg = `data: ${payload()}\n\n`;
  for (const res of clients.keys()) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}

/**
 * Applies one or more actions, then persists + pushes to every client.
 * `actor` is stamped onto anything the action logs, so with several operators
 * working at once the feed shows who did what.
 */
function dispatch(actions, actor = '') {
  const list = Array.isArray(actions) ? actions : [actions];
  setActor(actor);
  for (const action of list) {
    if (!action || typeof action.type !== 'string') continue;
    if (action.type === 'undo') {
      const prev = undoStack.pop();
      if (prev) state = JSON.parse(prev);
      continue;
    }
    snapshot();
    state = reduce(state, action);
  }
  setActor('');
  persist();
  broadcast();
}

/* ------------------------------------------------------------------ *
 * Clock tick — auto-advances buy → live so the operator never has to
 * ------------------------------------------------------------------ */

setInterval(() => {
  const c = state.clock;
  if (!c.running) return;
  const left = c.endsAt - Date.now();
  if (left > 0) return;

  c.remainingMs = 0;
  if (c.phase === 'buy') {
    snapshot();
    state = reduce(state, { type: 'clock.phase', phase: 'live' });
    broadcast();
  } else {
    // Round/spike time expiring is a call for the operator, not the clock.
    c.running = false;
    broadcast();
  }
}, 200);

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, baseDir, rel) {
  const file = path.join(baseDir, decodeURIComponent(rel));
  if (!file.startsWith(baseDir)) return send(res, 403, 'forbidden');
  try {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) return serveStatic(res, baseDir, path.join(rel, 'index.html'));
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Markup/styles/scripts are never cached so your tweaks show up on an
      // OBS source refresh; only artwork is worth caching.
      'Cache-Control': ['.html', '.css', '.js'].includes(ext) ? 'no-store' : 'public, max-age=300',
      'Content-Length': stat.size,
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'not found');
  }
}

async function listAssets() {
  const out = {};
  for (const kind of ['teams', 'sponsors', 'agents', 'weapons', 'maps', 'misc']) {
    try {
      const files = await fsp.readdir(path.join(ASSETS, kind));
      out[kind] = files.filter((f) => /\.(png|jpe?g|webp|svg|gif)$/i.test(f)).map((f) => `/assets/${kind}/${f}`);
    } catch { out[kind] = []; }
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return send(res, 204, '');

  /* ---------------- auth ---------------- */

  if (p === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (throttled(ip)) return json(res, 429, { ok: false, error: 'Too many attempts. Wait a few minutes.' });
    try {
      const { name, password } = await readBody(req, 8 * 1024);
      const op = findOperator(auth, name);
      const ok = !!op && verifyPassword(op, password);
      noteAttempt(ip, ok);
      if (!ok) return json(res, 401, { ok: false, error: 'Wrong operator name or password.' });
      return send(res, 200, JSON.stringify({ ok: true, name: op.name }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': cookieHeader(makeToken(auth, op.name), { secure: isSecure(req) }),
      });
    } catch { return json(res, 400, { ok: false, error: 'Bad request.' }); }
  }

  if (p === '/api/logout') {
    return send(res, 200, JSON.stringify({ ok: true }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': clearCookie(),
    });
  }

  if (p === '/api/me') {
    const who = whoIs(req);
    return json(res, 200, { ok: !!who, name: who, authRequired: authRequired(), operators: whosOnline() });
  }

  if (p === '/login' || p === '/login/') return serveStatic(res, PUBLIC, 'login.html');

  // ---- live state stream ----
  if (p === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 1000\n\ndata: ${payload()}\n\n`);
    // Overlay clients connect anonymously; signed-in panels show up in the
    // operator presence list.
    clients.set(res, url.searchParams.get('as') === 'panel' ? whoIs(req) : '');
    broadcast();
    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); broadcast(); });
    return;
  }

  if (p === '/api/state') return json(res, 200, { state, derived: derive(state), gamedata: GD });
  if (p === '/api/gamedata') return json(res, 200, GD);
  if (p === '/api/assets') return json(res, 200, await listAssets());

  if (p === '/api/action' && req.method === 'POST') {
    const who = whoIs(req);
    if (!who) return json(res, 401, { ok: false, error: 'Sign in required.' });
    try {
      dispatch(await readBody(req), who);
      return json(res, 200, { ok: true, undo: undoStack.length });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  /**
   * External ingest. Any adapter (OCR, a local-client reader, a second
   * operator's phone, a Stream Deck) can POST the exact same actions:
   *   POST /api/ingest?key=hsc   {"type":"kill","killer":"A1","victim":"B3"}
   */
  if (p === '/api/ingest' && req.method === 'POST') {
    if (url.searchParams.get('key') !== INGEST_KEY) return json(res, 401, { ok: false, error: 'bad key' });
    try {
      dispatch(await readBody(req));
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ---- image upload (base64 from the admin page; no multipart parser needed) ----
  if (p === '/api/upload' && req.method === 'POST') {
    if (!whoIs(req)) return json(res, 401, { ok: false, error: 'Sign in required.' });
    try {
      const { kind = 'misc', name = 'image.png', dataUrl = '' } = await readBody(req);
      const m = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,(.+)$/i.exec(dataUrl);
      if (!m) return json(res, 400, { ok: false, error: 'expected a base64 image data URL' });
      const safeKind = ['teams', 'sponsors', 'agents', 'weapons', 'maps', 'misc'].includes(kind) ? kind : 'misc';
      const ext = m[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg');
      const safeName = `${path.basename(name, path.extname(name)).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'image'}-${Date.now().toString(36)}.${ext}`;
      const dir = path.join(ASSETS, safeKind);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, safeName), Buffer.from(m[2], 'base64'));
      return json(res, 200, { ok: true, path: `/assets/${safeKind}/${safeName}` });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }

  // ---- static ----
  if (p === '/' ) return send(res, 302, '', { Location: '/admin' });
  // The overlay is deliberately open — OBS can't complete a sign-in, and a
  // browser source has to come up every time without intervention.
  if (p === '/overlay' || p === '/overlay/') return serveStatic(res, PUBLIC, 'overlay.html');
  if (p === '/admin' || p === '/admin/') {
    if (!whoIs(req)) return send(res, 302, '', { Location: '/login?next=/admin' });
    return serveStatic(res, PUBLIC, 'admin.html');
  }
  if (p.startsWith('/assets/')) return serveStatic(res, ASSETS, p.slice('/assets/'.length));
  return serveStatic(res, PUBLIC, p);
});

server.listen(PORT, HOST, () => {
  const line = '─'.repeat(58);
  console.log(`\n${line}\n  HSC Overlay\n${line}`);
  console.log(`  Control panel : http://localhost:${PORT}/admin`);
  console.log(`  Overlay (OBS) : http://localhost:${PORT}/overlay`);
  console.log(`  Ingest        : POST http://localhost:${PORT}/api/ingest?key=${INGEST_KEY}`);
  console.log(line);
  if (authRequired()) {
    console.log(`  Operators     : ${auth.operators.map((o) => o.name).join(', ')}`);
    console.log('  Sign-in is REQUIRED for the panel and all edits.');
  } else {
    console.log('  ⚠ No operators configured — the panel is OPEN to anyone who');
    console.log('    can reach this server. Fine on localhost; before exposing it');
    console.log('    publicly run:  npm run operator -- add <name>');
  }
  console.log(`${line}\n  Add the overlay to OBS as a Browser Source at 1920x1080.\n`);
});
