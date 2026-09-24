// Your own settings for each chat (mute, archive, pin, favourite, theme, mark unread), clearing and deleting chats,
// blocking, starred messages, editing, search, a chat's media/links/documents, group info and members, lists, broadcasts.
import { q, one, run, id, now, publicUser, getUsers, memberIds, isMember, areFriends, parseRow } from '../db.js';
import { emitToUsers } from '../realtime.js';

const EDIT_MS = 15 * 60000; // messages can be edited for 15 minutes, like other messengers
const THEMES = ['default', 'violet', 'ocean', 'mint', 'sunset', 'rose', 'night', 'sand'];
const MUTE = { '8h': 8 * 3600e3, '1w': 7 * 86400e3 };
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
const bool = (v) => (v ? 1 : 0);

/** Is either person blocking the other? */
export async function blockedBetween(a, b) {
  return !!(await one('SELECT 1 AS x FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)', [a, b, b, a]));
}
export const blockedIds = async (uid) => (await q('SELECT blocked_id FROM blocks WHERE user_id = ?', [uid])).map((r) => r.blocked_id);

export function routes(api, h) {
  const { wrap, bad, postMessage, convSummary, systemMessage, findDM, newDM } = h;
  const member = async (req, res) => {
    const m = await one('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!m) bad(res, 'Not found', 404);
    return m;
  };
  const changed = (uids) => emitToUsers(uids, 'conversations:changed', {});

  // ---------- your settings for one chat ----------
  api.patch('/conversations/:id/me', wrap(async (req, res) => {
    if (!(await member(req, res))) return;
    const b = req.body || {};
    const set = [];
    const vals = [];
    const add = (col, v) => { set.push(`${col} = ?`); vals.push(v); };
    if ('muted' in b) add('muted_until', b.muted === 'always' ? '9999-12-31T00:00:00.000Z' : MUTE[b.muted] ? new Date(Date.now() + MUTE[b.muted]).toISOString() : null);
    if ('archived' in b) add('archived', bool(b.archived));
    if ('pinned' in b) {
      if (b.pinned) {
        const pins = await one('SELECT COUNT(*)::int AS n FROM conversation_members WHERE user_id = ? AND pinned_at IS NOT NULL AND conversation_id != ?', [req.user.id, req.params.id]);
        if (pins.n >= 3) return bad(res, 'You can pin up to 3 chats');
      }
      add('pinned_at', b.pinned ? now() : null);
    }
    if ('favorite' in b) add('favorite', bool(b.favorite));
    if ('marked_unread' in b) add('marked_unread', bool(b.marked_unread));
    if ('theme' in b) add('theme', THEMES.includes(b.theme) && b.theme !== 'default' ? b.theme : null);
    if (!set.length) return bad(res, 'Nothing to change');
    await run(`UPDATE conversation_members SET ${set.join(', ')} WHERE conversation_id = ? AND user_id = ?`, [...vals, req.params.id, req.user.id]);
    await changed([req.user.id]);
    res.json({ conversation: await convSummary(req.params.id, req.user.id) });
  }));

  // Clear chat: the messages go from your phone only. Delete chat: also off your list until someone writes again.
  api.post('/conversations/:id/clear', wrap(async (req, res) => {
    if (!(await member(req, res))) return;
    const t = now();
    await run('UPDATE conversation_members SET cleared_at = ?, last_read_at = ?, marked_unread = 0 WHERE conversation_id = ? AND user_id = ?', [t, t, req.params.id, req.user.id]);
    await changed([req.user.id]);
    res.json({ ok: true });
  }));
  api.post('/conversations/:id/hide', wrap(async (req, res) => {
    const m = await member(req, res);
    if (!m) return;
    const conv = await one('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (conv.is_group) return bad(res, 'Exit the group first');
    const t = now();
    await run('UPDATE conversation_members SET cleared_at = ?, last_read_at = ?, hidden = 1, pinned_at = NULL, marked_unread = 0 WHERE conversation_id = ? AND user_id = ?', [t, t, req.params.id, req.user.id]);
    await changed([req.user.id]);
    res.json({ ok: true });
  }));
  api.post('/conversations/archive-all', wrap(async (req, res) => {
    await run(`UPDATE conversation_members SET archived = 1 WHERE user_id = ? AND conversation_id NOT IN (SELECT id FROM conversations WHERE is_ai = 1)`, [req.user.id]);
    await changed([req.user.id]);
    res.json({ ok: true });
  }));
  api.post('/conversations/clear-all', wrap(async (req, res) => {
    const t = now();
    await run('UPDATE conversation_members SET cleared_at = ?, last_read_at = ?, marked_unread = 0 WHERE user_id = ?', [t, t, req.user.id]);
    await changed([req.user.id]);
    res.json({ ok: true });
  }));

  // ---------- groups: edit, members, leave ----------
  api.patch('/conversations/:id', wrap(async (req, res) => {
    if (!(await member(req, res))) return;
    const conv = await one('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (!conv.is_group) return bad(res, 'Only groups can be renamed');
    const { name, description, avatar } = req.body || {};
    const n = name !== undefined ? String(name).trim().slice(0, 60) : null;
    if (name !== undefined && !n) return bad(res, 'The group needs a name');
    if (avatar !== undefined && avatar !== '' && !/^[a-z]{2,20}$/.test(avatar)) return bad(res, 'Bad picture');
    await run(`UPDATE conversations SET name = COALESCE(?, name), description = COALESCE(?, description),
      avatar = CASE WHEN ? THEN NULLIF(?, '') ELSE avatar END WHERE id = ?`,
    [n, description !== undefined ? String(description).slice(0, 300) : null, avatar !== undefined, avatar ?? '', conv.id]);
    if (n && n !== conv.name) await systemMessage(conv.id, `${req.user.display_name} renamed the group to "${n}"`);
    await changed(await memberIds(conv.id));
    res.json({ conversation: await convSummary(conv.id, req.user.id) });
  }));
  api.post('/conversations/:id/members', wrap(async (req, res) => {
    if (!(await member(req, res))) return;
    const conv = await one('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    if (!conv.is_group || conv.is_ai) return bad(res, 'Only groups have members to add');
    const current = await memberIds(conv.id);
    const added = [];
    for (const uid of new Set(req.body?.member_ids || [])) {
      if (current.includes(uid) || !(await areFriends(req.user.id, uid))) continue;
      await run('INSERT INTO conversation_members (conversation_id, user_id, last_read_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [conv.id, uid, now()]);
      added.push(uid);
    }
    if (!added.length) return bad(res, 'Pick friends who aren\'t in the group yet');
    const names = (await getUsers(added)).map((u) => u.display_name.split(' ')[0]).join(', ');
    await systemMessage(conv.id, `${req.user.display_name} added ${names}`);
    await changed([...current, ...added]);
    res.json({ conversation: await convSummary(conv.id, req.user.id) });
  }));
  api.delete('/conversations/:id/members/:uid', wrap(async (req, res) => {
    const me = await member(req, res);
    if (!me) return;
    const conv = await one('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
    const self = req.params.uid === 'me' || req.params.uid === req.user.id;
    if (!conv.is_group) return bad(res, 'Only groups can be left');
    if (!self && conv.created_by !== req.user.id && me.role !== 'admin') return bad(res, 'Only the group admin can remove people', 403);
    const uid = self ? req.user.id : req.params.uid;
    const u = (await getUsers([uid]))[0];
    const before = await memberIds(conv.id);
    await run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conv.id, uid]);
    await systemMessage(conv.id, self ? `${req.user.display_name} left` : `${req.user.display_name} removed ${u?.display_name || 'someone'}`);
    await changed(before);
    res.json({ ok: true });
  }));

  // ---------- chat info: media, links, documents, starred, groups in common ----------
  api.get('/conversations/:id/info', wrap(async (req, res) => {
    const m = await member(req, res);
    if (!m) return;
    const cid = req.params.id;
    const after = m.cleared_at || '';
    const [media, counts, links, stars] = await Promise.all([
      q(`SELECT * FROM messages WHERE conversation_id = ? AND kind = 'image' AND created_at > ? ORDER BY created_at DESC LIMIT 12`, [cid, after]),
      q(`SELECT kind, COUNT(*)::int AS n FROM messages WHERE conversation_id = ? AND kind IN ('image', 'voice', 'file') AND created_at > ? GROUP BY kind`, [cid, after]),
      one(`SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = ? AND kind IN ('text', 'ai') AND (body ILIKE '%http://%' OR body ILIKE '%https://%') AND created_at > ?`, [cid, after]),
      one(`SELECT COUNT(*)::int AS n FROM stars s JOIN messages x ON x.id = s.message_id WHERE s.user_id = ? AND x.conversation_id = ?`, [req.user.id, cid]),
    ]);
    const conv = await convSummary(cid, req.user.id);
    let common = [];
    const other = !conv.is_group && !conv.is_ai && conv.members.find((u) => !u.me);
    if (other) {
      common = await q(`SELECT c.id, CASE WHEN c.kind = 'announcements' THEN COALESCE(k.name, c.name) ELSE c.name END AS name, c.avatar, c.kind FROM conversations c
        LEFT JOIN communities k ON k.id = c.community_id
        JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
        JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
        WHERE c.is_group = 1 ORDER BY c.updated_at DESC`, [req.user.id, other.id]);
    }
    const n = Object.fromEntries(counts.map((r) => [r.kind, r.n]));
    res.json({
      conversation: conv,
      media: media.map((x) => parseRow(x)),
      counts: { media: n.image || 0, voice: n.voice || 0, docs: n.file || 0, links: links.n, starred: stars.n },
      groups_in_common: common,
      blocked: other ? !!(await one('SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?', [req.user.id, other.id])) : false,
    });
  }));
  api.get('/conversations/:id/media', wrap(async (req, res) => {
    const m = await member(req, res);
    if (!m) return;
    const kind = ['media', 'links', 'docs', 'voice'].includes(req.query.kind) ? req.query.kind : 'media';
    const where = { media: `kind = 'image'`, docs: `kind = 'file'`, voice: `kind = 'voice'`, links: `kind IN ('text', 'ai') AND (body ILIKE '%http://%' OR body ILIKE '%https://%')` }[kind];
    const rows = (await q(`SELECT * FROM messages WHERE conversation_id = ? AND ${where} AND created_at > ? ORDER BY created_at DESC LIMIT 200`,
      [req.params.id, m.cleared_at || ''])).map((x) => parseRow(x));
    const users = new Map((await getUsers(rows.map((r) => r.sender_id).filter(Boolean))).map((u) => [u.id, publicUser(u)]));
    res.json({ items: rows.map((r) => ({ ...r, sender: users.get(r.sender_id) || null, links: kind === 'links' ? [...new Set(r.body.match(URL_RE) || [])] : undefined })) });
  }));

  // ---------- search in a chat ----------
  api.get('/conversations/:id/search', wrap(async (req, res) => {
    const m = await member(req, res);
    if (!m) return;
    const term = String(req.query.q || '').trim().slice(0, 80);
    if (term.length < 2) return res.json({ results: [] });
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await q(`SELECT * FROM messages WHERE conversation_id = ? AND kind IN ('text', 'ai', 'image', 'file') AND body ILIKE ? AND created_at > ?
      ORDER BY created_at DESC LIMIT 50`, [req.params.id, like, m.cleared_at || '']);
    const users = new Map((await getUsers(rows.map((r) => r.sender_id).filter(Boolean))).map((u) => [u.id, publicUser(u)]));
    res.json({ results: rows.map((r) => ({ ...parseRow(r), sender: users.get(r.sender_id) || null })) });
  }));

  // ---------- starred messages ----------
  api.post('/messages/:id/star', wrap(async (req, res) => {
    const msg = await one('SELECT id, conversation_id FROM messages WHERE id = ?', [req.params.id]);
    if (!msg || !(await isMember(msg.conversation_id, req.user.id))) return bad(res, 'Not found', 404);
    const removed = await run('DELETE FROM stars WHERE user_id = ? AND message_id = ?', [req.user.id, msg.id]);
    if (!removed) await run('INSERT INTO stars (user_id, message_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [req.user.id, msg.id, now()]);
    res.json({ starred: !removed });
  }));
  api.get('/starred', wrap(async (req, res) => {
    const cid = req.query.conversation_id ? String(req.query.conversation_id) : null;
    const rows = await q(`SELECT x.*, s.created_at AS starred_at, c.name AS conv_name, c.is_group, c.is_ai FROM stars s
      JOIN messages x ON x.id = s.message_id JOIN conversations c ON c.id = x.conversation_id
      JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = s.user_id
      WHERE s.user_id = ? ${cid ? 'AND c.id = ?' : ''} ORDER BY s.created_at DESC LIMIT 200`, cid ? [req.user.id, cid] : [req.user.id]);
    const users = new Map((await getUsers(rows.map((r) => r.sender_id).filter(Boolean))).map((u) => [u.id, publicUser(u)]));
    res.json({ starred: rows.map((r) => ({ ...parseRow(r), sender: users.get(r.sender_id) || null })) });
  }));

  // ---------- edit a message ----------
  api.patch('/messages/:id', wrap(async (req, res) => {
    const m = parseRow(await one('SELECT * FROM messages WHERE id = ?', [req.params.id]));
    if (!m || m.sender_id !== req.user.id) return bad(res, 'You can only edit your own messages', 403);
    if (m.kind !== 'text' && m.kind !== 'image') return bad(res, "This message can't be edited");
    if (Date.now() - Date.parse(m.created_at) > EDIT_MS) return bad(res, 'Messages can be edited for 15 minutes after sending');
    const body = String(req.body?.body || '').trim().slice(0, 4000);
    if (!body && m.kind === 'text') return bad(res, 'Empty message');
    const t = now();
    await run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', [body, t, m.id]);
    const updated = { ...m, body, edited_at: t, sender: publicUser(req.user) };
    await emitToUsers(await memberIds(m.conversation_id), 'message:update', updated);
    res.json({ message: updated });
  }));

  // ---------- blocking ----------
  api.get('/blocks', wrap(async (req, res) => {
    const rows = await q('SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC', [req.user.id]);
    res.json({ blocked: rows.map(publicUser) });
  }));
  api.post('/blocks/:uid', wrap(async (req, res) => {
    if (req.params.uid === req.user.id) return bad(res, "You can't block yourself");
    await run('INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [req.user.id, req.params.uid, now()]);
    await emitToUsers([req.user.id], 'friends:changed', {});
    res.json({ ok: true });
  }));
  api.delete('/blocks/:uid', wrap(async (req, res) => {
    await run('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?', [req.user.id, req.params.uid]);
    await emitToUsers([req.user.id], 'friends:changed', {});
    res.json({ ok: true });
  }));

  // ---------- lists: your own groupings of chats, shown as filters ----------
  const listOut = (l) => ({ ...l, conversation_ids: JSON.parse(l.conversation_ids || '[]') });
  api.get('/lists', wrap(async (req, res) => {
    res.json({ lists: (await q('SELECT * FROM chat_lists WHERE user_id = ? ORDER BY created_at', [req.user.id])).map(listOut) });
  }));
  const cleanIds = async (uid, ids) => {
    const mine = new Set((await q('SELECT conversation_id FROM conversation_members WHERE user_id = ?', [uid])).map((r) => r.conversation_id));
    return [...new Set(Array.isArray(ids) ? ids : [])].filter((x) => mine.has(x)).slice(0, 200);
  };
  api.post('/lists', wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 30);
    if (!name) return bad(res, 'Give the list a name');
    const lid = id();
    await run('INSERT INTO chat_lists (id, user_id, name, conversation_ids, created_at) VALUES (?, ?, ?, ?, ?)',
      [lid, req.user.id, name, JSON.stringify(await cleanIds(req.user.id, req.body?.conversation_ids)), now()]);
    res.json({ list: listOut(await one('SELECT * FROM chat_lists WHERE id = ?', [lid])) });
  }));
  api.patch('/lists/:id', wrap(async (req, res) => {
    const l = await one('SELECT * FROM chat_lists WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!l) return bad(res, 'Not found', 404);
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 30) : l.name;
    const ids = req.body?.conversation_ids !== undefined ? JSON.stringify(await cleanIds(req.user.id, req.body.conversation_ids)) : l.conversation_ids;
    await run('UPDATE chat_lists SET name = ?, conversation_ids = ? WHERE id = ?', [name || l.name, ids, l.id]);
    res.json({ list: listOut(await one('SELECT * FROM chat_lists WHERE id = ?', [l.id])) });
  }));
  api.delete('/lists/:id', wrap(async (req, res) => {
    await run('DELETE FROM chat_lists WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  // ---------- broadcasts: one message, sent to each person separately ----------
  const bcOut = async (b) => {
    const ids = JSON.parse(b.member_ids || '[]');
    return { ...b, member_ids: ids, members: (await getUsers(ids)).map(publicUser) };
  };
  api.get('/broadcasts', wrap(async (req, res) => {
    const rows = await q('SELECT * FROM broadcasts WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json({ broadcasts: await Promise.all(rows.map(bcOut)) });
  }));
  const friendsOnly = async (uid, ids) => {
    const out = [];
    for (const x of new Set(Array.isArray(ids) ? ids : [])) if (await areFriends(uid, x)) out.push(x);
    return out.slice(0, 256);
  };
  api.post('/broadcasts', wrap(async (req, res) => {
    const ids = await friendsOnly(req.user.id, req.body?.member_ids);
    if (ids.length < 1) return bad(res, 'Pick at least one friend');
    const name = String(req.body?.name || '').trim().slice(0, 40) || `${ids.length} recipient${ids.length > 1 ? 's' : ''}`;
    const bid = id();
    await run('INSERT INTO broadcasts (id, user_id, name, member_ids, created_at) VALUES (?, ?, ?, ?, ?)', [bid, req.user.id, name, JSON.stringify(ids), now()]);
    res.json({ broadcast: await bcOut(await one('SELECT * FROM broadcasts WHERE id = ?', [bid])) });
  }));
  api.patch('/broadcasts/:id', wrap(async (req, res) => {
    const b = await one('SELECT * FROM broadcasts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!b) return bad(res, 'Not found', 404);
    const ids = req.body?.member_ids !== undefined ? JSON.stringify(await friendsOnly(req.user.id, req.body.member_ids)) : b.member_ids;
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 40) || b.name : b.name;
    await run('UPDATE broadcasts SET name = ?, member_ids = ? WHERE id = ?', [name, ids, b.id]);
    res.json({ broadcast: await bcOut(await one('SELECT * FROM broadcasts WHERE id = ?', [b.id])) });
  }));
  api.delete('/broadcasts/:id', wrap(async (req, res) => {
    await run('DELETE FROM broadcasts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));
  api.get('/broadcasts/:id', wrap(async (req, res) => {
    const b = await one('SELECT * FROM broadcasts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!b) return bad(res, 'Not found', 404);
    const sends = await q('SELECT * FROM broadcast_sends WHERE broadcast_id = ? ORDER BY created_at DESC LIMIT 100', [b.id]);
    res.json({ broadcast: await bcOut(b), sends });
  }));
  api.post('/broadcasts/:id/send', wrap(async (req, res) => {
    const b = await one('SELECT * FROM broadcasts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!b) return bad(res, 'Not found', 404);
    const body = String(req.body?.body || '').trim().slice(0, 4000);
    if (!body) return bad(res, 'Empty message');
    let sent = 0;
    for (const uid of JSON.parse(b.member_ids || '[]')) {
      if (!(await areFriends(req.user.id, uid)) || (await blockedBetween(req.user.id, uid))) continue;
      const dm = (await findDM(req.user.id, uid)) || (await newDM(req.user.id, uid));
      await postMessage(dm, req.user, 'text', body);
      sent++;
    }
    const sid = id();
    await run('INSERT INTO broadcast_sends (id, broadcast_id, body, sent_to, created_at) VALUES (?, ?, ?, ?, ?)', [sid, b.id, body, sent, now()]);
    res.json({ sent, send: await one('SELECT * FROM broadcast_sends WHERE id = ?', [sid]) });
  }));
}
