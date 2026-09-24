import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getUser, one, run, kvGetOrCreate, id, now } from './db.js';

// From env, or generated once and kept in the database (serverless instances have no disk to share).
let secretP = null;
const secret = () => (secretP ||= process.env.JWT_SECRET
  ? Promise.resolve(process.env.JWT_SECRET)
  : kvGetOrCreate('jwt_secret', () => crypto.randomBytes(48).toString('hex')));

export const signToken = async (userId, sid) => jwt.sign(sid ? { sub: userId, sid } : { sub: userId }, await secret(), { expiresIn: '180d' });

/** A readable name for the device a request comes from, e.g. "iPhone · Safari". */
export function deviceName(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const app = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${app}`;
}

/** Sign someone in on this device: a session they can see (and end) in Linked devices, and its token. */
export async function startSession(userId, req) {
  const sid = id();
  const t = now();
  await run('INSERT INTO sessions (id, user_id, device, created_at, last_active) VALUES (?, ?, ?, ?, ?)',
    [sid, userId, deviceName(req?.headers?.['user-agent']).slice(0, 80), t, t]);
  return signToken(userId, sid);
}

// Invite links: /join/<code>. Each person has one permanent code, so their link never changes or expires.
// Opening it and signing in makes you friends straight away. Older signed links still work.
const CODE_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789'; // no look-alikes (l/1, o/0)
const newCode = () => Array.from(crypto.randomBytes(10), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
export async function inviteCodeFor(userId) {
  const u = await one('SELECT invite_code FROM users WHERE id = ?', [userId]);
  if (u?.invite_code) return u.invite_code;
  await run('UPDATE users SET invite_code = ? WHERE id = ? AND invite_code IS NULL', [newCode(), userId]);
  return (await one('SELECT invite_code FROM users WHERE id = ?', [userId])).invite_code;
}
export async function verifyInvite(token) {
  if (!token) return null;
  if (/^[a-z0-9]{6,20}$/.test(token)) return (await one('SELECT * FROM users WHERE invite_code = ?', [token])) || null;
  try { const { inv } = jwt.verify(token, await secret()); return (await getUser(inv)) || null; } catch { return null; }
}

export async function verifyToken(token) {
  if (!token) return null;
  try {
    const { sub, sid } = jwt.verify(token, await secret());
    if (!sid) return (await getUser(sub)) || null; // from before devices were tracked
    // One query: the person, and whether this device is still signed in.
    const u = await one('SELECT u.*, s.revoked AS session_revoked FROM users u JOIN sessions s ON s.id = ? AND s.user_id = u.id WHERE u.id = ?', [sid, sub]);
    if (!u || u.session_revoked) return null;
    delete u.session_revoked;
    u.sid = sid;
    return u;
  } catch {
    return null;
  }
}

/** Secret the server uses to call itself (queued reminders). */
export const internalSecret = () => kvGetOrCreate('internal_secret', () => crypto.randomBytes(32).toString('hex'));

export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const user = h.startsWith('Bearer ') ? await verifyToken(h.slice(7)) : null;
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}
