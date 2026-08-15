/**
 * Operator authentication — zero dependencies, backed by node:crypto.
 *
 * Design notes:
 *  - Passwords are stored as scrypt hashes with a per-operator salt. The
 *    plaintext is never written anywhere, including logs.
 *  - Sessions are stateless: a cookie holding a signed payload. No session
 *    store, so a server restart mid-broadcast doesn't log everyone out.
 *  - Comparisons use timingSafeEqual so a wrong password can't be narrowed
 *    down by timing.
 *
 * Operators live in data/auth.json, which also holds the signing secret.
 * Manage them with:  npm run operator -- add <name>
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_FILE = path.join(ROOT, 'data', 'auth.json');

export const COOKIE = 'hsc_session';
const SESSION_MS = 1000 * 60 * 60 * 24 * 7;   // a week — long enough for an event weekend

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export function loadAuth() {
  let auth;
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (!raw.secret) throw new Error('no secret');
    raw.operators ||= [];
    auth = raw;
  } catch {
    // First run: mint a signing secret. No operators yet — the server will
    // run in open mode until one is added, so a fresh clone still works.
    auth = { secret: crypto.randomBytes(32).toString('hex'), operators: [] };
    try { saveAuth(auth); } catch { /* read-only disk: env config only */ }
  }
  return applyEnvConfig(auth);
}

/**
 * Free hosting tiers usually give you an ephemeral filesystem — anything
 * written to disk is gone on the next restart or redeploy, which would wipe
 * operator accounts and sign everyone out at random. These two env vars keep
 * auth working on such a platform:
 *
 *   AUTH_SECRET  fixed session-signing key, so sessions survive a restart
 *   OPERATORS    "name:password,name2:password2" — seeded at boot
 *
 * Env passwords are visible to anyone with dashboard access to the host, so
 * prefer `npm run operator -- add` wherever the disk actually persists.
 */
function applyEnvConfig(auth) {
  if (process.env.AUTH_SECRET) auth.secret = process.env.AUTH_SECRET;

  const spec = process.env.OPERATORS;
  if (spec) {
    for (const entry of spec.split(',')) {
      const i = entry.indexOf(':');
      if (i < 1) continue;
      const name = entry.slice(0, i).trim();
      const password = entry.slice(i + 1);
      if (!name || !password) continue;
      const existing = findOperator(auth, name);
      const creds = hashPassword(password);
      if (existing) Object.assign(existing, creds);
      else auth.operators.push({ name, ...creds, fromEnv: true });
    }
  }
  return auth;
}

export function saveAuth(auth) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

const scrypt = (password, salt) =>
  crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: scrypt(password, salt).toString('hex') };
}

export function verifyPassword(operator, password) {
  if (!operator?.salt || !operator?.hash) return false;
  const expected = Buffer.from(operator.hash, 'hex');
  const actual = scrypt(password, operator.salt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function findOperator(auth, name) {
  const key = String(name || '').trim().toLowerCase();
  return auth.operators.find((o) => o.name.toLowerCase() === key) || null;
}

export function upsertOperator(auth, name, password) {
  const existing = findOperator(auth, name);
  const creds = hashPassword(password);
  if (existing) Object.assign(existing, creds);
  else auth.operators.push({ name: String(name).trim(), ...creds });
  return auth;
}

/* ------------------------------------------------------------------ *
 * Stateless session cookies
 * ------------------------------------------------------------------ */

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function makeToken(auth, name) {
  const payload = b64(JSON.stringify({ n: name, e: Date.now() + SESSION_MS }));
  return `${payload}.${sign(auth.secret, payload)}`;
}

/** Returns the operator name, or null if the token is missing/bad/expired. */
export function readToken(auth, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(auth.secret, payload);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { n, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!n || !e || Date.now() > e) return null;
    return n;
  } catch { return null; }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(token, { secure, maxAge = SESSION_MS / 1000 } = {}) {
  const bits = [
    `${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/* ------------------------------------------------------------------ *
 * Login throttling — blunt, in-memory, per IP
 * ------------------------------------------------------------------ */

const attempts = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function throttled(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() > rec.resetAt) return false;
  return rec.count >= MAX_ATTEMPTS;
}

export function noteAttempt(ip, ok) {
  if (ok) { attempts.delete(ip); return; }
  const rec = attempts.get(ip);
  if (!rec || Date.now() > rec.resetAt) attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else rec.count += 1;
}
