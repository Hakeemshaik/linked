import { q, one, run, id, now, getUser, friendIds, publicUser, prefsOf } from './db.js';

// Live events reach clients one of two ways:
//  - Pusher Channels (PUSHER_* set; required on Vercel, where functions can't hold sockets)
//  - a Server-Sent Events stream from this process (npm start / Docker)
const P = process.env;
const pusherOn = !!(P.PUSHER_APP_ID && P.PUSHER_KEY && P.PUSHER_SECRET);
export const realtimeKind = pusherOn ? 'pusher' : P.VERCEL ? 'none' : 'sse';
const tls = P.PUSHER_TLS !== 'false';

/** What the browser needs to connect. */
export function realtimeClientConfig() {
  if (!pusherOn) return { driver: realtimeKind };
  return {
    driver: 'pusher', key: P.PUSHER_KEY, cluster: P.PUSHER_CLUSTER || 'eu',
    ...(P.PUSHER_HOST ? { wsHost: P.PUSHER_HOST, wsPort: Number(P.PUSHER_PORT) || undefined, forceTLS: tls } : {}),
  };
}

let pusherP = null;
const pusher = () => (pusherP ||= import('pusher').then(({ default: Pusher }) => new Pusher({
  appId: P.PUSHER_APP_ID, key: P.PUSHER_KEY, secret: P.PUSHER_SECRET, cluster: P.PUSHER_CLUSTER || 'eu', useTLS: tls,
  ...(P.PUSHER_HOST ? { host: P.PUSHER_HOST, port: P.PUSHER_PORT } : {}),
})));

export const userChannel = (uid) => `private-user-${uid}`;

export async function authorizeChannel(user, socketId, channel) {
  if (!pusherOn || channel !== userChannel(user.id)) return null;
  return (await pusher()).authorizeChannel(socketId, channel);
}

// ---- local SSE hub ----
const streams = new Map(); // userId -> Set(res)
export function addStream(uid, res) {
  if (!streams.has(uid)) streams.set(uid, new Set());
  streams.get(uid).add(res);
  return () => { streams.get(uid)?.delete(res); if (!streams.get(uid)?.size) streams.delete(uid); };
}

const PUSHER_MAX = Number(P.REALTIME_INLINE_MAX) || 9000; // Pusher's limit is 10KB per event; bigger payloads go through the DB.

export async function emitToUsers(userIds, event, payload) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  try {
    if (realtimeKind === 'sse') {
      const line = `data: ${JSON.stringify({ event, payload })}\n\n`;
      for (const uid of ids) for (const res of streams.get(uid) || []) res.write(line);
      return;
    }
    if (!pusherOn) return;
    let data = payload;
    const json = JSON.stringify(payload);
    if (json.length > PUSHER_MAX) {
      const rid = id();
      await run('DELETE FROM relay WHERE created_at < ?', [new Date(Date.now() - 3600000).toISOString()]);
      await run('INSERT INTO relay (id, user_ids, body, created_at) VALUES (?, ?, ?, ?)', [rid, JSON.stringify(ids), json, now()]);
      data = { _relay: rid };
    }
    const p = await pusher();
    for (let i = 0; i < ids.length; i += 100) await p.trigger(ids.slice(i, i + 100).map(userChannel), event, data);
  } catch (e) {
    console.warn('[realtime]', event, e.message);
  }
}

export const emitToUser = (uid, event, payload) => emitToUsers([uid], event, payload);

export async function readRelay(rid, uid) {
  const r = await one('SELECT * FROM relay WHERE id = ?', [rid]);
  if (!r || !JSON.parse(r.user_ids).includes(uid)) return null;
  return JSON.parse(r.body);
}

// ---- presence ----
// The app sends a heartbeat every 45s while it's on screen, and one more when it's hidden.
// Online = on screen in the last 70s. That also decides whether to send a push or let the in-app toast handle it.
const ONLINE_MS = 70000;
export const onScreen = (u) => !!(u?.visible && u.last_seen && Date.now() - Date.parse(u.last_seen) < ONLINE_MS);

// What friends see. "invisible" users look offline.
export function presenceOf(u) {
  const online = onScreen(u);
  const status = !online || u.status === 'invisible' ? 'offline' : u.status;
  // "Last seen and online: Nobody" hides both.
  if (prefsOf(u).last_seen === 'nobody') return { ...publicUser(u), status: 'offline', online: false, last_seen: null };
  return { ...publicUser(u), status, online: online && u.status !== 'invisible' };
}

export async function visibleUserIds(userIds) {
  if (!userIds.length) return new Set();
  const rows = await q('SELECT id, visible, last_seen FROM users WHERE id = ANY(?)', [userIds]);
  return new Set(rows.filter(onScreen).map((u) => u.id));
}

export async function heartbeat(user, visible) {
  const was = onScreen(user);
  await run('UPDATE users SET last_seen = ?, visible = ? WHERE id = ?', [now(), visible ? 1 : 0, user.id]);
  if (was !== !!visible) await broadcastPresence(user.id);
}

export async function broadcastPresence(userId) {
  const u = await getUser(userId);
  if (!u) return;
  await Promise.all([
    emitToUsers(await friendIds(userId), 'presence', presenceOf(u)),
    // The user sees their own real status (including invisible).
    emitToUser(userId, 'presence', { ...publicUser(u), online: onScreen(u), self: true }),
  ]);
}
