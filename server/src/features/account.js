// Your account: signed-in devices (and linking a new one), passkeys, password, preferences, storage, deleting it.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { q, one, run, id, now, publicUser, getUser, prefsOf, PREF_DEFAULTS } from '../db.js';
import { startSession, deviceName } from '../auth.js';
import { baseUrl } from '../scheduler.js';

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const code = (n) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const LINK_MS = 10 * 60000; // a "link a device" code works for 10 minutes, once
const CHALLENGE_MS = 5 * 60000;
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// Passkeys belong to the site the app is on. Only same-site requests can use them.
function relyingParty(req) {
  let origin;
  try { origin = new URL(String(req.headers.origin || '')); } catch { return null; }
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().split(':')[0];
  if (origin.hostname !== host && !['localhost', '127.0.0.1'].includes(origin.hostname)) return null;
  return { origin: origin.origin, rpID: origin.hostname };
}
async function saveChallenge(challenge, userId = null) {
  const cid = id();
  await run('DELETE FROM auth_challenges WHERE created_at < ?', [new Date(Date.now() - CHALLENGE_MS).toISOString()]);
  await run('INSERT INTO auth_challenges (id, challenge, user_id, created_at) VALUES (?, ?, ?, ?)', [cid, challenge, userId, now()]);
  return cid;
}
async function takeChallenge(cid) {
  const c = await one('SELECT * FROM auth_challenges WHERE id = ?', [String(cid || '')]);
  if (!c) return null;
  await run('DELETE FROM auth_challenges WHERE id = ?', [c.id]);
  return Date.now() - Date.parse(c.created_at) < CHALLENGE_MS ? c : null;
}

const PREF_RULES = {
  last_seen: ['everyone', 'nobody'], theme: ['system', 'light', 'dark'], accent: ['violet', 'blue', 'green', 'pink', 'orange'],
  text_size: ['s', 'm', 'l'], wallpaper: ['dots', 'plain', 'waves', 'hearts', 'stars'],
};

/** Routes that work before you're signed in: passkey sign-in and "link a device" codes. */
export function publicRoutes(api, { wrap, bad }) {
  api.post('/auth/passkey/options', wrap(async (req, res) => {
    const rp = relyingParty(req);
    if (!rp) return bad(res, "Passkeys don't work on this address");
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'preferred', allowCredentials: [] });
    res.json({ options, challenge_id: await saveChallenge(options.challenge) });
  }));

  api.post('/auth/passkey', wrap(async (req, res) => {
    const rp = relyingParty(req);
    const ch = await takeChallenge(req.body?.challenge_id);
    const resp = req.body?.response;
    if (!rp || !ch || !resp?.id) return bad(res, 'That took too long. Try again.');
    const pk = await one('SELECT * FROM passkeys WHERE id = ?', [resp.id]);
    if (!pk) return bad(res, "This passkey isn't linked to an account", 401);
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response: resp, expectedChallenge: ch.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID,
        credential: { id: pk.id, publicKey: Buffer.from(pk.public_key, 'base64url'), counter: pk.counter, transports: pk.transports ? JSON.parse(pk.transports) : undefined },
      });
    } catch (e) { return bad(res, "Couldn't check that passkey", 401); }
    if (!v.verified) return bad(res, "Couldn't check that passkey", 401);
    await run('UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?', [v.authenticationInfo.newCounter, now(), pk.id]);
    const u = await getUser(pk.user_id);
    res.json({ token: await startSession(u.id, req), user: publicUser(u) });
  }));

  // Open a link made on a signed-in phone to sign in here.
  api.post('/auth/link/:code', wrap(async (req, res) => {
    const c = await one('SELECT * FROM link_codes WHERE code = ?', [String(req.params.code || '').toLowerCase()]);
    if (!c || c.used || Date.now() - Date.parse(c.created_at) > LINK_MS) return bad(res, 'This link has expired. Make a new one on your other phone.', 410);
    if (!(await run('UPDATE link_codes SET used = 1 WHERE code = ? AND used = 0', [c.code]))) return bad(res, 'This link was already used', 410);
    const u = await getUser(c.user_id);
    res.json({ token: await startSession(u.id, req), user: publicUser(u) });
  }));
}

