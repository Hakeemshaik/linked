import express from 'express';
import bcrypt from 'bcryptjs';
import {
  q, one, run, id, now, publicUser, getUser, getUsers, findUser, friendIds, areFriends, isMember, memberIds, parseRow, dbKind,
} from './db.js';
import { signToken, requireAuth, inviteCodeFor, verifyInvite, verifyToken, internalSecret } from './auth.js';
import {
  presenceOf, broadcastPresence, emitToUser, emitToUsers, heartbeat, realtimeKind, realtimeClientConfig,
  authorizeChannel, addStream, readRelay,
} from './realtime.js';
import { notify } from './notify.js';
import { vapid, saveSubscription, removeSubscription, sendPush } from './push.js';
import { runAI, normalizePlan, aiInfo, aiErrorText, aiHeaders, aiMisconfigured } from './ai.js';
import { formatWhen, zonedToDate, TZ } from './time.js';
import { remindAt, scheduleReminder, runReminders, queueUpcoming, maybeRunReminders, remindersKind, baseUrl } from './scheduler.js';
import { background } from './background.js';

export const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const COLORS = ['#7c5cff', '#ff5c8a', '#22c7a9', '#ffb020', '#3fa7ff', '#ff7a45', '#a3e635', '#e879f9'];
const STATUSES = ['available', 'busy', 'work', 'away', 'invisible'];
const TYPES = ['trip', 'hangout', 'meeting', 'call', 'event'];

// ---------- config ----------
api.get('/config', wrap(async (req, res) => {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    ice.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD });
  }
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
  try { await one('SELECT 1 AS x'); } catch (e) { database = `error: ${e.message}`; }
  res.json({
    ok: database === 'ok' && realtimeKind !== 'none',
    database: `${dbKind === 'postgres' ? 'postgres' : 'local (embedded)'}: ${database}`,
    realtime: { pusher: 'pusher', sse: 'local stream', none: 'missing: set the PUSHER_* variables' }[realtimeKind],
    reminders: { qstash: 'qstash + daily sweep', timer: 'local timer', 'cron-only': 'daily sweep only: set QSTASH_TOKEN for on-time reminders' }[remindersKind],
    planner: aiMisconfigured ? 'not set: add LLM_BASE_URL (your tunnel URL ending in /v1) and redeploy' : aiInfo.model,
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
  const color = COLORS[(await one('SELECT COUNT(*)::int AS c FROM users')).c % COLORS.length];
  try {
    await run('INSERT INTO users (id, username, display_name, password_hash, color) VALUES (?,?,?,?,?)', [
      uid, username, (display_name || username).trim().slice(0, 40), await bcrypt.hash(password, 10), color,
    ]);
  } catch (e) {
    if (e.code === '23505') return bad(res, 'Username taken'); // two sign-ups raced for the same name
    throw e;
  }
  await ensureAIConversation(uid);
  res.json({ token: await signToken(uid), user: publicUser(await getUser(uid)) });
}));

api.post('/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const u = await findUser(username);
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) return bad(res, 'Wrong username or password', 401);
  await ensureAIConversation(u.id);
  res.json({ token: await signToken(u.id), user: publicUser(u) });
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

api.use(wrap(requireAuth));

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

api.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

api.patch('/me', wrap(async (req, res) => {
  const { display_name, status, status_text } = req.body || {};
  if (status !== undefined && !STATUSES.includes(status)) return bad(res, 'Bad status');
  await run(
    `UPDATE users SET display_name = COALESCE(?, display_name), status = COALESCE(?, status), status_text = COALESCE(?, status_text) WHERE id = ?`,
    [display_name?.trim().slice(0, 40) || null, status ?? null, status_text !== undefined ? String(status_text).slice(0, 80) : null, req.user.id]
  );
  await broadcastPresence(req.user.id);
  res.json({ user: publicUser(await getUser(req.user.id)) });
}));

// ---------- live events ----------
// Heartbeat from the app while it's on screen (and once when it's hidden). Returns friends' presence.
api.post('/presence', wrap(async (req, res) => {
  await heartbeat(req.user, !!req.body?.visible);
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
    ? { id: e.id, user_id: e.member_id, title: e.title, type: e.type, start_at: e.start_at, end_at: e.end_at, rsvp: e.rsvp, visible: true }
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
    id(), cid, "I'm Planner. Tell me what you want to do and who with. I'll find a time you're all free, book it and set a reminder.", now(),
  ]);
  return cid;
}

