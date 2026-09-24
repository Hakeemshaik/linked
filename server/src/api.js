import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import {
  q, one, run, id, now, publicUser, getUser, getUsers, findUser, friendIds, areFriends, isMember, memberIds, parseRow, dbKind, prefsOf,
} from './db.js';
import { signToken, startSession, requireAuth, inviteCodeFor, verifyInvite, verifyToken, internalSecret } from './auth.js';
import {
  presenceOf, broadcastPresence, emitToUser, emitToUsers, heartbeat, realtimeKind, realtimeClientConfig,
  authorizeChannel, addStream, readRelay, visibleUserIds,
} from './realtime.js';
import { notify } from './notify.js';
import { vapid, saveSubscription, removeSubscription, sendPush } from './push.js';
import { runAI, converse, normalizePlan, aiInfo, aiErrorText, aiHeaders, aiMisconfigured } from './ai.js';
import { formatWhen, zonedToDate, TZ } from './time.js';
import { remindAt, scheduleReminder, runReminders, queueUpcoming, maybeRunReminders, remindersKind, baseUrl } from './scheduler.js';
import { background } from './background.js';
import * as account from './features/account.js';
import * as chatsFeature from './features/chats.js';
import * as communitiesFeature from './features/communities.js';
import * as nudgesFeature from './features/nudges.js';
import * as calendarFeature from './features/calendar.js';

export const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const COLORS = ['#7c5cff', '#ff5c8a', '#22c7a9', '#ffb020', '#3fa7ff', '#ff7a45', '#a3e635', '#e879f9'];
const STARTER_PICS = ['sprout', 'mochi', 'hop', 'pip', 'bo', 'lulu', 'ribbit', 'kit', 'hoot', 'bolt', 'zib', 'pan', 'waddle', 'rex', 'honey', 'nimbus', 'inky', 'fluff', 'koko'];
const STATUSES = ['available', 'busy', 'work', 'away', 'invisible'];
const TYPES = ['trip', 'hangout', 'meeting', 'call', 'event'];

// ---------- call relay (TURN) ----------
// Phones on mobile data or strict Wi-Fi often can't reach each other directly; a TURN relay carries the call then.
// Set one of: CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN (free tier), TURN_API_URL (returns ICE servers,
// e.g. Metered), or TURN_URL + TURN_USERNAME + TURN_PASSWORD.
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const E = process.env;
const relayKind = E.CLOUDFLARE_TURN_KEY_ID && E.CLOUDFLARE_TURN_API_TOKEN ? 'cloudflare' : E.TURN_API_URL ? 'api' : E.TURN_URL ? 'static' : null;
let relayCache = { at: 0, servers: [] };
const noPort53 = (s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }); // browsers stall on port 53
async function relayServers() {
  if (relayKind === 'static') return [{ urls: E.TURN_URL.split(',').map((u) => u.trim()), username: E.TURN_USERNAME, credential: E.TURN_PASSWORD }];
  if (!relayKind || Date.now() - relayCache.at < 3 * 3600e3) return relayCache.servers;
  let list;
  if (relayKind === 'cloudflare') {
    const call = (path) => fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${E.CLOUDFLARE_TURN_KEY_ID}/credentials/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${E.CLOUDFLARE_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(6000),
    });
    let r = await call('generate-ice-servers');
    if (r.status === 404) r = await call('generate');
    if (!r.ok) throw new Error(`Cloudflare TURN ${r.status}: ${(await r.text()).slice(0, 120)}`);
    list = [].concat((await r.json()).iceServers || []);
  } else {
    const r = await fetch(E.TURN_API_URL, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`TURN_API_URL ${r.status}`);
    const j = await r.json();
    list = [].concat(Array.isArray(j) ? j : j.iceServers || []);
  }
  relayCache = { at: Date.now(), servers: list.filter((x) => x?.urls).map(noPort53).filter((x) => x.urls.length) };
  return relayCache.servers;
}

// ---------- config ----------
api.get('/config', wrap(async (req, res) => {
  const ice = STUN; // relay (TURN) details are only handed out to signed-in people, at call time: /calls/ice
  res.json({
    appName: process.env.APP_NAME || 'Linkup',
    vapidPublicKey: (await vapid()).publicKey,
    iceServers: ice,
    registrationCodeRequired: !!process.env.REGISTRATION_CODE,
    timezone: TZ,
    ai: { model: aiInfo.model },
    realtime: realtimeClientConfig(),
  });
}));

// What's connected. Open /api/health after deploying to check the setup.
api.get('/health', wrap(async (req, res) => {
  let database = 'ok';
  let stored = 0;
  try { stored = Number((await one('SELECT COALESCE(SUM(size), 0) AS n FROM media')).n); } catch (e) { database = `error: ${e.message}`; }
  res.json({
    ok: database === 'ok' && realtimeKind !== 'none',
    database: `${dbKind === 'postgres' ? 'postgres' : 'local (embedded)'}: ${database}`,
    realtime: { pusher: 'pusher', sse: 'local stream', none: 'missing: set the PUSHER_* variables' }[realtimeKind],
    calls: relayKind ? `relay: ${relayKind}` : 'direct only: add a TURN relay (see README) or calls on mobile data may not connect',
    media: `${(stored / 1048576).toFixed(1)} MB of photos and voice messages`,
    reminders: { qstash: 'qstash + daily sweep', timer: 'local timer', 'cron-only': 'daily sweep only: set QSTASH_TOKEN for on-time reminders' }[remindersKind],
    planner: aiMisconfigured ? 'not set: add LLM_BASE_URL (your tunnel URL ending in /v1) and redeploy' : `${aiInfo.model}${aiInfo.fallback ? `, backup: ${aiInfo.fallback}` : ''}`,
  });
}));

// ---------- reminders (QStash at the reminder time, Vercel Cron once a day) ----------
async function cronAllowed(req) {
  const h = req.headers.authorization || '';
  if (h === `Bearer ${await internalSecret()}`) return true;
  if (process.env.CRON_SECRET) return h === `Bearer ${process.env.CRON_SECRET}`;
  return /^vercel-cron\//.test(req.headers['user-agent'] || '');
}
api.all('/cron/reminders', wrap(async (req, res) => {
  if (!(await cronAllowed(req))) return bad(res, 'Not allowed', 401);
  const sent = await runReminders();
  const queued = req.method === 'GET' ? await queueUpcoming(req) : 0; // GET = the daily cron
  res.json({ sent, queued });
}));

// ---------- auth ----------
api.post('/auth/register', wrap(async (req, res) => {
  const { username, display_name, password, code } = req.body || {};
  // A friend's invite link counts as the invite code.
  if (process.env.REGISTRATION_CODE && code !== process.env.REGISTRATION_CODE && !(await verifyInvite(req.body?.invite || ''))) return bad(res, 'Wrong invite code');
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username || '')) return bad(res, 'Username: 3-20 letters, numbers, _ or .');
  if (!password || password.length < 6) return bad(res, 'Password must be at least 6 characters');
  if (await findUser(username)) return bad(res, 'Username taken');
  const uid = id();
  const count = (await one('SELECT COUNT(*)::int AS c FROM users')).c;
  const color = COLORS[count % COLORS.length];
  // Everyone starts with one of the app's characters (so notifications show a face); they can change it in You.
  const avatar = STARTER_PICS.includes(req.body?.avatar) ? req.body.avatar : STARTER_PICS[crypto.randomInt(STARTER_PICS.length)];
  try {
    await run('INSERT INTO users (id, username, display_name, password_hash, color, avatar) VALUES (?,?,?,?,?,?)', [
      uid, username, (display_name || username).trim().slice(0, 40), await bcrypt.hash(password, 10), color, avatar,
    ]);
  } catch (e) {
    if (e.code === '23505') return bad(res, 'Username taken'); // two sign-ups raced for the same name
    throw e;
  }
  await ensureAIConversation(uid);
  res.json({ token: await startSession(uid, req), user: publicUser(await getUser(uid)) });
}));

api.post('/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const u = await findUser(username);
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) return bad(res, 'Wrong username or password', 401);
  if (u.password_hash === '!') return bad(res, 'Wrong username or password', 401); // deleted account
  await ensureAIConversation(u.id);
  res.json({ token: await startSession(u.id, req), user: publicUser(u) });
}));

// Who sent this invite link (shown on the sign-up screen before you have an account).
api.get('/invite-link/:token', wrap(async (req, res) => {
  const u = await verifyInvite(req.params.token);
  if (!u) return bad(res, 'This invite link has expired', 404);
  res.json({ user: publicUser(u) });
}));

// Local live-event stream (npm start / Docker). EventSource can't send headers, so the token is in the URL.
api.get('/realtime/stream', wrap(async (req, res) => {
  if (realtimeKind !== 'sse') return bad(res, 'Live events use Pusher here', 404);
  const user = await verifyToken(req.query.token);
  if (!user) return bad(res, 'Not signed in', 401);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  const remove = addStream(user.id, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); remove(); });
}));

