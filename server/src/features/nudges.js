// Nudges: a phone can't be sent a notification until notifications are on there, so friends can ask.
// A nudge is a card in your chat with them, and their app asks them the moment it next opens.
import { q, one, run, now, publicUser, getUsers, areFriends, friendIds } from '../db.js';

const AGAIN_MS = 12 * 3600e3; // one nudge per friend every 12 hours

export function routes(api, { wrap, bad, postMessage, findDM, newDM }) {
  const withPush = async (ids) => new Set(ids.length ? (await q('SELECT DISTINCT user_id FROM push_subscriptions WHERE user_id = ANY(?)', [ids])).map((r) => r.user_id) : []);

  async function nudge(from, toId) {
    if (!(await areFriends(from.id, toId))) return { error: 'Only friends can nudge each other', status: 403 };
    if ((await withPush([toId])).has(toId)) return { error: 'They already get notifications' };
    const last = await one('SELECT created_at FROM nudges WHERE from_id = ? AND to_id = ?', [from.id, toId]);
    if (last && Date.now() - Date.parse(last.created_at) < AGAIN_MS) return { error: 'You nudged them recently' };
    const t = now();
    await run('INSERT INTO nudges (from_id, to_id, created_at) VALUES (?, ?, ?) ON CONFLICT (from_id, to_id) DO UPDATE SET created_at = EXCLUDED.created_at', [from.id, toId, t]);
    await run('UPDATE users SET nudged_at = ?, nudged_by = ? WHERE id = ?', [t, from.display_name, toId]);
    const dm = (await findDM(from.id, toId)) || (await newDM(from.id, toId));
    await postMessage(dm, from, 'nudge', "Turn on notifications so you don't miss my calls and messages", { to: toId });
    return { ok: true, conversation_id: dm };
  }

  // Your friends, and whether each one gets notifications.
  api.get('/nudges', wrap(async (req, res) => {
    const friends = await getUsers(await friendIds(req.user.id));
    const on = await withPush(friends.map((f) => f.id));
    const sent = new Map((await q('SELECT to_id, created_at FROM nudges WHERE from_id = ?', [req.user.id])).map((r) => [r.to_id, r.created_at]));
    res.json({
      friends: friends.map((f) => ({ ...publicUser(f), notifications: on.has(f.id), nudged_at: sent.get(f.id) || null }))
        .sort((a, b) => a.notifications - b.notifications || a.display_name.localeCompare(b.display_name)),
    });
  }));

  // Seen it (or turned notifications on): the prompt stops asking.
  api.post('/nudges/seen', wrap(async (req, res) => {
    await run('UPDATE users SET nudged_at = NULL, nudged_by = NULL WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  }));

  api.post('/nudges/:uid', wrap(async (req, res) => {
    const r = await nudge(req.user, req.params.uid);
    if (r.error) return bad(res, r.error, r.status || 400);
    res.json(r);
  }));

  // Nudge every friend who has notifications off.
  api.post('/nudges', wrap(async (req, res) => {
    const ids = await friendIds(req.user.id);
    const on = await withPush(ids);
    let sent = 0, skipped = 0;
    for (const uid of ids.filter((x) => !on.has(x))) (await nudge(req.user, uid)).ok ? sent++ : skipped++;
    res.json({ sent, skipped });
  }));

}
