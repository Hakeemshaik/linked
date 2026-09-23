import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getUser, one, run, kvGetOrCreate } from './db.js';

// From env, or generated once and kept in the database (serverless instances have no disk to share).
let secretP = null;
const secret = () => (secretP ||= process.env.JWT_SECRET
  ? Promise.resolve(process.env.JWT_SECRET)
  : kvGetOrCreate('jwt_secret', () => crypto.randomBytes(48).toString('hex')));

export const signToken = async (userId) => jwt.sign({ sub: userId }, await secret(), { expiresIn: '180d' });

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
    const { sub } = jwt.verify(token, await secret());
    return (await getUser(sub)) || null;
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