// Photos and voice messages. Public like any image link, but the id is 128 random bits, so it can't be guessed.
// Supports byte ranges: iPhones only play audio from servers that do.
const MEDIA_KIND = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image',
  'audio/mp4': 'voice', 'audio/x-m4a': 'voice', 'audio/aac': 'voice', 'audio/mpeg': 'voice', 'audio/webm': 'voice', 'audio/ogg': 'voice',
  // documents: always downloaded, never shown as a page
  'application/pdf': 'file', 'text/plain': 'file', 'text/csv': 'file', 'application/zip': 'file', 'application/rtf': 'file',
  'application/msword': 'file', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'file',
  'application/vnd.ms-excel': 'file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'file',
  'application/vnd.ms-powerpoint': 'file', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'file',
};
const MEDIA_ID = /^[a-f0-9]{32}$/;
api.get('/media/:id', wrap(async (req, res) => {
  const m = MEDIA_ID.test(req.params.id) && await one('SELECT type, size, data, name FROM media WHERE id = ?', [req.params.id]);
  if (!m) return bad(res, 'Not found', 404);
  const buf = Buffer.from(m.data);
  res.set({ 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Content-Type': m.type });
  if (MEDIA_KIND[m.type] === 'file') res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(m.name || 'document')}`);
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (r && (r[1] || r[2])) {
    let start = r[1] ? Number(r[1]) : Math.max(0, buf.length - Number(r[2]));
    let end = r[1] && r[2] ? Math.min(Number(r[2]), buf.length - 1) : buf.length - 1;
    if (start >= buf.length || start > end) return res.status(416).set('Content-Range', `bytes */${buf.length}`).end();
    return res.status(206).set('Content-Range', `bytes ${start}-${end}/${buf.length}`).send(buf.subarray(start, end + 1));
  }
  res.send(buf);
}));

account.publicRoutes(api, { wrap, bad });

api.use(wrap(requireAuth));

// Upload a photo or voice message (the raw file as the body), then send it as a message.
api.post('/media', express.raw({ type: () => true, limit: '4mb' }), wrap(async (req, res) => {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!MEDIA_KIND[type]) return bad(res, 'Only photos and voice messages can be sent');
  const convId = String(req.query.conversation_id || '');
  if (!(await isMember(convId, req.user.id))) return bad(res, 'Not found', 404);
  if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 'The file was empty');
  const mid = crypto.randomBytes(16).toString('hex');
  const name = String(req.query.name || '').replace(/[\u0000-\u001f/\\]/g, '').slice(0, 120) || null;
  await run('INSERT INTO media (id, owner_id, conversation_id, type, size, data, created_at, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [mid, req.user.id, convId, type, req.body.length, req.body, now(), name]);
  res.json({ media: { id: mid, url: `/api/media/${mid}`, type, kind: MEDIA_KIND[type], size: req.body.length, name } });
}));

// Your invite link. Always on the production address, so a link shared from a preview deployment still works.
api.get('/invite-link', wrap(async (req, res) => {
  const token = await inviteCodeFor(req.user.id);
  res.json({ token, url: `${baseUrl(req)}/join/${token}` });
}));

async function findDM(a, b) {
  return (await one(
    `SELECT c.id FROM conversations c
     JOIN conversation_members x ON x.conversation_id = c.id AND x.user_id = ?
     JOIN conversation_members y ON y.conversation_id = c.id AND y.user_id = ?
     WHERE c.is_group = 0 AND c.is_ai = 0`,
    [a, b]
  ))?.id;
}

const befriend = (a, b) => run('INSERT INTO friends (user_id, friend_id) VALUES (?,?), (?,?) ON CONFLICT DO NOTHING', [a, b, b, a]);

// Accept an invite link: become friends both ways and open a chat.
api.post('/invite-link/accept', wrap(async (req, res) => {
  const inviter = await verifyInvite(req.body?.token || '');
  if (!inviter) return bad(res, 'This invite link has expired', 404);
  if (inviter.id === req.user.id) return bad(res, "That's your own link");
  await befriend(inviter.id, req.user.id);
  await run(`UPDATE friend_requests SET status = 'accepted' WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)`, [inviter.id, req.user.id, req.user.id, inviter.id]);
  let dm = await findDM(req.user.id, inviter.id);
  if (!dm) {
    dm = id();
    await run('INSERT INTO conversations (id, name, is_group) VALUES (?, NULL, 0)', [dm]);
    await run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)', [dm, req.user.id, dm, inviter.id]);
    await run(`INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at) VALUES (?, ?, NULL, 'system', ?, ?)`,
      [id(), dm, `${req.user.display_name} joined with ${inviter.display_name}'s link. Say hi!`, now()]);
  }
  await Promise.all([
    notify([inviter.id], {
      kind: 'friend_accept', title: `${req.user.display_name} joined Linkup`,
      body: 'You are now friends. Say hi!', url: `/chat/${dm}`,
    }),
    emitToUsers([inviter.id, req.user.id], 'friends:changed', {}),
    emitToUsers([inviter.id, req.user.id], 'conversations:changed', {}),
  ]);
  res.json({ conversation_id: dm, friend: publicUser(inviter) });
}));

api.get('/me', (req, res) => res.json({ user: publicUser(req.user), nudge: req.user.nudged_at ? { at: req.user.nudged_at, by: req.user.nudged_by } : null }));

const ART_ID = /^[a-z]{2,20}$/; // ids of the app's own art (profile pictures, stickers, GIFs)

api.patch('/me', wrap(async (req, res) => {
  const { display_name, status, status_text, avatar } = req.body || {};
  if (status !== undefined && !STATUSES.includes(status)) return bad(res, 'Bad status');
  if (avatar !== undefined && avatar !== '' && !ART_ID.test(avatar)) return bad(res, 'Bad picture');
  await run(
    `UPDATE users SET display_name = COALESCE(?, display_name), status = COALESCE(?, status), status_text = COALESCE(?, status_text),
       avatar = CASE WHEN ? THEN NULLIF(?, '') ELSE avatar END WHERE id = ?`,
    [display_name?.trim().slice(0, 40) || null, status ?? null, status_text !== undefined ? String(status_text).slice(0, 80) : null,
      avatar !== undefined, avatar ?? '', req.user.id]
  );
  await broadcastPresence(req.user.id);
  res.json({ user: publicUser(await getUser(req.user.id)) });
}));

// ---------- live events ----------
// Heartbeat from the app while it's on screen (and once when it's hidden). Returns friends' presence.
api.post('/presence', wrap(async (req, res) => {
  await heartbeat(req.user, !!req.body?.visible);
  if (req.user.sid) await run('UPDATE sessions SET last_active = ? WHERE id = ?', [now(), req.user.sid]); // for Linked devices
  maybeRunReminders();
  const friends = await getUsers(await friendIds(req.user.id));
  res.json({ friends: friends.map(presenceOf) });
}));

// Pusher private-channel auth: each user may only listen on their own channel.
api.post('/realtime/auth', wrap(async (req, res) => {
  const auth = await authorizeChannel(req.user, req.body?.socket_id, req.body?.channel_name);
  if (!auth) return bad(res, 'Not your channel', 403);
  res.json(auth);
}));

api.get('/realtime/relay/:id', wrap(async (req, res) => {
  const payload = await readRelay(req.params.id, req.user.id);
  if (!payload) return bad(res, 'Not found', 404);
  res.json({ payload });
}));

// ---------- push ----------
api.post('/push/subscribe', wrap(async (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return bad(res, 'Bad subscription');
  await saveSubscription(req.user.id, sub);
  if (req.user.nudged_at) await run('UPDATE users SET nudged_at = NULL, nudged_by = NULL WHERE id = ?', [req.user.id]);
  res.json({ ok: true });
}));
api.post('/push/unsubscribe', wrap(async (req, res) => {
  if (req.body?.endpoint) await removeSubscription(req.body.endpoint);
  res.json({ ok: true });
}));
api.post('/push/test', wrap(async (req, res) => {
  const r = await sendPush(req.user.id, {
    id: id(), title: 'Notifications are working', body: `Hey ${req.user.display_name}, this is what your alerts will look like.`,
    url: '/alerts', kind: 'test', tag: 'test', actions: [], timestamp: Date.now(),
  });
  res.json(r);
}));

// ---------- friends ----------
async function friendsPayload(uid) {
  const friends = (await getUsers(await friendIds(uid))).map(presenceOf);
  const incoming = (await q(
    `SELECT u.*, r.id AS request_id FROM friend_requests r JOIN users u ON u.id = r.from_id WHERE r.to_id = ? AND r.status = 'pending'`, [uid]
  )).map((r) => ({ request_id: r.request_id, user: publicUser(r) }));
  const outgoing = (await q(
    `SELECT u.*, r.id AS request_id FROM friend_requests r JOIN users u ON u.id = r.to_id WHERE r.from_id = ? AND r.status = 'pending'`, [uid]
  )).map((r) => ({ request_id: r.request_id, user: publicUser(r) }));
  return { friends, incoming, outgoing };
}

api.get('/friends', wrap(async (req, res) => res.json(await friendsPayload(req.user.id))));

api.post('/friends/request', wrap(async (req, res) => {
  const target = await findUser((req.body?.username || '').replace(/^@/, ''));
  if (!target) return bad(res, 'No one with that username', 404);
  if (target.id === req.user.id) return bad(res, "That's you");
  if (await areFriends(req.user.id, target.id)) return bad(res, 'Already friends');
  // If they already asked me, accept straight away.
  const reverse = await one(`SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`, [target.id, req.user.id]);
  if (reverse) {
    await acceptFriend(reverse);
    return res.json({ accepted: true });
  }
  await run(
    `INSERT INTO friend_requests (id, from_id, to_id) VALUES (?,?,?) ON CONFLICT (from_id, to_id) DO UPDATE SET status = 'pending'`,
    [id(), req.user.id, target.id]
  );
  await Promise.all([
    notify([target.id], {
      kind: 'friend_request',
      title: 'New friend request',
      body: `${req.user.display_name} (@${req.user.username}) wants to add you`,
      url: '/',
    }),
    emitToUser(target.id, 'friends:changed', {}),
  ]);
  res.json({ sent: true });
}));

async function acceptFriend(r) {
  await run(`UPDATE friend_requests SET status = 'accepted' WHERE id = ?`, [r.id]);
  await befriend(r.from_id, r.to_id);
  const accepter = await getUser(r.to_id);
  await Promise.all([
    notify([r.from_id], {
      kind: 'friend_accept', title: 'Friend request accepted',
      body: `${accepter.display_name} is now your friend. Say hi!`, url: '/',
    }),
    emitToUsers([r.from_id, r.to_id], 'friends:changed', {}),
  ]);
}

