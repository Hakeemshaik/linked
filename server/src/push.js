import webpush from 'web-push';
import { q, run, kvGetOrCreate } from './db.js';

// VAPID keys: from env, or generated once and kept in the database.
// Don't change them afterwards or everyone has to re-enable notifications.
let vapidP = null;
export function vapid() {
  vapidP ||= (async () => {
    const keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
      : JSON.parse(await kvGetOrCreate('vapid', () => JSON.stringify(webpush.generateVAPIDKeys())));
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', keys.publicKey, keys.privateKey);
    return keys;
  })();
  vapidP.catch(() => { vapidP = null; });
  return vapidP;
}

export function saveSubscription(userId, sub) {
  return run(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth]
  );
}

export function removeSubscription(endpoint) {
  return run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

export async function sendPush(userId, payload) {
  const subs = await q('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
  if (!subs.length) return { sent: 0, total: 0 };
  await vapid();
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: payload.ttl ?? 60 * 60 * 24, urgency: payload.urgency || 'high' }
      )
    )
  );
  await Promise.all(results.map((r, i) => {
    if (r.status !== 'rejected') return null;
    const code = r.reason?.statusCode;
    if (code === 404 || code === 410) return removeSubscription(subs[i].endpoint);
    console.warn('[push] failed', code, r.reason?.body || r.reason?.message);
    return null;
  }));
  return { sent: results.filter((r) => r.status === 'fulfilled').length, total: subs.length };
}