/** Routes for a signed-in person. */
export function routes(api, { wrap, bad }) {
  // Tokens from before devices were tracked get swapped for one tied to this device.
  api.post('/auth/refresh', wrap(async (req, res) => {
    if (req.user.sid) return res.json({ token: null });
    res.json({ token: await startSession(req.user.id, req) });
  }));

  // ---------- linked devices ----------
  api.get('/sessions', wrap(async (req, res) => {
    const rows = await q('SELECT id, device, created_at, last_active FROM sessions WHERE user_id = ? AND revoked = 0 ORDER BY last_active DESC', [req.user.id]);
    res.json({ sessions: rows.map((s) => ({ ...s, current: s.id === req.user.sid })) });
  }));
  api.delete('/sessions/:id', wrap(async (req, res) => {
    await run('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));
  api.post('/sessions/others/revoke', wrap(async (req, res) => {
    const n = await run('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id != ? AND revoked = 0', [req.user.id, req.user.sid || '']);
    res.json({ revoked: n });
  }));
  api.post('/link-codes', wrap(async (req, res) => {
    const c = code(8);
    await run('DELETE FROM link_codes WHERE user_id = ? AND (used = 1 OR created_at < ?)', [req.user.id, new Date(Date.now() - LINK_MS).toISOString()]);
    await run('INSERT INTO link_codes (code, user_id, created_at) VALUES (?, ?, ?)', [c, req.user.id, now()]);
    res.json({ code: c, url: `${baseUrl(req)}/link/${c}`, expires_at: new Date(Date.now() + LINK_MS).toISOString() });
  }));

  // ---------- passkeys ----------
  api.get('/passkeys', wrap(async (req, res) => {
    res.json({ passkeys: await q('SELECT id, name, created_at, last_used FROM passkeys WHERE user_id = ? ORDER BY created_at', [req.user.id]) });
  }));
  api.post('/passkeys/options', wrap(async (req, res) => {
    const rp = relyingParty(req);
    if (!rp) return bad(res, "Passkeys don't work on this address");
    const existing = await q('SELECT id, transports FROM passkeys WHERE user_id = ?', [req.user.id]);
    const options = await generateRegistrationOptions({
      rpName: process.env.APP_NAME || 'Linkup', rpID: rp.rpID, userName: req.user.username, userDisplayName: req.user.display_name,
      userID: new TextEncoder().encode(req.user.id), attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    res.json({ options, challenge_id: await saveChallenge(options.challenge, req.user.id) });
  }));
  api.post('/passkeys', wrap(async (req, res) => {
    const rp = relyingParty(req);
    const ch = await takeChallenge(req.body?.challenge_id);
    if (!rp || !ch || ch.user_id !== req.user.id) return bad(res, 'That took too long. Try again.');
    let v;
    try {
      v = await verifyRegistrationResponse({ response: req.body?.response, expectedChallenge: ch.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID });
    } catch (e) { return bad(res, "Couldn't save that passkey"); }
    if (!v.verified) return bad(res, "Couldn't save that passkey");
    const cred = v.registrationInfo.credential;
    const name = String(req.body?.name || '').slice(0, 40) || deviceName(req.headers['user-agent']);
    await run('INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
      [cred.id, req.user.id, b64u(cred.publicKey), cred.counter, cred.transports ? JSON.stringify(cred.transports) : null, name, now()]);
    res.json({ ok: true });
  }));
  api.delete('/passkeys/:id', wrap(async (req, res) => {
    await run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  // ---------- password, preferences, storage, delete ----------
  api.post('/me/password', wrap(async (req, res) => {
    const { current, next } = req.body || {};
    if (!(await bcrypt.compare(current || '', req.user.password_hash))) return bad(res, 'Your current password is wrong', 403);
    if (!next || next.length < 6) return bad(res, 'The new password needs at least 6 characters');
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(next, 10), req.user.id]);
    // Other devices have to sign in again with the new password.
    await run('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id != ?', [req.user.id, req.user.sid || '']);
    res.json({ ok: true });
  }));

  api.get('/me/prefs', (req, res) => res.json({ prefs: prefsOf(req.user) }));
  api.patch('/me/prefs', wrap(async (req, res) => {
    const cur = prefsOf(req.user);
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!(k in PREF_DEFAULTS)) continue;
      if (PREF_RULES[k]) { if (PREF_RULES[k].includes(v)) cur[k] = v; }
      else if (typeof v === 'boolean') cur[k] = v;
    }
    await run('UPDATE users SET prefs = ? WHERE id = ?', [JSON.stringify(cur), req.user.id]);
    res.json({ prefs: cur });
  }));

  api.get('/me/storage', wrap(async (req, res) => {
    const rows = await q('SELECT type, COUNT(*)::int AS n, COALESCE(SUM(size), 0)::bigint AS bytes FROM media WHERE owner_id = ? GROUP BY type', [req.user.id]);
    const kind = (t) => (t.startsWith('image/') ? 'photos' : t.startsWith('audio/') ? 'voice' : 'files');
    const out = { photos: { n: 0, bytes: 0 }, voice: { n: 0, bytes: 0 }, files: { n: 0, bytes: 0 } };
    for (const r of rows) { const k = kind(r.type); out[k].n += r.n; out[k].bytes += Number(r.bytes); }
    res.json({ storage: out });
  }));

  // Deleting your account signs you out everywhere and removes you. Chats keep your old messages as "Deleted account".
  api.post('/me/delete', wrap(async (req, res) => {
    if (!(await bcrypt.compare(req.body?.password || '', req.user.password_hash))) return bad(res, 'Wrong password', 403);
    const uid = req.user.id;
    await run(`UPDATE users SET username = ?, display_name = 'Deleted account', password_hash = '!', avatar = NULL, status_text = '',
      status = 'invisible', invite_code = NULL, prefs = NULL WHERE id = ?`, [`deleted-${uid.slice(0, 8)}`, uid]);
    await run('DELETE FROM friends WHERE user_id = ? OR friend_id = ?', [uid, uid]);
    await run('DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?', [uid, uid]);
    await run('DELETE FROM push_subscriptions WHERE user_id = ?', [uid]);
    await run('DELETE FROM passkeys WHERE user_id = ?', [uid]);
    await run('DELETE FROM availability WHERE user_id = ?', [uid]);
    await run(`UPDATE messages SET kind = 'deleted', body = '', data = NULL WHERE sender_id = ? AND kind IN ('image', 'voice', 'file')`, [uid]);
    await run('DELETE FROM media WHERE owner_id = ?', [uid]);
    await run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', [uid]);
    res.json({ ok: true });
  }));
}