api.post('/friends/requests/:id/respond', wrap(async (req, res) => {
  const r = await one('SELECT * FROM friend_requests WHERE id = ? AND to_id = ?', [req.params.id, req.user.id]);
  if (!r) return bad(res, 'Request not found', 404);
  if (req.body?.accept) await acceptFriend(r);
  else await run(`UPDATE friend_requests SET status = 'declined' WHERE id = ?`, [r.id]);
  res.json(await friendsPayload(req.user.id));
}));

api.delete('/friends/:id', wrap(async (req, res) => {
  await run('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [
    req.user.id, req.params.id, req.params.id, req.user.id,
  ]);
  await emitToUsers([req.user.id, req.params.id], 'friends:changed', {});
  res.json({ ok: true });
}));

// ---------- availability ----------
const availabilityChanged = async (uid) => emitToUsers([uid, ...(await friendIds(uid))], 'availability:changed', { user_id: uid });

api.get('/availability', wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return bad(res, 'from and to required');
  const uids = [req.user.id, ...(await friendIds(req.user.id))];
  const users = (await getUsers(uids)).map((u) => (u.id === req.user.id ? { ...publicUser(u), online: true, me: true } : presenceOf(u)));
  const blocks = (await q('SELECT * FROM availability WHERE user_id = ANY(?) AND date BETWEEN ? AND ? ORDER BY date, start_time NULLS FIRST', [uids, from, to]))
    .map((b) => (b.user_id === req.user.id ? b : { ...b, note: '' })); // notes are private
  const fromISO = zonedToDate(from, '00:00').toISOString();
  const toISO = zonedToDate(to, '23:59').toISOString();
  const evRows = await q(
    `SELECT e.*, m.user_id AS member_id, m.rsvp FROM events e JOIN event_members m ON m.event_id = e.id
     WHERE m.user_id = ANY(?) AND m.rsvp != 'declined' AND e.end_at >= ? AND e.start_at <= ?`,
    [uids, fromISO, toISO]
  );
  const mine = new Set((await q('SELECT event_id FROM event_members WHERE user_id = ?', [req.user.id])).map((r) => r.event_id));
  // Friends' events I'm not part of show up only as "busy", no details.
  const events = evRows.map((e) => mine.has(e.id)
    ? { id: e.id, user_id: e.member_id, title: e.title, type: e.type, location: e.location || null, start_at: e.start_at, end_at: e.end_at, rsvp: e.rsvp, visible: true }
    : { id: null, user_id: e.member_id, title: 'Busy', type: 'private', start_at: e.start_at, end_at: e.end_at, visible: false });
  res.json({ users, blocks, events });
}));

