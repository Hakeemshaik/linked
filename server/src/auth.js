import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getUser, kvGetOrCreate } from './db.js';

// From env, or generated once and kept in the database (serverless instances have no disk to share).
let secretP = null;
const secret = () => (secretP ||= process.env.JWT_SECRET
  ? Promise.resolve(process.env.JWT_SECRET)
  : kvGetOrCreate('jwt_secret', () => crypto.randomBytes(48).toString('hex')));

export const signToken = async (userId) => jwt.sign({ sub: userId }, await secret(), { expiresIn: '180d' });

// Invite links: a signed "add me" token. Opening it and signing in makes you friends straight away.
export const signInvite = async (userId) => jwt.sign({ inv: userId }, await secret(), { expiresIn: '30d' });
export async function verifyInvite(token) {
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
