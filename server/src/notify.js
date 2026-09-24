import { run, id, one, now } from './db.js';

/** The number on the app icon: unread messages in chats you haven't muted, plus unread alerts. */
export async function badgeFor(uid) {
  const r = await one(`SELECT
      (SELECT COUNT(*)::int FROM notifications WHERE user_id = ? AND read = 0) +
      (SELECT COUNT(*)::int FROM conversation_members m JOIN messages x ON x.conversation_id = m.conversation_id
         AND (x.sender_id IS NULL OR x.sender_id != m.user_id) AND x.kind != 'system' AND x.created_at > COALESCE(m.last_read_at, '')
       WHERE m.user_id = ? AND (m.muted_until IS NULL OR m.muted_until < ?)) AS n`, [uid, uid, now()]);
  return r?.n || 0;
}
import { emitToUser, visibleUserIds } from './realtime.js';
import { sendPush } from './push.js';

/**
 * Create a notification for each user: store it, deliver in-app live, and send a Web Push
 * with the full content when the app isn't open on screen.
 *
 * opts: { kind, title, body, url, data, actions: [{action,title,url}], tag, requireInteraction, alwaysPush, store, ttl, image }
 * ttl: seconds a push may wait for an offline phone (calls use 45, so nobody rings late for an old call).
 */
export async function notify(userIds, opts) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return [];
  const onScreen = opts.alwaysPush ? new Set() : await visibleUserIds(ids);
  return Promise.all(ids.map(async (uid) => {
    const n = {
      id: id(),
      user_id: uid,
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
      url: opts.url || '/',
      data: { ...(opts.data || {}), actions: opts.actions || [] },
      read: 0,
      created_at: new Date().toISOString(),
    };
    if (opts.store !== false) {
      await run(
        'INSERT INTO notifications (id, user_id, kind, title, body, url, data, read, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [n.id, uid, n.kind, n.title, n.body, n.url, JSON.stringify(n.data), 0, n.created_at]
      );
    }
    const jobs = [emitToUser(uid, 'notification', n)];
    // If the app is on screen, the in-app toast/ring handles it. Otherwise send a real push with the actual content.
    if (!onScreen.has(uid)) {
      jobs.push(badgeFor(uid).catch(() => null).then((badge) => sendPush(uid, {
        id: n.id,
        title: n.title,
        body: n.body,
        url: n.url,
        kind: n.kind,
        tag: opts.tag || n.id,
        actions: (opts.actions || []).slice(0, 2),
        requireInteraction: !!opts.requireInteraction,
        from: opts.data?.from || null,
        icon: opts.data?.from?.avatar ? `/art/avatars/${opts.data.from.avatar}.png` : undefined,
        image: opts.image, // a sent photo: Android shows it in the notification
        ttl: opts.ttl,
        timestamp: Date.now(),
        badge,
      })).catch((e) => console.warn('[push] error', e.message)));
    }
    await Promise.all(jobs);
    return n;
  }));
}
