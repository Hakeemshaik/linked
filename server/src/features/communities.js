// Communities: a named circle of friends with an Announcements chat and its own groups that members can join.
import { q, one, run, id, now, publicUser, getUsers, areFriends } from '../db.js';
import { emitToUsers } from '../realtime.js';

const ART_ID = /^[a-z]{2,20}$/;

export function routes(api, h) {
  const { wrap, bad, systemMessage } = h;
  const membership = (cid, uid) => one('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?', [cid, uid]);
  const memberIdsOf = async (cid) => (await q('SELECT user_id FROM community_members WHERE community_id = ?', [cid])).map((r) => r.user_id);
  const changed = (uids) => emitToUsers(uids, 'communities:changed', {}).then(() => emitToUsers(uids, 'conversations:changed', {}));

  async function detail(cid, uid) {
    const c = await one('SELECT * FROM communities WHERE id = ?', [cid]);
    const rows = await q('SELECT u.*, m.role FROM community_members m JOIN users u ON u.id = m.user_id WHERE m.community_id = ? ORDER BY m.joined_at', [cid]);
    const groups = await q(`SELECT c.*, (SELECT COUNT(*)::int FROM conversation_members x WHERE x.conversation_id = c.id) AS member_count,
        EXISTS (SELECT 1 FROM conversation_members y WHERE y.conversation_id = c.id AND y.user_id = ?) AS joined
      FROM conversations c WHERE c.community_id = ? ORDER BY (c.kind = 'announcements') DESC, c.updated_at DESC`, [uid, cid]);
    const announce = groups.find((g) => g.kind === 'announcements');
    return {
      ...c,
      role: rows.find((r) => r.id === uid)?.role || null,
      members: rows.map((u) => ({ ...publicUser(u), role: u.role })),
      announcements_id: announce?.id || null,
      groups: groups.filter((g) => g !== announce).map((g) => ({ id: g.id, name: g.name, avatar: g.avatar, member_count: g.member_count, joined: !!g.joined, updated_at: g.updated_at })),
    };
  }

  api.get('/communities', wrap(async (req, res) => {
    const rows = await q('SELECT c.* FROM communities c JOIN community_members m ON m.community_id = c.id WHERE m.user_id = ? ORDER BY c.created_at DESC', [req.user.id]);
    res.json({ communities: await Promise.all(rows.map((c) => detail(c.id, req.user.id))) });
  }));

  api.post('/communities', wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 50);
    if (!name) return bad(res, 'Give the community a name');
    const avatar = ART_ID.test(req.body?.avatar || '') ? req.body.avatar : null;
    const members = [req.user.id];
    for (const u of new Set(req.body?.member_ids || [])) if (u !== req.user.id && (await areFriends(req.user.id, u))) members.push(u);
    const cid = id();
    const t = now();
    await run('INSERT INTO communities (id, name, description, avatar, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [cid, name, String(req.body?.description || '').slice(0, 300), avatar, req.user.id, t]);
    for (const u of members) await run('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [cid, u, u === req.user.id ? 'admin' : 'member', t]);
    // Everyone in the community is in its Announcements chat.
    const ann = id();
    await run(`INSERT INTO conversations (id, name, is_group, community_id, kind, description, avatar, created_by) VALUES (?, 'Announcements', 1, ?, 'announcements', ?, ?, ?)`,
      [ann, cid, `Updates for everyone in ${name}`, avatar, req.user.id]);
    for (const u of members) await run('INSERT INTO conversation_members (conversation_id, user_id, last_read_at, role) VALUES (?, ?, ?, ?)', [ann, u, t, u === req.user.id ? 'admin' : null]);
    await systemMessage(ann, `${req.user.display_name} created the community "${name}"`);
    await changed(members);
    res.json({ community: await detail(cid, req.user.id) });
  }));

  api.get('/communities/:id', wrap(async (req, res) => {
    if (!(await membership(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
    res.json({ community: await detail(req.params.id, req.user.id) });
  }));

  api.patch('/communities/:id', wrap(async (req, res) => {
    const m = await membership(req.params.id, req.user.id);
    if (!m) return bad(res, 'Not found', 404);
    if (m.role !== 'admin') return bad(res, 'Only community admins can edit it', 403);
    const { name, description, avatar } = req.body || {};
    await run(`UPDATE communities SET name = COALESCE(?, name), description = COALESCE(?, description),
      avatar = CASE WHEN ? THEN ? ELSE avatar END WHERE id = ?`,
    [name ? String(name).trim().slice(0, 50) : null, description !== undefined ? String(description).slice(0, 300) : null,
      avatar !== undefined, ART_ID.test(avatar || '') ? avatar : null, req.params.id]);
    await changed(await memberIdsOf(req.params.id));
    res.json({ community: await detail(req.params.id, req.user.id) });
  }));

  api.post('/communities/:id/members', wrap(async (req, res) => {
    if (!(await membership(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
    const cur = await memberIdsOf(req.params.id);
    const added = [];
    for (const u of new Set(req.body?.member_ids || [])) {
      if (cur.includes(u) || !(await areFriends(req.user.id, u))) continue;
      await run('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [req.params.id, u, 'member', now()]);
      added.push(u);
    }
    if (!added.length) return bad(res, "Pick friends who aren't in it yet");
    const ann = await one(`SELECT id FROM conversations WHERE community_id = ? AND kind = 'announcements'`, [req.params.id]);
    if (ann) {
      for (const u of added) await run('INSERT INTO conversation_members (conversation_id, user_id, last_read_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [ann.id, u, now()]);
      await systemMessage(ann.id, `${req.user.display_name} added ${(await getUsers(added)).map((u) => u.display_name.split(' ')[0]).join(', ')}`);
    }
    await changed([...cur, ...added]);
    res.json({ community: await detail(req.params.id, req.user.id) });
  }));

  api.post('/communities/:id/groups', wrap(async (req, res) => {
    if (!(await membership(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) return bad(res, 'Give the group a name');
    const gid = id();
    await run('INSERT INTO conversations (id, name, is_group, community_id, created_by) VALUES (?, ?, 1, ?, ?)', [gid, name, req.params.id, req.user.id]);
    await run('INSERT INTO conversation_members (conversation_id, user_id, last_read_at, role) VALUES (?, ?, ?, ?)', [gid, req.user.id, now(), 'admin']);
    await systemMessage(gid, `${req.user.display_name} created "${name}"`);
    await changed(await memberIdsOf(req.params.id));
    res.json({ conversation_id: gid, community: await detail(req.params.id, req.user.id) });
  }));

  api.post('/communities/:id/groups/:gid/join', wrap(async (req, res) => {
    if (!(await membership(req.params.id, req.user.id))) return bad(res, 'Not found', 404);
    const g = await one('SELECT * FROM conversations WHERE id = ? AND community_id = ?', [req.params.gid, req.params.id]);
    if (!g) return bad(res, 'Not found', 404);
    const added = await run('INSERT INTO conversation_members (conversation_id, user_id, last_read_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [g.id, req.user.id, now()]);
    if (added) await systemMessage(g.id, `${req.user.display_name} joined`);
    await changed([req.user.id]);
    res.json({ conversation_id: g.id });
  }));

  api.post('/communities/:id/leave', wrap(async (req, res) => {
    const m = await membership(req.params.id, req.user.id);
    if (!m) return bad(res, 'Not found', 404);
    const groups = await q('SELECT c.id FROM conversations c JOIN conversation_members x ON x.conversation_id = c.id AND x.user_id = ? WHERE c.community_id = ?', [req.user.id, req.params.id]);
    for (const g of groups) {
      await run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [g.id, req.user.id]);
      await systemMessage(g.id, `${req.user.display_name} left`);
    }
    await run('DELETE FROM community_members WHERE community_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    // Someone has to be able to edit it: the longest-standing member becomes admin if the last admin leaves.
    if (m.role === 'admin' && !(await one(`SELECT 1 AS x FROM community_members WHERE community_id = ? AND role = 'admin'`, [req.params.id]))) {
      await run(`UPDATE community_members SET role = 'admin' WHERE community_id = ? AND user_id = (SELECT user_id FROM community_members WHERE community_id = ? ORDER BY joined_at LIMIT 1)`, [req.params.id, req.params.id]);
    }
    await changed([req.user.id, ...(await memberIdsOf(req.params.id))]);
    res.json({ ok: true });
  }));
}