api.post('/availability', wrap(async (req, res) => {
  const { date, kind, start_time, end_time, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return bad(res, 'Bad date');
  if (!['busy', 'work', 'free'].includes(kind)) return bad(res, 'Bad kind');
  const timed = start_time && end_time;
  if (timed && !(start_time < end_time)) return bad(res, 'End must be after start');
  if (!timed) await run('DELETE FROM availability WHERE user_id = ? AND date = ? AND start_time IS NULL', [req.user.id, date]);
  const aid = id();
  await run('INSERT INTO availability (id, user_id, date, start_time, end_time, kind, note) VALUES (?,?,?,?,?,?,?)', [
    aid, req.user.id, date, timed ? start_time : null, timed ? end_time : null, kind, String(note || '').slice(0, 80),
  ]);
  await availabilityChanged(req.user.id);
  res.json(await one('SELECT * FROM availability WHERE id = ?', [aid]));
}));

api.delete('/availability/:id', wrap(async (req, res) => {
  await run('DELETE FROM availability WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  await availabilityChanged(req.user.id);
  res.json({ ok: true });
}));

api.delete('/availability', wrap(async (req, res) => {
  await run('DELETE FROM availability WHERE user_id = ? AND date = ?', [req.user.id, req.query.date || '']);
  await availabilityChanged(req.user.id);
  res.json({ ok: true });
}));

// ---------- events ----------
async function eventPayload(eid) {
  const e = await one('SELECT * FROM events WHERE id = ?', [eid]);
  if (!e) return null;
  e.members = (await q('SELECT m.rsvp, u.* FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = ?', [eid]))
    .map((r) => ({ ...publicUser(r), rsvp: r.rsvp }));
  e.creator = publicUser(await getUser(e.creator_id));
  return e;
}

export async function createEvent(creator, input, req) {
  const type = TYPES.includes(input.type) ? input.type : 'hangout';
  const start = new Date(input.start_at);
  const end = new Date(input.end_at || input.start_at);
  if (!input.title?.trim()) throw Object.assign(new Error('Title required'), { status: 400 });
  if (isNaN(start) || isNaN(end) || end < start) throw Object.assign(new Error('Bad start/end time'), { status: 400 });
  const invited = [];
  for (const u of new Set(input.participant_ids || [])) {
    if (u !== creator.id && ((await areFriends(creator.id, u)) || (input.conversation_id && (await isMember(input.conversation_id, u))))) invited.push(u);
  }
  const eid = id();
  const reminder = Number.isFinite(+input.reminder_minutes) ? +input.reminder_minutes : type === 'trip' ? 1440 : 60;
  await run(
    `INSERT INTO events (id, creator_id, title, type, start_at, end_at, location, notes, conversation_id, call_room, reminder_minutes, remind_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [eid, creator.id, input.title.trim().slice(0, 120), type, start.toISOString(), end.toISOString(),
      String(input.location || '').slice(0, 200), String(input.notes || '').slice(0, 2000), input.conversation_id || null,
      type === 'call' ? id() : null, reminder, remindAt(start.toISOString(), reminder)]
  );
  await run(`INSERT INTO event_members (event_id, user_id, rsvp) VALUES (?, ?, 'going')`, [eid, creator.id]);
  for (const u of invited) await run(`INSERT INTO event_members (event_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [eid, u]);

  const e = await eventPayload(eid);
  const when = formatWhen(e.start_at, e.end_at);
  await Promise.all([
    scheduleReminder(e, req),
    notify(invited, {
      kind: 'event_invite',
      title: `${creator.display_name} invited you: ${e.title}`,
      body: [when, e.location, e.notes].filter(Boolean).join(' · ').slice(0, 240),
      url: `/event/${eid}`,
      data: { event_id: eid },
      actions: [
        { action: 'going', title: 'Going', url: `/event/${eid}?act=going` },
        { action: 'maybe', title: 'Maybe', url: `/event/${eid}?act=maybe` },
      ],
    }),
    emitToUsers([creator.id, ...invited], 'events:changed', { event_id: eid }),
    emitToUsers([creator.id, ...invited], 'availability:changed', {}),
  ]);
  return e;
}

api.get('/events', wrap(async (req, res) => {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const ids = (await q(
    `SELECT e.id FROM events e JOIN event_members m ON m.event_id = e.id WHERE m.user_id = ? AND e.end_at >= ? ORDER BY e.start_at`,
    [req.user.id, since]
  )).map((r) => r.id);
  res.json({ events: await Promise.all(ids.map(eventPayload)) });
}));

api.get('/events/:id', wrap(async (req, res) => {
  if (!(await one('SELECT 1 AS x FROM event_members WHERE event_id = ? AND user_id = ?', [req.params.id, req.user.id]))) return bad(res, 'Not found', 404);
  res.json({ event: await eventPayload(req.params.id) });
}));

api.post('/events', wrap(async (req, res) => {
  try {
    res.json({ event: await createEvent(req.user, req.body || {}, req) });
  } catch (e) {
    if (e.status) return bad(res, e.message, e.status);
    throw e;
  }
}));

api.patch('/events/:id', wrap(async (req, res) => {
  const e = await one('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!e || e.creator_id !== req.user.id) return bad(res, 'Only the creator can edit', 403);
  const b = req.body || {};
  const start = b.start_at ? new Date(b.start_at).toISOString() : e.start_at;
  const end = b.end_at ? new Date(b.end_at).toISOString() : e.end_at;
  const reminder = Number.isFinite(+b.reminder_minutes) ? +b.reminder_minutes : e.reminder_minutes;
  const type = TYPES.includes(b.type) ? b.type : e.type;
  const resetReminder = start !== e.start_at || reminder !== e.reminder_minutes;
  await run(
    `UPDATE events SET title = ?, type = ?, start_at = ?, end_at = ?, location = ?, notes = ?, reminder_minutes = ?, remind_at = ?,
       reminder_sent = ?, call_room = COALESCE(call_room, ?) WHERE id = ?`,
    [b.title ?? e.title, type, start, end, b.location ?? e.location, b.notes ?? e.notes, reminder, remindAt(start, reminder),
      resetReminder ? 0 : e.reminder_sent, type === 'call' ? id() : null, e.id]
  );
  if (Array.isArray(b.add_participant_ids)) {
    for (const u of b.add_participant_ids) {
      if (await areFriends(req.user.id, u)) await run('INSERT INTO event_members (event_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [e.id, u]);
    }
  }
  const ev = await eventPayload(e.id);
  const all = ev.members.map((m) => m.id);
  await Promise.all([
    resetReminder && scheduleReminder(ev, req),
    notify(all.filter((u) => u !== req.user.id), {
      kind: 'event_update', title: `Updated: ${ev.title}`,
      body: `${req.user.display_name} changed the plan · ${[formatWhen(ev.start_at, ev.end_at), ev.location].filter(Boolean).join(' · ')}`,
      url: `/event/${ev.id}`, tag: `event-${ev.id}`,
    }),
    emitToUsers(all, 'events:changed', { event_id: ev.id }),
    emitToUsers(all, 'availability:changed', {}),
  ]);
  res.json({ event: ev });
}));

api.delete('/events/:id', wrap(async (req, res) => {
  const ev = await eventPayload(req.params.id);
  if (!ev || ev.creator_id !== req.user.id) return bad(res, 'Only the creator can cancel', 403);
  await run('DELETE FROM events WHERE id = ?', [ev.id]);
  const all = ev.members.map((m) => m.id);
  await Promise.all([
    notify(all.filter((u) => u !== req.user.id), {
      kind: 'event_cancel', title: `Cancelled: ${ev.title}`,
      body: `${req.user.display_name} cancelled ${formatWhen(ev.start_at, ev.end_at)}`, url: '/plans',
    }),
    emitToUsers(all, 'events:changed', { event_id: ev.id }),
    emitToUsers(all, 'availability:changed', {}),
  ]);
  res.json({ ok: true });
}));

api.post('/events/:id/rsvp', wrap(async (req, res) => {
  const rsvp = req.body?.rsvp;
  if (!['going', 'maybe', 'declined'].includes(rsvp)) return bad(res, 'Bad RSVP');
  const changed = await run('UPDATE event_members SET rsvp = ? WHERE event_id = ? AND user_id = ?', [rsvp, req.params.id, req.user.id]);
  if (!changed) return bad(res, 'Not invited', 404);
  const ev = await eventPayload(req.params.id);
  const jobs = [
    emitToUsers(ev.members.map((m) => m.id), 'events:changed', { event_id: ev.id }),
    availabilityChanged(req.user.id),
  ];
  if (ev.creator_id !== req.user.id) {
    const word = { going: 'is going to', maybe: 'might come to', declined: "can't make" }[rsvp];
    jobs.push(notify([ev.creator_id], {
      kind: 'rsvp', title: `${req.user.display_name} ${word} ${ev.title}`,
      body: `${ev.members.filter((m) => m.rsvp === 'going').length} going · ${formatWhen(ev.start_at, ev.end_at)}`,
      url: `/event/${ev.id}`, tag: `rsvp-${ev.id}`,
    }));
  }
  await Promise.all(jobs);
  res.json({ event: ev });
}));

// ---------- conversations ----------
async function ensureAIConversation(uid) {
  const existing = await one(
    `SELECT c.id FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id WHERE c.is_ai = 1 AND m.user_id = ?`, [uid]
  );
  if (existing) return existing.id;
  const cid = id();
  await run(`INSERT INTO conversations (id, name, is_group, is_ai) VALUES (?, 'Planner', 0, 1)`, [cid]);
  await run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [cid, uid]);
  await run(`INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at) VALUES (?, ?, NULL, 'ai', ?, ?)`, [
    id(), cid, "Hi! I'm Planner. Ask me anything, or tell me what you want to do and who with. I'll find a time you're all free, book it and remind everyone.", now(),
  ]);
  return cid;
}

/** Chat list rows: members with presence, last message, unread count and read receipts. Four queries for any number of chats. */
async function convSummaries(convs, uid) {
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);
  const [memberRows, lastRows, unreadRows, comms] = await Promise.all([
    q(`SELECT m.conversation_id, m.last_read_at, m.muted_until, m.archived, m.pinned_at, m.favorite, m.cleared_at, m.hidden, m.marked_unread,
         m.theme, m.role AS member_role, u.*
       FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ANY(?)`, [ids]),
    // The last message you can still see (clearing a chat hides what came before).
    q(`SELECT DISTINCT ON (x.conversation_id) x.* FROM messages x
       JOIN conversation_members m ON m.conversation_id = x.conversation_id AND m.user_id = ?
       WHERE x.conversation_id = ANY(?) AND x.created_at > COALESCE(m.cleared_at, '') ORDER BY x.conversation_id, x.created_at DESC`, [uid, ids]),
    q(`SELECT m.conversation_id, COUNT(x.id)::int AS c FROM conversation_members m
       JOIN messages x ON x.conversation_id = m.conversation_id AND (x.sender_id IS NULL OR x.sender_id != m.user_id) AND x.kind != 'system'
         AND x.created_at > COALESCE(m.last_read_at, '')
       WHERE m.user_id = ? AND m.conversation_id = ANY(?) GROUP BY m.conversation_id`, [uid, ids]),
    q('SELECT id, name, avatar FROM communities WHERE id = ANY(?)', [[...new Set(convs.map((c) => c.community_id).filter(Boolean))]]),
  ]);
  const senders = await usersById(lastRows.map((m) => m.sender_id));
  const lasts = new Map(lastRows.map((m) => [m.conversation_id, messagePayload(parseRow(m), senders)]));
  const unread = new Map(unreadRows.map((r) => [r.conversation_id, r.c]));
  const communities = new Map(comms.map((x) => [x.id, x]));
  const blocked = new Set(await chatsFeature.blockedIds(uid));
  const t = now();
  return convs.map((c) => {
    const rows = memberRows.filter((r) => r.conversation_id === c.id);
    const mine = rows.find((r) => r.id === uid) || {};
    const myPrefs = prefsOf(mine);
    const members = rows.map((u) => (u.id === uid ? { ...publicUser(u), me: true, role: u.member_role } : { ...presenceOf(u), role: u.member_role, blocked: blocked.has(u.id) }));
    const others = members.filter((m) => !m.me);
    const community = c.community_id ? communities.get(c.community_id) || null : null;
    // A community's Announcements chat goes by the community's name.
    const title = c.is_ai ? 'Planner' : c.kind === 'announcements' && community ? community.name : c.name || others.map((m) => m.display_name).join(', ') || 'Just you';
    // Read receipts: someone who turned them off doesn't share theirs, and sees nobody else's.
    const reads = Object.fromEntries(rows.filter((r) => r.id === uid || (myPrefs.read_receipts && prefsOf(r).read_receipts)).map((r) => [r.id, r.last_read_at]));
    const muted = !!mine.muted_until && mine.muted_until > t;
    return {
      ...c, title, members, reads, last_message: lasts.get(c.id) || null, unread: unread.get(c.id) || 0,
      muted, muted_until: muted ? mine.muted_until : null, archived: !!mine.archived, pinned_at: mine.pinned_at || null, favorite: !!mine.favorite,
      marked_unread: !!mine.marked_unread, theme: mine.theme || null, hidden: !!mine.hidden, cleared_at: mine.cleared_at || null, my_role: mine.member_role || null,
      community, avatar: c.avatar || (c.kind === 'announcements' ? community?.avatar : null) || null,
    };
  });
}
const convSummary = async (convId, uid) => (await convSummaries([await one('SELECT * FROM conversations WHERE id = ?', [convId])], uid))[0];

const usersById = async (ids) => new Map((await getUsers(ids.filter(Boolean))).map((u) => [u.id, u]));
function messagePayload(m, users) {
  const s = m.sender_id ? users.get(m.sender_id) : null;
  return { ...m, sender: s ? publicUser(s) : null };
}

api.get('/conversations', wrap(async (req, res) => {
  await ensureAIConversation(req.user.id);
  const rows = await q(
    `SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id WHERE m.user_id = ? ORDER BY c.updated_at DESC`,
    [req.user.id]
  );
  // A chat you deleted stays off your list until someone writes in it again.
  res.json({ conversations: (await convSummaries(rows, req.user.id)).filter((c) => !c.hidden) });
}));

api.get('/conversations/:id', wrap(async (req, res) => {
  if (!(await isMember(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
  res.json({ conversation: await convSummary(req.params.id, req.user.id) });
}));

api.post('/conversations', wrap(async (req, res) => {
  const ids = [];
  for (const u of new Set(req.body?.member_ids || [])) if (await areFriends(req.user.id, u)) ids.push(u);
  if (!ids.length) return bad(res, 'Pick at least one friend');
  if (ids.length === 1 && !req.body?.name) {
    const dm = await findDM(req.user.id, ids[0]);
    if (dm) return res.json({ conversation: await convSummary(dm, req.user.id) });
  }
  const cid = id();
  const isGroup = ids.length > 1 || !!req.body?.name;
  await run('INSERT INTO conversations (id, name, is_group) VALUES (?, ?, ?)', [cid, isGroup ? String(req.body?.name || '').slice(0, 60) || null : null, isGroup ? 1 : 0]);
  for (const u of [req.user.id, ...ids]) await run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [cid, u]);
  await emitToUsers([req.user.id, ...ids], 'conversations:changed', {});
  res.json({ conversation: await convSummary(cid, req.user.id) });
}));

api.get('/conversations/:id/messages', wrap(async (req, res) => {
  const me = await one('SELECT cleared_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!me) return bad(res, 'Not found', 404);
  const before = req.query.before || '9999';
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));
  const rows = (await q('SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? AND created_at > ? ORDER BY created_at DESC LIMIT ?',
    [req.params.id, before, me.cleared_at || '', limit])).reverse();
  const mids = rows.map((m) => m.id);
  const [users, reacts, stars] = await Promise.all([usersById(rows.map((m) => m.sender_id)), reactionsFor(mids),
    mids.length ? q('SELECT message_id FROM stars WHERE user_id = ? AND message_id = ANY(?)', [req.user.id, mids]) : []]);
  const starred = new Set(stars.map((r) => r.message_id));
  res.json({ messages: rows.map((m) => ({ ...messagePayload(parseRow(m), users), reactions: reacts.get(m.id) || {}, ...(starred.has(m.id) ? { starred: true } : {}) })), more: rows.length === limit });
}));

api.post('/conversations/:id/read', wrap(async (req, res) => {
  if (!(await isMember(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
  const at = now();
  await run('UPDATE conversation_members SET last_read_at = ?, marked_unread = 0 WHERE conversation_id = ? AND user_id = ?', [at, req.params.id, req.user.id]);
  // Opening the chat also clears its alerts (plan cards etc.), like reading them.
  await run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0 AND (url = ? OR data LIKE ?)`, [req.user.id, `/chat/${req.params.id}`, `%"conversation_id":"${req.params.id}"%`]);
  // With read receipts off, nobody is told you read it.
  const who = prefsOf(req.user).read_receipts ? await memberIds(req.params.id) : [req.user.id];
  await emitToUsers(who, 'read', { conversation_id: req.params.id, user_id: req.user.id, at });
  res.json({ ok: true });
}));

api.post('/conversations/:id/typing', wrap(async (req, res) => {
  const members = await memberIds(req.params.id);
  if (!members.includes(req.user.id)) return bad(res, 'Not found', 404);
  await emitToUsers(members.filter((m) => m !== req.user.id), 'typing', { conversation_id: req.params.id, user: publicUser(req.user) });
  res.json({ ok: true });
}));

// Lock screens can't show the app's own emoji, so notifications use the closest standard one.
const EMOJI_TEXT = { love: '💜', lol: '😂', hype: '🔥', omw: '🏃', braai: '🍖', cheers: '🍻', free: '✅', meh: '😒', sleepy: '😴', party: '🎉' };
const lockScreenText = (t) => t.replace(/:([a-z]+):/g, (m, id) => EMOJI_TEXT[id] || m);

/** { messageId: { emoji: [userId, ...] } } for these messages. */
async function reactionsFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  for (const r of await q('SELECT message_id, user_id, emoji FROM reactions WHERE message_id = ANY(?) ORDER BY created_at', [ids])) {
    const m = out.get(r.message_id) || {};
    (m[r.emoji] ||= []).push(r.user_id);
    out.set(r.message_id, m);
  }
  return out;
}

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
/** A short copy of a message for a reply's quote, so the quote survives edits and deletes. */
function quoteOf(o) {
  const q = { id: o.id, kind: o.kind, body: String(o.body || '').slice(0, 140), sender_id: o.sender_id, sender_name: o.sender_id ? o.display_name : 'Planner' };
  if (o.data?.ref) q.ref = o.data.ref;
  if (o.kind === 'image' && o.data?.thumb) q.thumb = o.data.thumb;
  if (o.kind === 'voice') q.duration = o.data?.duration || 0;
  return q;
}
/** How a message reads on a lock screen or in a chat preview. */
function messageText(kind, body, data) {
  if (kind === 'sticker') return 'Sent a sticker';
  if (kind === 'gif') return 'Sent a GIF';
  if (kind === 'image') return body ? `Photo: ${lockScreenText(body)}` : 'Photo';
  if (kind === 'voice') return `Voice message (${clock(data?.duration || 0)})`;
  if (kind === 'file') return `Document: ${body}`;
  if (kind === 'nudge') return 'Asked you to turn on notifications';
  return lockScreenText(body);
}

async function postMessage(convId, sender, kind, body, data = null, clientId = null) {
  const mid = id();
  const ts = now();
  await run('INSERT INTO messages (id, conversation_id, sender_id, kind, body, data, created_at) VALUES (?,?,?,?,?,?,?)',
    [mid, convId, sender?.id || null, kind, body, data ? JSON.stringify(data) : null, ts]);
  await run('UPDATE conversations SET updated_at = ? WHERE id = ?', [ts, convId]);
  await run('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ? AND hidden = 1', [convId]); // a deleted chat comes back
  if (sender) await run('UPDATE conversation_members SET last_read_at = ?, marked_unread = 0 WHERE conversation_id = ? AND user_id = ?', [ts, convId, sender.id]);
  // client_id lets the sender's phone swap its instant "sending" bubble for the real one.
  const msg = { id: mid, conversation_id: convId, sender_id: sender?.id || null, kind, body, data, created_at: ts, sender: sender ? publicUser(sender) : null, reactions: {}, ...(clientId ? { client_id: clientId } : {}) };
  const [members, conv] = await Promise.all([memberIds(convId), one('SELECT * FROM conversations WHERE id = ?', [convId])]);

  const from = sender ? sender.display_name : 'Planner';
  // Like WhatsApp: a chat's notification is titled with the chat, a group's lines say who wrote them.
  let title = conv.is_group ? conv.name || 'Group chat' : from;
  let text = messageText(kind, body, data);
  if (conv.is_group && kind !== 'plan') text = `${from.split(' ')[0]}: ${text}`;
  if (kind === 'plan' && data?.plan) {
    const p = data.plan;
    title = `Planner suggested: ${p.title}`;
    text = [p.start_at ? formatWhen(p.start_at, p.end_at) : 'date not set yet', p.location].filter(Boolean).join(' · ') + ' · Tap to confirm';
  }
  // Who gets told: not you, not anyone who muted the chat or turned these notifications off.
  const rows = await q('SELECT m.user_id, m.muted_until, u.prefs FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ?', [convId]);
  const quiet = (r) => (r.muted_until && r.muted_until > ts) || !prefsOf(r)[conv.is_group ? 'notify_groups' : 'notify_messages'];
  const tell = rows.filter((r) => r.user_id !== sender?.id && kind !== 'system' && !quiet(r));
  // "Keep chats archived" off: a new message brings the chat back to the main list.
  const unarchive = rows.filter((r) => r.user_id !== sender?.id && kind !== 'system' && !prefsOf(r).keep_archived).map((r) => r.user_id);
  if (unarchive.length) await run('UPDATE conversation_members SET archived = 0 WHERE conversation_id = ? AND archived = 1 AND user_id = ANY(?)', [convId, unarchive]);
  const base = {
    kind: 'message', title, url: `/chat/${convId}`, tag: `chat-${convId}`,
    data: { conversation_id: convId, from: sender ? publicUser(sender) : null }, store: kind === 'plan',
  };
  const full = tell.filter((r) => prefsOf(r).previews).map((r) => r.user_id);
  const hidden = tell.filter((r) => !prefsOf(r).previews).map((r) => r.user_id);
  await Promise.all([
    emitToUsers(members, 'message', msg),
    notify(full, { ...base, body: text.slice(0, 240), image: kind === 'image' ? data.url : undefined }),
    notify(hidden, { ...base, body: 'New message' }), // previews off: who it's from, not what it says
  ]);
  return msg;
}

// One Planner reply at a time per chat, across every server instance.
async function claimAI(convId) {
  const t = Date.now();
  return !!(await run('UPDATE conversations SET ai_busy_until = ? WHERE id = ? AND (ai_busy_until IS NULL OR ai_busy_until < ?)',
    [new Date(t + 300000).toISOString(), convId, new Date(t).toISOString()]));
}
const aiBusy = async (convId) => ((await one('SELECT ai_busy_until FROM conversations WHERE id = ?', [convId]))?.ai_busy_until || '') > now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Ways to ask Planner in any chat: "@Planner ...", "@ai ...", "Planner, ...", "Hey Planner ...", or replying to it.
const AI_CALL = /(^|\s)@(ai|planner)\b/i;
const AI_HEY = /^\s*(?:(?:hey|hi|yo|ok|okay)\s+planner\b|planner\s*[,:!?])/i;
const askedPlanner = (body) => AI_CALL.test(body) || AI_HEY.test(body);
const withoutCall = (body) => body.replace(/@(ai|planner)\b[,:]?/gi, '').replace(/^\s*(?:(?:hey|hi|yo|ok|okay)\s+)?planner\b\s*[,:!?]?/i, '').trim();

async function aiRespond(convId, requesterId, mode, instruction, trigger = null) {
  // One answer at a time per chat: a question asked meanwhile waits its turn instead of being dropped.
  let claimed = false;
  for (let i = 0; i < 40 && !(claimed = await claimAI(convId)); i++) await sleep(1500);
  if (!claimed) return;
  const members = await memberIds(convId);
  const conv = await one('SELECT is_ai FROM conversations WHERE id = ?', [convId]);
  if (mode === 'reply' && trigger && conv?.is_ai) {
    // Several quick messages in your Planner chat get one answer, to the last of them.
    await sleep(1200);
    const newer = await one('SELECT id FROM messages WHERE conversation_id = ? AND sender_id = ? AND created_at > ? LIMIT 1', [convId, requesterId, trigger.created_at]);
    if (newer) return void (await run('UPDATE conversations SET ai_busy_until = NULL WHERE id = ?', [convId]));
  }
  await emitToUsers(members, 'ai:thinking', { conversation_id: convId, on: true });
  try {
    // Your private Planner chat can see and invite all your friends.
    const opts = conv?.is_ai ? { memberIdsOverride: [requesterId, ...(await friendIds(requesterId))], personal: true } : {};
    let reply, plan;
    if (mode === 'reply') {
      // Stream the answer into the chat as it's written, a couple of updates a second.
      let seq = 0, at = 0, chain = Promise.resolve();
      const onText = (text) => {
        if (Date.now() - at < 500) return;
        at = Date.now();
        const n = ++seq;
        chain = chain.then(() => emitToUsers(members, 'ai:stream', { conversation_id: convId, seq: n, text: text.slice(0, 3500) })).catch(() => {});
      };
      ({ reply, plan } = await converse(convId, { requesterId, instruction, trigger, onText, ...opts }));
      await chain;
    } else ({ reply, plan } = await runAI(convId, { mode, requesterId, instruction, ...opts }));
    // In a group, the answer quotes the question so everyone sees what it's answering.
    if (reply) await postMessage(convId, null, 'ai', reply, trigger && !conv?.is_ai ? { reply: quoteOf(trigger) } : null);
    if (plan) await postMessage(convId, null, 'plan', plan.title, { plan, status: 'proposed', requested_by: requesterId });
    else if (mode === 'plan' && !reply) await postMessage(convId, null, 'ai', "I couldn't find a plan in the chat yet. Mention what, when and where and tap Plan it again.");
  } catch (e) {
    console.warn('[ai] error', e.message);
    await postMessage(convId, null, 'ai', `I can't answer right now: ${aiErrorText(e)}. Try again in a bit.`);
  } finally {
    await run('UPDATE conversations SET ai_busy_until = NULL WHERE id = ?', [convId]);
    await emitToUsers(members, 'ai:thinking', { conversation_id: convId, on: false });
  }
}

api.post('/conversations/:id/messages', wrap(async (req, res) => {
  const convId = req.params.id;
  if (!(await isMember(convId, req.user.id))) return bad(res, 'Not found', 404);
  const convInfo = await one('SELECT is_group, is_ai FROM conversations WHERE id = ?', [convId]);
  if (!convInfo.is_group && !convInfo.is_ai) {
    const other = (await memberIds(convId)).find((u) => u !== req.user.id);
    if (other && (await chatsFeature.blockedBetween(req.user.id, other))) {
      const iBlocked = await one('SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?', [req.user.id, other]);
      return bad(res, iBlocked ? 'You blocked this person. Unblock them to send a message.' : "You can't message this person", 403);
    }
  }
  // Stickers and GIFs are the app's own art, sent by id. Photos and voice messages are uploaded to /media first; documents too.
  const kind = ['sticker', 'gif', 'image', 'voice', 'file'].includes(req.body?.kind) ? req.body.kind : 'text';
  const clientId = /^[a-z0-9]{4,40}$/i.test(req.body?.client_id || '') ? req.body.client_id : null;
  // Replying: keep a short copy of the message being answered, so the quote survives edits and deletes.
  let reply = null;
  if (req.body?.reply_to) {
    const o = parseRow(await one('SELECT m.id, m.kind, m.body, m.data, m.sender_id, u.display_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ? AND m.conversation_id = ?', [req.body.reply_to, convId]));
    if (o && o.kind !== 'deleted') reply = quoteOf(o);
  }
  if (kind === 'image' || kind === 'voice' || kind === 'file') {
    const mid = String(req.body?.media || '');
    const m = MEDIA_ID.test(mid) && await one('SELECT id, type, size, owner_id, conversation_id, name FROM media WHERE id = ?', [mid]);
    if (!m || m.owner_id !== req.user.id || m.conversation_id !== convId || MEDIA_KIND[m.type] !== kind) return bad(res, 'Send the file again');
    const data = { media: m.id, url: `/api/media/${m.id}`, type: m.type, size: m.size, ...(reply ? { reply } : {}) };
    let body = '';
    if (kind === 'file') {
      data.name = m.name || 'Document';
      body = data.name;
    } else if (kind === 'image') {
      const dim = (v) => Math.min(10000, Math.max(1, Math.round(Number(v)) || 1));
      Object.assign(data, { w: dim(req.body.w), h: dim(req.body.h) });
      const thumb = String(req.body.thumb || '');
      if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb) && thumb.length < 6000) data.thumb = thumb;
      body = String(req.body.body || '').trim().slice(0, 1000);
    } else {
      data.duration = Math.min(900, Math.max(0.3, Number(req.body.duration) || 1));
      const wave = String(req.body.wave || '');
      if (/^[0-9]{1,64}$/.test(wave)) data.wave = wave;
    }
    return res.json({ message: await postMessage(convId, req.user, kind, body, data, clientId) });
  }
  if (kind !== 'text') {
    if (!ART_ID.test(req.body?.ref || '')) return bad(res, 'Unknown sticker');
    return res.json({ message: await postMessage(convId, req.user, kind, kind === 'gif' ? 'GIF' : 'Sticker', { ref: req.body.ref, ...(reply ? { reply } : {}) }, clientId) });
  }
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return bad(res, 'Empty message');
  const msg = await postMessage(convId, req.user, 'text', body, reply ? { reply } : null, clientId);
  const conv = await one('SELECT is_ai FROM conversations WHERE id = ?', [convId]);
  const toPlanner = reply && !reply.sender_id && reply.kind !== 'plan'; // replying to one of Planner's messages
  if (conv.is_ai || toPlanner || askedPlanner(body)) {
    const trigger = { id: msg.id, kind: 'text', body, sender_id: req.user.id, display_name: req.user.display_name, created_at: msg.created_at, quoted: reply };
    background(aiRespond(convId, req.user.id, 'reply', withoutCall(body) || body, trigger));
  }
  res.json({ message: msg });
}));

api.post('/conversations/:id/plan', wrap(async (req, res) => {
  if (!(await isMember(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
  if (await aiBusy(req.params.id)) return bad(res, 'Planner is already working on it', 409);
  background(aiRespond(req.params.id, req.user.id, 'plan'));
  res.json({ started: true });
}));

// React to a message with one of the app's emoji. One reaction each: picking another swaps it, the same one takes it back.
api.post('/messages/:id/react', wrap(async (req, res) => {
  const m = await one('SELECT id, conversation_id, sender_id, kind, body FROM messages WHERE id = ?', [req.params.id]);
  if (!m || !(await isMember(m.conversation_id, req.user.id))) return bad(res, 'Not found', 404);
  if (m.kind === 'deleted' || m.kind === 'system') return bad(res, "You can't react to this message");
  const emoji = String(req.body?.emoji || '');
  if (!Object.hasOwn(EMOJI_TEXT, emoji)) return bad(res, 'Unknown emoji');
  const removed = await run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [m.id, req.user.id, emoji]);
  if (!removed) {
    await run('DELETE FROM reactions WHERE message_id = ? AND user_id = ?', [m.id, req.user.id]);
    await run('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [m.id, req.user.id, emoji, now()]);
    // Tell the author, like any other message (one notification per message, replaced if they change it).
    const author = m.sender_id && m.sender_id !== req.user.id ? await getUser(m.sender_id) : null;
    if (author && prefsOf(author).notify_reactions) {
      const conv = await one('SELECT name, is_group FROM conversations WHERE id = ?', [m.conversation_id]);
      const what = { sticker: 'your sticker', gif: 'your GIF', image: 'your photo', voice: 'your voice message' }[m.kind] || `"${lockScreenText(m.body).slice(0, 80)}"`;
      background(notify([m.sender_id], {
        kind: 'reaction', title: conv?.is_group ? `${req.user.display_name} in ${conv.name || 'group chat'}` : req.user.display_name,
        body: `Reacted ${EMOJI_TEXT[emoji]} to ${what}`, url: `/chat/${m.conversation_id}`, tag: `react-${m.id}`,
        data: { conversation_id: m.conversation_id, from: publicUser(req.user) }, store: false,
      }));
    }
  }
  const reactions = (await reactionsFor([m.id])).get(m.id) || {};
  await emitToUsers(await memberIds(m.conversation_id), 'message:react', { conversation_id: m.conversation_id, message_id: m.id, reactions });
  res.json({ reactions });
}));

// Delete for everyone: only the sender, and the bubble stays as "deleted".
api.delete('/messages/:id', wrap(async (req, res) => {
  const m = await one('SELECT * FROM messages WHERE id = ?', [req.params.id]);
  if (!m || m.sender_id !== req.user.id) return bad(res, 'You can only delete your own messages', 403);
  await run(`UPDATE messages SET kind = 'deleted', body = '', data = NULL WHERE id = ?`, [m.id]);
  await run('DELETE FROM reactions WHERE message_id = ?', [m.id]);
  const media = parseRow({ data: m.data }).data?.media;
  if (media) await run('DELETE FROM media WHERE id = ? AND owner_id = ?', [media, req.user.id]);
  const updated = { ...m, kind: 'deleted', body: '', data: null, reactions: {}, sender: publicUser(req.user) };
  await emitToUsers(await memberIds(m.conversation_id), 'message:update', updated);
  res.json({ message: updated });
}));

// Confirm (optionally edited) plan card -> real event + invites.
api.post('/messages/:id/confirm-plan', wrap(async (req, res) => {
  const m = parseRow(await one('SELECT * FROM messages WHERE id = ?', [req.params.id]));
  if (!m || m.kind !== 'plan' || !(await isMember(m.conversation_id, req.user.id))) return bad(res, 'Not found', 404);
  if (m.data.status === 'created') return res.json({ event_id: m.data.event_id });
  const convRow = await one('SELECT is_ai FROM conversations WHERE id = ?', [m.conversation_id]);
  const memberList = convRow?.is_ai ? [req.user.id, ...(await friendIds(req.user.id))] : await memberIds(m.conversation_id);
  const members = await getUsers(memberList);
  const edited = { ...m.data.plan, ...(req.body || {}) };
  const pick = req.body?.participant_ids || m.data.plan.participant_ids;
  edited.participants = members.filter((u) => pick.includes(u.id)).map((u) => u.username);
  const plan = await normalizePlan(edited, members);
  if (!plan.start_at) return bad(res, 'Pick a date first');
  const ids = plan.participant_ids.includes(req.user.id) ? plan.participant_ids : [req.user.id, ...plan.participant_ids];
  const ev = await createEvent(req.user, { ...plan, participant_ids: ids, conversation_id: m.conversation_id }, req);
  const data = { ...m.data, plan, status: 'created', event_id: ev.id, confirmed_by: req.user.id };
  await run('UPDATE messages SET data = ? WHERE id = ?', [JSON.stringify(data), m.id]);
  await emitToUsers(await memberIds(m.conversation_id), 'message:update', { ...m, data, sender: null });
  await postMessage(m.conversation_id, null, 'system', `${req.user.display_name} locked it in: ${ev.title} · ${formatWhen(ev.start_at, ev.end_at)}. Invites sent.`);
  res.json({ event_id: ev.id });
}));

// ---------- quick invites (video call / chill) ----------
// A call rings for 45s. The caller's screen gives up at the same time and marks it missed.
const RING_MS = 45000;
const callActions = (iid) => [
  { action: 'accept', title: 'Join', url: `/invite/${iid}?act=accept` },
  { action: 'decline', title: 'Decline', url: `/invite/${iid}?act=decline` },
];

// A web push can't ring like a phone call, so while a call rings we re-send it every 6s:
// each one alerts again (sound + vibration) on a locked phone. Stops the moment it's answered or missed.
async function keepRinging(invites, from) {
  for (let t = 6000; t < RING_MS - 3000; t += 6000) {
    await new Promise((r) => setTimeout(r, 6000));
    const pending = await q(`SELECT id, to_id FROM invites WHERE id = ANY(?) AND status = 'pending'`, [invites.map((i) => i.id)]);
    if (!pending.length) return;
    const onScreen = await visibleUserIds(pending.map((p) => p.to_id)); // the in-app ring handles those
    await Promise.all(pending.filter((p) => !onScreen.has(p.to_id)).map((p) => sendPush(p.to_id, {
      id: p.id, kind: 'invite_call', title: `${from.display_name} is calling`, body: 'Video call · tap to answer',
      url: `/invite/${p.id}`, tag: `invite-${p.id}`, requireInteraction: true, actions: callActions(p.id),
      from: publicUser(from), ttl: 30, timestamp: Date.now(),
    }).catch(() => {})));
  }
}

api.post('/invites', wrap(async (req, res) => {
  const { to_ids = [], kind = 'call', message = '' } = req.body || {};
  if (!['call', 'chill'].includes(kind)) return bad(res, 'Bad kind');
  const to = [];
  for (const u of new Set(to_ids)) if ((await areFriends(req.user.id, u)) && !(await chatsFeature.blockedBetween(req.user.id, u))) to.push(u);
  if (!to.length) return bad(res, to_ids.length ? "You can't call this person" : 'Pick a friend');
  const room = kind === 'call' ? id() : null;
  const created = await Promise.all(to.map(async (uid) => {
    const iid = id();
    const at = now();
    await run('INSERT INTO invites (id, from_id, to_id, kind, message, room_id, created_at) VALUES (?,?,?,?,?,?,?)',
      [iid, req.user.id, uid, kind, String(message).slice(0, 200), room, at]);
    const inv = { id: iid, kind, message, room_id: room, from: publicUser(req.user), created_at: at };
    await Promise.all([
      emitToUser(uid, 'invite', inv),
      notify([uid], {
        kind: `invite_${kind}`,
        title: kind === 'call' ? `${req.user.display_name} is calling` : `${req.user.display_name} wants to chill`,
        body: message || (kind === 'call' ? 'Video call · tap to answer' : 'You down? Tap to answer'),
        url: `/invite/${iid}`,
        tag: `invite-${iid}`,
        requireInteraction: kind === 'call',
        ttl: kind === 'call' ? 45 : undefined,
        data: { invite_id: iid, room_id: room, from: publicUser(req.user) },
        actions: kind === 'call' ? callActions(iid) : [
          { action: 'accept', title: "I'm down", url: `/invite/${iid}?act=accept` },
          { action: 'decline', title: 'Not now', url: `/invite/${iid}?act=decline` },
        ],
      }),
    ]);
    return inv;
  }));
  if (kind === 'call') background(keepRinging(created, req.user));
  res.json({ invites: created, room_id: room });
}));

// Call history: every video call you started or were invited to.
api.get('/calls', wrap(async (req, res) => {
  const rows = await q(`SELECT * FROM invites WHERE kind = 'call' AND (from_id = ? OR to_id = ?) ORDER BY created_at DESC LIMIT 120`, [req.user.id, req.user.id]);
  const users = await usersById(rows.flatMap((r) => [r.from_id, r.to_id]));
  const byRoom = new Map();
  for (const r of rows) {
    const outgoing = r.from_id === req.user.id;
    const key = outgoing ? r.room_id : r.id;
    const other = publicUser(users.get(outgoing ? r.to_id : r.from_id));
    if (!other) continue;
    if (!byRoom.has(key)) byRoom.set(key, { id: key, room_id: r.room_id, outgoing, people: [], statuses: [], created_at: r.created_at });
    const c = byRoom.get(key);
    c.people.push(other);
    c.statuses.push(r.status);
  }
  // accepted: someone picked up · declined: everyone said no · missed: nobody answered
  const calls = [...byRoom.values()].map(({ statuses, ...c }) => {
    const status = statuses.includes('accepted') ? 'accepted' : statuses.every((x) => x === 'declined') ? 'declined' : 'missed';
    return { ...c, status, missed: !c.outgoing && status === 'missed' };
  });
  res.json({ calls: calls.slice(0, 60) });
}));

api.get('/invites', wrap(async (req, res) => {
  // Only invites still ringing, so reopening the app never rings for a call that's over.
  const since = new Date(Date.now() - RING_MS).toISOString();
  const rows = await q(`SELECT * FROM invites WHERE to_id = ? AND status = 'pending' AND created_at > ? ORDER BY created_at DESC`, [req.user.id, since]);
  const users = await usersById(rows.map((r) => r.from_id));
  res.json({ invites: rows.map((r) => ({ ...r, from: publicUser(users.get(r.from_id)) })) });
}));

api.get('/invites/:id', wrap(async (req, res) => {
  const r = await one('SELECT * FROM invites WHERE id = ? AND (to_id = ? OR from_id = ?)', [req.params.id, req.user.id, req.user.id]);
  if (!r) return bad(res, 'Not found', 404);
  res.json({ invite: { ...r, from: publicUser(await getUser(r.from_id)) } });
}));

api.post('/invites/:id/respond', wrap(async (req, res) => {
  const r = await one('SELECT * FROM invites WHERE id = ? AND to_id = ?', [req.params.id, req.user.id]);
  if (!r) return bad(res, 'Not found', 404);
  const accept = !!req.body?.accept;
  if (r.status !== 'pending') {
    // Already answered or missed: rejoining is fine while the call is still going.
    const live = r.kind === 'call' && (await one('SELECT 1 AS x FROM call_peers WHERE room = ?', [r.room_id]));
    if (accept && r.kind === 'call' && r.status !== 'accepted' && !live) return bad(res, 'This call has ended', 410);
    return res.json({ ok: true, room_id: r.room_id });
  }
  await run('UPDATE invites SET status = ? WHERE id = ?', [accept ? 'accepted' : 'declined', r.id]);
  // Answered: its "is calling" alert is done with.
  await run('UPDATE notifications SET read = 1 WHERE user_id = ? AND url = ?', [req.user.id, `/invite/${r.id}`]);
  const what = r.kind === 'call' ? 'video call' : 'chill';
  await Promise.all([
    notify([r.from_id], {
      store: !(accept && r.kind === 'call'), // they're already in the call together
      kind: 'invite_response',
      title: accept ? `${req.user.display_name} accepted your ${what}` : `${req.user.display_name} can't right now`,
      body: accept ? (r.kind === 'call' ? 'Joining the call now' : "They're down. Sort out the details in chat.") : `Declined your ${what} invite`,
      url: r.kind === 'call' && accept ? `/call/${r.room_id}` : '/',
    }),
    emitToUser(r.from_id, 'invite:response', { invite_id: r.id, room_id: r.room_id, accept, by: publicUser(req.user) }),
  ]);
  res.json({ ok: true, room_id: r.room_id });
}));

// ---------- video call signalling (WebRTC mesh, max 6) ----------
// Each browser in a call is a "peer" with its own id. Offers, answers and ICE candidates are relayed
// through live events to the other peer's user; the peer list lives in the DB so any instance can answer.
const PEER_STALE_MS = 45000; // the call page pings every 15s
async function canJoinCall(uid, room) {
  return !!(
    (await one('SELECT 1 AS x FROM invites WHERE room_id = ? AND (from_id = ? OR to_id = ?)', [room, uid, uid])) ||
    (await one('SELECT 1 AS x FROM events e JOIN event_members m ON m.event_id = e.id WHERE e.call_room = ? AND m.user_id = ?', [room, uid]))
  );
}
const ownPeer = (req) => one('SELECT * FROM call_peers WHERE peer_id = ? AND room = ? AND user_id = ?', [req.body?.from || '', req.params.room, req.user.id]);
const otherPeers = (room, peerId) => q('SELECT * FROM call_peers WHERE room = ? AND peer_id != ?', [room, peerId]);

/** Stop ringing people who haven't answered this user's call: mark it missed and tell their phones. */
async function cancelRinging(user, room) {
  const rows = await q(`UPDATE invites SET status = 'missed' WHERE room_id = ? AND from_id = ? AND status = 'pending' RETURNING id, to_id`, [room, user.id]);
  // The "is calling" alerts become one "missed call" each.
  if (rows.length) await run('UPDATE notifications SET read = 1 WHERE url = ANY(?)', [rows.map((r) => `/invite/${r.id}`)]);
  await Promise.all(rows.map((r) => Promise.all([
    emitToUser(r.to_id, 'invite:cancel', { room_id: room, invite_id: r.id }),
    // Same tag as the ringing notification, so it replaces it on the lock screen.
    notify([r.to_id], { kind: 'missed_call', title: `Missed video call from ${user.display_name}`, body: 'Tap to call back', url: '/calls', tag: `invite-${r.id}` }),
  ])));
}

api.post('/calls/:room/join', wrap(async (req, res) => {
  const { room } = req.params;
  if (!(await canJoinCall(req.user.id, room))) return bad(res, 'Not allowed in this call', 403);
  await run('DELETE FROM call_peers WHERE room = ? AND seen_at < ?', [room, new Date(Date.now() - PEER_STALE_MS).toISOString()]);
  const existing = await q('SELECT * FROM call_peers WHERE room = ?', [room]);
  if (existing.length >= 6) return bad(res, 'Call is full (max 6)', 409);
  const invites = await q('SELECT * FROM invites WHERE room_id = ?', [room]);
  // Nobody here and nobody left to ring or rejoin: the call is over.
  if (!existing.length && invites.length && !invites.some((i) => i.status === 'pending' || i.status === 'accepted')) return bad(res, 'This call has ended', 410);
  const peerId = id();
  const joinedAt = now();
  await run('DELETE FROM call_signals WHERE created_at < ?', [new Date(Date.now() - 10 * 60000).toISOString()]);
  await run('INSERT INTO call_peers (peer_id, room, user_id, seen_at, joined_at) VALUES (?, ?, ?, ?, ?)', [peerId, room, req.user.id, joinedAt, joinedAt]);
  const users = await usersById(existing.map((p) => p.user_id));
  const user = publicUser(req.user);
  await emitToUsers(existing.map((p) => p.user_id), 'call:peer-joined', { room, peerId, user, joined_at: joinedAt });
  // The caller also gets who they're ringing, so their screen can show "declined" or "no answer".
  const mine = invites.filter((i) => i.from_id === req.user.id);
  const callees = await usersById(mine.map((i) => i.to_id));
  res.json({
    self: peerId,
    joined_at: joinedAt,
    peers: existing.map((p) => ({ peerId: p.peer_id, user: publicUser(users.get(p.user_id)), joined_at: p.joined_at || p.seen_at })),
    ringing: mine.map((i) => ({ invite_id: i.id, user: publicUser(callees.get(i.to_id)), status: i.status, created_at: i.created_at })),
    ring_ms: RING_MS,
  });
}));

api.post('/calls/:room/signal', wrap(async (req, res) => {
  const me = await ownPeer(req);
  const to = await one('SELECT * FROM call_peers WHERE peer_id = ? AND room = ?', [req.body?.to || '', req.params.room]);
  if (!me || !to) return bad(res, 'Not in this call', 404);
  // Kept in the DB as well as sent live: the other phone also collects it with /sync if the live event goes missing.
  const row = await one('INSERT INTO call_signals (room, to_peer, from_peer, data, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [req.params.room, to.peer_id, me.peer_id, JSON.stringify(req.body.data ?? null), now()]);
  await emitToUser(to.user_id, 'call:signal', { room: req.params.room, from: me.peer_id, to: to.peer_id, data: req.body.data, seq: row.id });
  res.json({ ok: true, seq: row.id });
}));

api.post('/calls/:room/media', wrap(async (req, res) => {
  const me = await ownPeer(req);
  if (!me) return bad(res, 'Not in this call', 404);
  const { mic, cam } = req.body || {};
  await emitToUsers((await otherPeers(req.params.room, me.peer_id)).map((p) => p.user_id), 'call:media', { room: req.params.room, peerId: me.peer_id, mic, cam });
  res.json({ ok: true });
}));

// Relay (TURN) details for this call. Fetched when a call starts.
api.get('/calls/ice', wrap(async (req, res) => {
  let relay = [];
  try { relay = await relayServers(); } catch (e) { console.warn('[turn]', e.message); }
  res.json({ iceServers: [...STUN, ...relay], relay: relay.length > 0, policy: E.CALL_FORCE_RELAY === 'true' ? 'relay' : 'all' });
}));

// Every second or two while connecting (every ten once connected): who's in the call, and any set-up
// messages for this phone that the live channel didn't deliver. Also keeps this phone marked as present.
api.get('/calls/:room/sync', wrap(async (req, res) => {
  const { room } = req.params;
  const peer = String(req.query.peer || '');
  const n = await run('UPDATE call_peers SET seen_at = ? WHERE peer_id = ? AND room = ? AND user_id = ?', [now(), peer, room, req.user.id]);
  if (!n) return res.json({ gone: true });
  await run('DELETE FROM call_peers WHERE room = ? AND seen_at < ?', [room, new Date(Date.now() - PEER_STALE_MS).toISOString()]);
  const [peers, signals] = await Promise.all([
    q('SELECT * FROM call_peers WHERE room = ? AND peer_id != ?', [room, peer]),
    q('SELECT id, from_peer, data FROM call_signals WHERE to_peer = ? AND id > ? ORDER BY id', [peer, Number(req.query.after) || 0]),
  ]);
  const users = await usersById(peers.map((p) => p.user_id));
  res.json({
    peers: peers.map((p) => ({ peerId: p.peer_id, user: publicUser(users.get(p.user_id)), joined_at: p.joined_at || p.seen_at })),
    signals: signals.map((x) => ({ seq: x.id, from: x.from_peer, data: JSON.parse(x.data) })),
  });
}));

api.post('/calls/:room/ping', wrap(async (req, res) => {
  const n = await run('UPDATE call_peers SET seen_at = ? WHERE peer_id = ? AND room = ? AND user_id = ?', [now(), req.body?.from || '', req.params.room, req.user.id]);
  res.json({ ok: !!n });
}));

api.post('/calls/:room/leave', wrap(async (req, res) => {
  const me = await ownPeer(req);
  if (me) await run('DELETE FROM call_peers WHERE peer_id = ?', [me.peer_id]);
  if (me) await run('DELETE FROM call_signals WHERE to_peer = ? OR from_peer = ?', [me.peer_id, me.peer_id]);
  const others = await q('SELECT * FROM call_peers WHERE room = ?', [req.params.room]);
  // Hanging up before anyone answered (or as the last one in) stops the ringing on their phones.
  if (!others.length) await cancelRinging(req.user, req.params.room);
  if (me) await emitToUsers(others.map((p) => p.user_id), 'call:peer-left', { room: req.params.room, peerId: me.peer_id });
  res.json({ ok: true });
}));

// ---------- notifications ----------
api.get('/notifications', wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [req.user.id])).map((n) => parseRow(n));
  res.json({ notifications: rows, unread: rows.filter((n) => !n.read).length });
}));
api.delete('/notifications', wrap(async (req, res) => {
  await run('DELETE FROM notifications WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
}));
api.post('/notifications/read-all', wrap(async (req, res) => {
  await run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
}));
// Seeing something marks its alerts read: the Calls tab clears missed calls, a plan page clears its invites.
api.post('/notifications/read', wrap(async (req, res) => {
  const kinds = Array.isArray(req.body?.kinds) ? req.body.kinds.map(String).slice(0, 20) : null;
  const url = typeof req.body?.url === 'string' ? req.body.url.slice(0, 200) : null;
  if (!kinds && !url) return bad(res, 'Say which alerts');
  const n = await run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0 AND (${kinds ? 'kind = ANY(?)' : 'FALSE'} OR ${url ? 'url = ?' : 'FALSE'})`,
    [req.user.id, ...(kinds ? [kinds] : []), ...(url ? [url] : [])]);
  res.json({ read: n });
}));
api.post('/notifications/:id/read', wrap(async (req, res) => {
  await run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

// ---------- AI: schedule straight onto the calendar ----------
// "gym with Sipho friday after work" -> plan with a time that works for everyone + a reminder.
api.post('/ai/schedule', wrap(async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) return bad(res, 'Tell Planner what to schedule');
  const hint = req.body?.date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? ` (the user has ${req.body.date} selected on their calendar)` : '';
  try {
    const out = await runAI(null, {
      mode: 'schedule', requesterId: req.user.id, instruction: text + hint,
      memberIdsOverride: [req.user.id, ...(await friendIds(req.user.id))],
    });
    res.json(out);
  } catch (e) {
    console.warn('[ai] schedule error', e.message);
    res.status(503).json({ error: `Planner is offline (${aiErrorText(e)})` });
  }
}));

// ---------- AI status ----------
api.get('/ai/status', wrap(async (req, res) => {
  try {
    if (aiMisconfigured) return res.json({ online: false, model: aiInfo.model, backup: aiInfo.fallback });
    const r = await fetch(`${aiInfo.base}/models`, { headers: aiHeaders, signal: AbortSignal.timeout(4000) });
    res.json({ online: r.ok || !!aiInfo.fallback, model: r.ok ? aiInfo.model : aiInfo.fallback || aiInfo.model, backup: aiInfo.fallback });
  } catch {
    res.json({ online: !!aiInfo.fallback, model: aiInfo.fallback || aiInfo.model, backup: aiInfo.fallback });
  }
}));

// ---------- the rest: account, chat tools, communities (server/src/features) ----------
/** A small grey note in a chat ("Ada added Ben"): live for everyone in it, but no notification. */
async function systemMessage(convId, body) {
  const mid = id();
  const ts = now();
  await run(`INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at) VALUES (?, ?, NULL, 'system', ?, ?)`, [mid, convId, body, ts]);
  await run('UPDATE conversations SET updated_at = ? WHERE id = ?', [ts, convId]);
  await emitToUsers(await memberIds(convId), 'message', { id: mid, conversation_id: convId, sender_id: null, kind: 'system', body, data: null, created_at: ts, sender: null, reactions: {} });
}
async function newDM(a, b) {
  const cid = id();
  await run('INSERT INTO conversations (id, name, is_group) VALUES (?, NULL, 0)', [cid]);
  for (const u of [a, b]) await run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [cid, u]);
  await emitToUsers([a, b], 'conversations:changed', {});
  return cid;
}
const helpers = { wrap, bad, postMessage, convSummary, systemMessage, findDM, newDM };
account.routes(api, helpers);
chatsFeature.routes(api, helpers);
communitiesFeature.routes(api, helpers);
nudgesFeature.routes(api, helpers);
calendarFeature.routes(api, helpers);
