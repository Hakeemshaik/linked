import { run, id } from './db.js';
import { emitToUser, visibleUserIds } from './realtime.js';
import { sendPush } from './push.js';

/**
 * Create a notification for each user: store it, deliver in-app live, and send a Web Push
 * with the full content when the app isn't open on screen.
 *
 * opts: { kind, title, body, url, data, actions: [{action,title,url}], tag, requireInteraction, alwaysPush, store, ttl }
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
      jobs.push(sendPush(uid, {
        id: n.id,
        title: n.title,
        body: n.body,
        url: n.url,
        kind: n.kind,
        tag: opts.tag || n.id,
        actions: (opts.actions || []).slice(0, 2),
        requireInteraction: !!opts.requireInteraction,
        from: opts.data?.from || null,
        ttl: opts.ttl,
        timestamp: Date.now(),
      }).catch((e) => console.warn('[push] error', e.message)));
    }
    await Promise.all(jobs);
    return n;
  }));
}