/** Chat list rows: members with presence, last message, unread count and read receipts. Four queries for any number of chats. */
async function convSummaries(convs, uid) {
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);
  const [memberRows, lastRows, unreadRows] = await Promise.all([
    q('SELECT m.conversation_id, m.last_read_at, u.* FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ANY(?)', [ids]),
    q('SELECT DISTINCT ON (conversation_id) * FROM messages WHERE conversation_id = ANY(?) ORDER BY conversation_id, created_at DESC', [ids]),
    q(`SELECT m.conversation_id, COUNT(x.id)::int AS c FROM conversation_members m
       JOIN messages x ON x.conversation_id = m.conversation_id AND (x.sender_id IS NULL OR x.sender_id != m.user_id) AND x.created_at > COALESCE(m.last_read_at, '')
       WHERE m.user_id = ? AND m.conversation_id = ANY(?) GROUP BY m.conversation_id`, [uid, ids]),
  ]);
  const senders = await usersById(lastRows.map((m) => m.sender_id));
  const lasts = new Map(lastRows.map((m) => [m.conversation_id, messagePayload(parseRow(m), senders)]));
  const unread = new Map(unreadRows.map((r) => [r.conversation_id, r.c]));
  return convs.map((c) => {
    const rows = memberRows.filter((r) => r.conversation_id === c.id);
    const members = rows.map((u) => (u.id === uid ? { ...publicUser(u), me: true } : presenceOf(u)));
    const others = members.filter((m) => !m.me);
    const title = c.is_ai ? 'Planner' : c.name || others.map((m) => m.display_name).join(', ') || 'Just you';
    const reads = Object.fromEntries(rows.map((r) => [r.id, r.last_read_at]));
    return { ...c, title, members, reads, last_message: lasts.get(c.id) || null, unread: unread.get(c.id) || 0 };
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
  res.json({ conversations: await convSummaries(rows, req.user.id) });
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
  if (!(await isMember(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
  const before = req.query.before || '9999';
  const rows = (await q('SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 60', [req.params.id, before])).reverse();
  const users = await usersById(rows.map((m) => m.sender_id));
  res.json({ messages: rows.map((m) => messagePayload(parseRow(m), users)) });
}));

api.post('/conversations/:id/read', wrap(async (req, res) => {
  if (!(await isMember(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
  const at = now();
  await run('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?', [at, req.params.id, req.user.id]);
  await emitToUsers(await memberIds(req.params.id), 'read', { conversation_id: req.params.id, user_id: req.user.id, at });
  res.json({ ok: true });
}));

api.post('/conversations/:id/typing', wrap(async (req, res) => {
  const members = await memberIds(req.params.id);
  if (!members.includes(req.user.id)) return bad(res, 'Not found', 404);
  await emitToUsers(members.filter((m) => m !== req.user.id), 'typing', { conversation_id: req.params.id, user: publicUser(req.user) });
  res.json({ ok: true });
}));

async function postMessage(convId, sender, kind, body, data = null) {
  const mid = id();
  const ts = now();
  await run('INSERT INTO messages (id, conversation_id, sender_id, kind, body, data, created_at) VALUES (?,?,?,?,?,?,?)',
    [mid, convId, sender?.id || null, kind, body, data ? JSON.stringify(data) : null, ts]);
  await run('UPDATE conversations SET updated_at = ? WHERE id = ?', [ts, convId]);
  if (sender) await run('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?', [ts, convId, sender.id]);
  const msg = { id: mid, conversation_id: convId, sender_id: sender?.id || null, kind, body, data, created_at: ts, sender: sender ? publicUser(sender) : null };
  const [members, conv] = await Promise.all([memberIds(convId), one('SELECT * FROM conversations WHERE id = ?', [convId])]);

  const from = sender ? sender.display_name : 'Planner';
  let title = conv.is_group ? `${from} in ${conv.name || 'group chat'}` : from;
  let text = body;
  if (kind === 'plan' && data?.plan) {
    const p = data.plan;
    title = `Planner suggested: ${p.title}`;
    text = [p.start_at ? formatWhen(p.start_at, p.end_at) : 'date not set yet', p.location].filter(Boolean).join(' · ') + ' · Tap to confirm';
  }
  await Promise.all([
    emitToUsers(members, 'message', msg),
    notify(members.filter((u) => u !== sender?.id), {
      kind: 'message', title, body: text.slice(0, 240), url: `/chat/${convId}`, tag: `chat-${convId}`,
      data: { conversation_id: convId }, store: kind === 'plan',
    }),
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

async function aiRespond(convId, requesterId, mode, instruction) {
  if (!(await claimAI(convId))) return;
  const members = await memberIds(convId);
  await emitToUsers(members, 'ai:thinking', { conversation_id: convId, on: true });
  try {
    const conv = await one('SELECT is_ai FROM conversations WHERE id = ?', [convId]);
    // Your private Planner chat can see and invite all your friends.
    const opts = conv?.is_ai ? { memberIdsOverride: [requesterId, ...(await friendIds(requesterId))], personal: true } : {};
    const { reply, plan } = await runAI(convId, { mode, requesterId, instruction, ...opts });
    if (reply) await postMessage(convId, null, 'ai', reply);
    if (plan) await postMessage(convId, null, 'plan', plan.title, { plan, status: 'proposed', requested_by: requesterId });
    else if (mode === 'plan' && !reply) await postMessage(convId, null, 'ai', "I couldn't find a plan in the chat yet. Mention what, when and where and tap Plan it again.");
  } catch (e) {
    console.warn('[ai] error', e.message);
    await postMessage(convId, null, 'ai', `I'm offline right now (${aiErrorText(e)}). Try again in a bit.`);
  } finally {
    await run('UPDATE conversations SET ai_busy_until = NULL WHERE id = ?', [convId]);
    await emitToUsers(members, 'ai:thinking', { conversation_id: convId, on: false });
  }
}

api.post('/conversations/:id/messages', wrap(async (req, res) => {
  const convId = req.params.id;
  if (!(await isMember(convId, req.user.id))) return bad(res, 'Not found', 404);
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return bad(res, 'Empty message');
  const msg = await postMessage(convId, req.user, 'text', body);
  const conv = await one('SELECT is_ai FROM conversations WHERE id = ?', [convId]);
  if (conv.is_ai || /(^|\s)@ai\b/i.test(body)) background(aiRespond(convId, req.user.id, 'reply', body.replace(/@ai\b/gi, '').trim()));
  res.json({ message: msg });
}));

api.post('/conversations/:id/plan', wrap(async (req, res) => {
  if (!(await isMember(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
  if (await aiBusy(req.params.id)) return bad(res, 'Planner is already working on it', 409);
  background(aiRespond(req.params.id, req.user.id, 'plan'));
  res.json({ started: true });
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

api.post('/invites', wrap(async (req, res) => {
  const { to_ids = [], kind = 'call', message = '' } = req.body || {};
  if (!['call', 'chill'].includes(kind)) return bad(res, 'Bad kind');
  const to = [];
  for (const u of new Set(to_ids)) if (await areFriends(req.user.id, u)) to.push(u);
  if (!to.length) return bad(res, 'Pick a friend');
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
        title: kind === 'call' ? `${req.user.display_name} wants to video call` : `${req.user.display_name} wants to chill`,
        body: message || (kind === 'call' ? 'Tap to join the call' : 'You down? Tap to answer'),
        url: `/invite/${iid}`,
        tag: `invite-${iid}`,
        requireInteraction: kind === 'call',
        data: { invite_id: iid, room_id: room },
        actions: [
          { action: 'accept', title: kind === 'call' ? 'Join' : "I'm down", url: `/invite/${iid}?act=accept` },
          { action: 'decline', title: 'Not now', url: `/invite/${iid}?act=decline` },
        ],
      }),
    ]);
    return inv;
  }));
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
  const what = r.kind === 'call' ? 'video call' : 'chill';
  await Promise.all([
    notify([r.from_id], {
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
  await run('INSERT INTO call_peers (peer_id, room, user_id, seen_at) VALUES (?, ?, ?, ?)', [peerId, room, req.user.id, now()]);
  const users = await usersById(existing.map((p) => p.user_id));
  const user = publicUser(req.user);
  await emitToUsers(existing.map((p) => p.user_id), 'call:peer-joined', { room, peerId, user });
  // The caller also gets who they're ringing, so their screen can show "declined" or "no answer".
  const mine = invites.filter((i) => i.from_id === req.user.id);
  const callees = await usersById(mine.map((i) => i.to_id));
  res.json({
    self: peerId,
    peers: existing.map((p) => ({ peerId: p.peer_id, user: publicUser(users.get(p.user_id)) })),
    ringing: mine.map((i) => ({ invite_id: i.id, user: publicUser(callees.get(i.to_id)), status: i.status, created_at: i.created_at })),
    ring_ms: RING_MS,
  });
}));

api.post('/calls/:room/signal', wrap(async (req, res) => {
  const me = await ownPeer(req);
  const to = await one('SELECT * FROM call_peers WHERE peer_id = ? AND room = ?', [req.body?.to || '', req.params.room]);
  if (!me || !to) return bad(res, 'Not in this call', 404);
  await emitToUser(to.user_id, 'call:signal', { room: req.params.room, from: me.peer_id, to: to.peer_id, data: req.body.data });
  res.json({ ok: true });
}));

api.post('/calls/:room/media', wrap(async (req, res) => {
  const me = await ownPeer(req);
  if (!me) return bad(res, 'Not in this call', 404);
  const { mic, cam } = req.body || {};
  await emitToUsers((await otherPeers(req.params.room, me.peer_id)).map((p) => p.user_id), 'call:media', { room: req.params.room, peerId: me.peer_id, mic, cam });
  res.json({ ok: true });
}));

api.post('/calls/:room/ping', wrap(async (req, res) => {
  const n = await run('UPDATE call_peers SET seen_at = ? WHERE peer_id = ? AND room = ? AND user_id = ?', [now(), req.body?.from || '', req.params.room, req.user.id]);
  res.json({ ok: !!n });
}));

api.post('/calls/:room/leave', wrap(async (req, res) => {
  const me = await ownPeer(req);
  if (me) await run('DELETE FROM call_peers WHERE peer_id = ?', [me.peer_id]);
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
api.post('/notifications/read-all', wrap(async (req, res) => {
  await run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
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
    if (aiMisconfigured) return res.json({ online: false, model: aiInfo.model });
    const r = await fetch(`${aiInfo.base}/models`, { headers: aiHeaders, signal: AbortSignal.timeout(4000) });
    res.json({ online: r.ok, model: aiInfo.model });
  } catch {
    res.json({ online: false, model: aiInfo.model });
  }
}));
