import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { get, post, patch, del } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Avatar, GroupAvatar, Header, Icon, Sheet, Cell, Confirm, FriendPicker, Empty } from '../components/ui.jsx';
import { PhotoViewer } from '../components/Photos.jsx';
import { mediaUrl } from '../lib/media.js';
import { fmtTime, relDay, dayKey, ago } from '../lib/dates.js';
import { AVATARS, EMOJI, avatarUrl, emojiUrl } from '../lib/art.js';
import RichText from '../components/RichText.jsx';
import { DocCard } from './ChatRoom.jsx';

export const THEMES = [
  ['default', 'Classic'], ['violet', 'Lavender'], ['ocean', 'Ocean'], ['mint', 'Mint'], ['sunset', 'Sunset'], ['rose', 'Rose'], ['night', 'Night'], ['sand', 'Sand'],
];
const MUTES = [['8h', '8 hours'], ['1w', '1 week'], ['always', 'Always']];

function mutedLabel(c) {
  if (!c?.muted) return 'Off';
  const until = new Date(c.muted_until);
  if (until - Date.now() > 5 * 365 * 86400000) return 'Always';
  return `Until ${dayKey(until) === dayKey(new Date()) ? fmtTime(until) : `${relDay(until)} ${fmtTime(until)}`}`;
}
function presence(u) {
  if (!u) return '';
  if (u.online) return 'online';
  if (!u.last_seen) return '';
  return `last seen ${ago(u.last_seen)}`;
}

/* Tap a chat's name: who it is, what's been shared, and everything you can do with the chat. */
export default function ChatInfo() {
  const { id } = useParams();
  const { friends, navigate, toast, loadUnread, me } = useApp();
  const [info, setInfo] = useState(null);
  const [sheet, setSheet] = useState(null); // mute | theme | add | edit | lists | pic
  const [ask, setAsk] = useState(null);
  const [picked, setPicked] = useState([]);
  const [lists, setLists] = useState([]);
  const [edit, setEdit] = useState({ name: '', description: '' });
  const [viewer, setViewer] = useState(null);

  const load = () => get(`/conversations/${id}/info`).then(setInfo).catch(() => navigate('/', { replace: true }));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  useSocket('conversations:changed', load);
  useSocket('friends:changed', load);

  if (!info) return <><Header back={`/chat/${id}`} title="" /><div className="spinner" /></>;
  const c = info.conversation;
  const group = !!c.is_group;
  const other = !group ? c.members.find((m) => !m.me) : null;
  const admin = group && (c.my_role === 'admin' || c.created_by === me?.id);
  const others = c.members.filter((m) => !m.me);

  const setMine = async (body, done) => {
    try { await patch(`/conversations/${id}/me`, body); await load(); loadUnread(); if (done) toast({ title: done, ms: 1800 }); }
    catch (e) { toast({ title: 'Could not change that', body: e.message }); }
  };
  const call = async () => {
    try { const r = await post('/invites', { to_ids: others.map((m) => m.id), kind: 'call' }); navigate(`/call/${r.room_id}`); }
    catch (e) { toast({ title: 'Could not call', body: e.message }); }
  };
  const block = () => setAsk({
    title: info.blocked ? `Unblock ${other.display_name}?` : `Block ${other.display_name}?`,
    body: info.blocked ? 'They can message and call you again.' : "They won't be able to message or call you, and won't be told you blocked them.",
    ok: info.blocked ? 'Unblock' : 'Block', danger: !info.blocked,
    run: async () => { info.blocked ? await del(`/blocks/${other.id}`) : await post(`/blocks/${other.id}`); await load(); toast({ title: info.blocked ? 'Unblocked' : 'Blocked' }); },
  });
  const clear = () => setAsk({
    title: 'Clear this chat?', body: 'Messages are removed for you only. Everyone else keeps theirs.', ok: 'Clear chat', danger: true,
    run: async () => { await post(`/conversations/${id}/clear`); loadUnread(); toast({ title: 'Chat cleared' }); navigate(`/chat/${id}`, { replace: true }); },
  });
  const remove = () => setAsk(group ? {
    title: `Exit "${c.title}"?`, body: 'You stop getting its messages. The others are told you left.', ok: 'Exit group', danger: true,
    run: async () => { await del(`/conversations/${id}/members/me`); loadUnread(); navigate('/', { replace: true }); },
  } : {
    title: 'Delete this chat?', body: 'It disappears from your list and your copy of the messages is cleared. It comes back if they write again.', ok: 'Delete chat', danger: true,
    run: async () => { await post(`/conversations/${id}/hide`); loadUnread(); navigate('/', { replace: true }); },
  });
  const openLists = async () => { setSheet('lists'); setLists((await get('/lists').catch(() => ({ lists: [] }))).lists); };
  const toggleList = async (l) => {
    const ids = l.conversation_ids.includes(id) ? l.conversation_ids.filter((x) => x !== id) : [...l.conversation_ids, id];
    const r = await patch(`/lists/${l.id}`, { conversation_ids: ids });
    setLists((xs) => xs.map((x) => (x.id === l.id ? r.list : x)));
  };
  const addMembers = async () => {
    try { await post(`/conversations/${id}/members`, { member_ids: picked }); setSheet(null); setPicked([]); load(); toast({ title: 'Added to the group' }); }
    catch (e) { toast({ title: 'Could not add', body: e.message }); }
  };
  const saveGroup = async (body) => {
    try { await patch(`/conversations/${id}`, body); setSheet(null); load(); }
    catch (e) { toast({ title: 'Could not save', body: e.message }); }
  };
  const removeMember = (u) => setAsk({
    title: `Remove ${u.display_name}?`, ok: 'Remove', danger: true,
    run: async () => { await del(`/conversations/${id}/members/${u.id}`); load(); },
  });

  const counts = info.counts;
  const shared = counts.media + counts.links + counts.docs;
  return (
    <>
      <Header back={`/chat/${id}`} title={group ? 'Group info' : 'Contact info'}
        right={admin && <button className="link" onClick={() => { setEdit({ name: c.name || '', description: c.description || '' }); setSheet('edit'); }}>Edit</button>} />

      <section className="info-hero">
        <button className="info-pic" onClick={() => admin && setSheet('pic')} disabled={!admin} aria-label={admin ? 'Change group picture' : undefined}>
          {group ? <GroupAvatar conv={c} size={104} /> : <Avatar user={other} size={104} />}
          {admin && <i><Icon name="camera" size={15} /></i>}
        </button>
        <h2>{c.title}</h2>
        <p className="muted">{group ? `Group · ${c.members.length} member${c.members.length > 1 ? 's' : ''}` : `@${other?.username}`}</p>
        {!group && (other?.status_text || presence(other)) && <p className="muted small">{[other.status_text, presence(other)].filter(Boolean).join(' · ')}</p>}
        {c.community && <button className="chip mt" onClick={() => navigate(`/community/${c.community.id}`)}><Icon name="community" size={16} />{c.community.name}</button>}
        <div className="info-actions">
          <button onClick={call}><Icon name="phone" size={22} />Audio</button>
          <button onClick={call}><Icon name="video" size={22} />Video</button>
          <button onClick={() => navigate(`/chat/${id}?search=1`)}><Icon name="search" size={22} />Search</button>
          {group && <button onClick={() => { setPicked([]); setSheet('add'); }}><Icon name="userPlus" size={22} />Add</button>}
        </div>
      </section>

      {group && c.description && <div className="group-list info-about"><p className="text"><RichText text={c.description} /></p></div>}

      <div className="group-list">
        <Cell icon="image" color="#3B8EF0" title="Media, links and docs" value={shared || 'None'} onClick={() => navigate(`/chat/${id}/media`)} />
        {info.media.length > 0 && (
          <div className="info-strip">
            {info.media.slice(0, 8).map((m) => (
              <button key={m.id} onClick={() => setViewer(m)} aria-label="Open photo">
                {m.data?.thumb && <img className="photo-blur" src={m.data.thumb} alt="" />}
                <img src={mediaUrl(m.data?.url)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
        <Cell icon="star" color="#E8A21B" title="Starred messages" value={counts.starred || 'None'} onClick={() => navigate(`/chat/${id}/starred`)} />
      </div>

      <div className="group-list">
        <Cell icon={c.muted ? 'bellOff' : 'bell'} color="#3CC47C" title="Notifications" value={c.muted ? `Muted · ${mutedLabel(c)}` : 'On'} onClick={() => setSheet('mute')} />
        <Cell icon="wallpaper" color="#E3569E" title="Chat theme" value={(THEMES.find(([k]) => k === (c.theme || 'default')) || THEMES[0])[1]} onClick={() => setSheet('theme')} />
      </div>

      {group && (
        <>
          <div className="list-label">{c.members.length} members</div>
          <div className="group-list">
            {c.members.map((u) => (
              <div key={u.id} className="row-item">
                <Avatar user={u} size={42} showStatus={!u.me && u.online} />
                <span className="grow"><b>{u.me ? 'You' : u.display_name}</b><small>{u.status_text || `@${u.username}`}</small></span>
                {u.role === 'admin' && <span className="tag">Admin</span>}
                {admin && !u.me && <button className="icon-plain sm" onClick={() => removeMember(u)} aria-label={`Remove ${u.display_name}`}><Icon name="x" size={18} /></button>}
              </div>
            ))}
          </div>
        </>
      )}

      {!group && info.groups_in_common.length > 0 && (
        <>
          <div className="list-label">{info.groups_in_common.length} group{info.groups_in_common.length > 1 ? 's' : ''} in common</div>
          <div className="group-list">
            {info.groups_in_common.map((g) => (
              <button key={g.id} className="row-item" onClick={() => navigate(`/chat/${g.id}`)}>
                <GroupAvatar conv={g} size={42} />
                <span className="grow"><b>{g.name || 'Group'}</b></span>
                <Icon name="right" size={18} className="muted" />
              </button>
            ))}
          </div>
        </>
      )}

      <div className="group-list">
        <Cell icon="heart" color="#E8445A" title={c.favorite ? 'Remove from Favourites' : 'Add to Favourites'} chevron={false}
          onClick={() => setMine({ favorite: !c.favorite }, c.favorite ? 'Removed from Favourites' : 'Added to Favourites')} />
        <Cell icon="list" color="#8B6CFF" title="Add to list" onClick={openLists} />
        <Cell icon="archive" color="#8A8A99" title={c.archived ? 'Unarchive chat' : 'Archive chat'} chevron={false}
          onClick={() => setMine({ archived: !c.archived }, c.archived ? 'Unarchived' : 'Archived')} />
      </div>

      <div className="group-list">
        <Cell icon="broom" danger title="Clear chat" chevron={false} onClick={clear} />
        {!group && other && <Cell icon="block" danger title={info.blocked ? `Unblock ${other.display_name.split(' ')[0]}` : `Block ${other.display_name.split(' ')[0]}`} chevron={false} onClick={block} />}
        <Cell icon={group ? 'logout' : 'trash'} danger title={group ? 'Exit group' : 'Delete chat'} chevron={false} onClick={remove} />
      </div>
      {group && c.created_at && <p className="muted small center">Created {relDay(c.created_at)}</p>}

      <Sheet open={sheet === 'mute'} onClose={() => setSheet(null)} title="Mute notifications">
        <p className="muted small center">Nobody is told. You still get messages, just without a sound or banner.</p>
        <div className="group-list">
          {MUTES.map(([k, label]) => (
            <button key={k} className="row-item cell" onClick={() => { setSheet(null); setMine({ muted: k }, `Muted for ${label.toLowerCase()}`); }}><span className="grow"><b>{label}</b></span></button>
          ))}
          {c.muted && <button className="row-item cell" onClick={() => { setSheet(null); setMine({ muted: null }, 'Notifications on'); }}><span className="grow"><b className="accent">Unmute</b></span></button>}
        </div>
      </Sheet>

      <Sheet open={sheet === 'theme'} onClose={() => setSheet(null)} title="Chat theme">
        <p className="muted small center">Only you see this.</p>
        <div className="theme-grid">
          {THEMES.map(([k, label]) => (
            <button key={k} className={`theme-swatch wallpaper theme-${k} ${(c.theme || 'default') === k ? 'on' : ''}`} onClick={() => { setSheet(null); setMine({ theme: k }); }}>
              <span className="sw-in" /><span className="sw-out" /><b>{label}</b>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === 'lists'} onClose={() => setSheet(null)} title="Add to list">
        {lists.length === 0 ? <p className="muted center small">No lists yet. Make one in You → Lists, then add chats to it.</p> : (
          <div className="group-list">
            {lists.map((l) => (
              <button key={l.id} className="row-item cell" onClick={() => toggleList(l)}>
                <span className="grow"><b>{l.name}</b><small>{l.conversation_ids.length} chat{l.conversation_ids.length === 1 ? '' : 's'}</small></span>
                <span className={`check ${l.conversation_ids.includes(id) ? 'on' : ''}`}>{l.conversation_ids.includes(id) && <Icon name="check" size={16} />}</span>
              </button>
            ))}
          </div>
        )}
        <button className="btn block" onClick={() => navigate('/you/lists')}>Manage lists</button>
      </Sheet>

      <Sheet open={sheet === 'add'} onClose={() => setSheet(null)} title="Add members">
        <FriendPicker friends={friends.friends} picked={picked} onChange={setPicked} exclude={c.members.map((m) => m.id)} />
        <button className="btn primary block" disabled={!picked.length} onClick={addMembers}>Add{picked.length ? ` ${picked.length}` : ''}</button>
      </Sheet>

      <Sheet open={sheet === 'edit'} onClose={() => setSheet(null)} title="Edit group">
        <div className="form">
          <label>Group name<input value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label>Description<textarea rows={3} maxLength={300} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="What's this group for?" /></label>
          <button className="btn primary block" disabled={!edit.name.trim()} onClick={() => saveGroup(edit)}>Save</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'pic'} onClose={() => setSheet(null)} title="Group picture">
        <div className="pic-grid">
          {[...AVATARS.map((a) => [a.id, avatarUrl(a.id)]), ...EMOJI.map((e) => [e.id, emojiUrl(e.id)])].map(([k, url]) => (
            <button key={k} className={c.avatar === k ? 'on' : ''} onClick={() => saveGroup({ avatar: k })} aria-label={k}>
              <span className="avatar pic-choice" style={{ width: 64, height: 64 }}><img src={url} alt="" draggable="false" /></span>
            </button>
          ))}
        </div>
        {c.avatar && <button className="btn quiet block" onClick={() => saveGroup({ avatar: '' })}>Use members' pictures</button>}
      </Sheet>

      <Confirm ask={ask} onClose={() => setAsk(null)} />
      {viewer && <PhotoViewer m={viewer} who={viewer.sender_id === me?.id ? 'You' : c.members.find((u) => u.id === viewer.sender_id)?.display_name || ''} onClose={() => setViewer(null)} toast={toast} />}
    </>
  );
}

/* Everything shared in a chat: photos, links and documents (and voice messages). */
export function ChatMedia() {
  const { id } = useParams();
  const { navigate, toast, me } = useApp();
  const [tab, setTab] = useState('media');
  const [items, setItems] = useState(null);
  const [viewer, setViewer] = useState(null);
  useEffect(() => {
    setItems(null);
    get(`/conversations/${id}/media?kind=${tab}`).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [id, tab]);
  const open = (m) => navigate(`/chat/${id}?m=${m.id}`);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  return (
    <>
      <Header back={`/chat/${id}/info`} title="Shared" />
      <div className="seg sticky-seg">
        {[['media', 'Media'], ['links', 'Links'], ['docs', 'Docs'], ['voice', 'Voice']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {!items ? <div className="spinner" /> : items.length === 0 ? (
        <Empty title={{ media: 'No photos yet', links: 'No links yet', docs: 'No documents yet', voice: 'No voice messages yet' }[tab]}>
          {{ media: 'Photos you send each other show up here.', links: 'Links from your messages collect here.', docs: 'PDFs and files sent in this chat show up here.', voice: 'Voice messages show up here.' }[tab]}
        </Empty>
      ) : tab === 'media' ? (
        <div className="media-grid">
          {items.map((m) => (
            <button key={m.id} onClick={() => setViewer(m)} aria-label="Open photo">
              {m.data?.thumb && <img className="photo-blur" src={m.data.thumb} alt="" />}
              <img src={mediaUrl(m.data?.url)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : tab === 'links' ? (
        <div className="group-list mt">
          {items.flatMap((m) => (m.links || []).map((u, i) => (
            <div key={`${m.id}-${i}`} className="row-item link-row">
              <span className="tile-ic" style={{ '--c': '#3B8EF0' }}><Icon name="link" size={19} /></span>
              <a className="grow" href={u} target="_blank" rel="noopener noreferrer"><b className="ellipsis">{host(u)}</b><small className="ellipsis">{u}</small></a>
              <button className="icon-plain sm" onClick={() => open(m)} aria-label="Show in chat"><Icon name="chat" size={19} /></button>
            </div>
          )))}
        </div>
      ) : (
        <div className="group-list mt">
          {items.map((m) => (
            <button key={m.id} className="row-item" onClick={() => open(m)}>
              {tab === 'docs' ? <span className="grow"><DocCard m={m} clone /></span> : (
                <>
                  <span className="tile-ic" style={{ '--c': 'var(--accent)' }}><Icon name="mic" size={19} /></span>
                  <span className="grow"><b>{m.sender_id === me?.id ? 'You' : m.sender?.display_name || 'Someone'}</b><small>Voice message · {relDay(m.created_at)}</small></span>
                </>
              )}
              <small className="muted">{relDay(m.created_at)}</small>
            </button>
          ))}
        </div>
      )}
      {viewer && <PhotoViewer m={viewer} who={viewer.sender_id === me?.id ? 'You' : viewer.sender?.display_name || ''} onClose={() => setViewer(null)} toast={toast} />}
    </>
  );
}

/* Starred messages: in one chat, or everywhere (You → Starred). */
export function Starred({ conversationId }) {
  const params = useParams();
  const cid = conversationId || params.id;
  const { navigate, me, toast } = useApp();
  const [list, setList] = useState(null);
  const load = () => get(`/starred${cid ? `?conversation_id=${cid}` : ''}`).then((r) => setList(r.starred)).catch(() => setList([]));
  useEffect(() => { load(); }, [cid]); // eslint-disable-line
  const unstar = async (m) => { setList((l) => l.filter((x) => x.id !== m.id)); await post(`/messages/${m.id}/star`).catch(() => load()); toast({ title: 'Unstarred', ms: 1400 }); };
  const preview = (m) => (m.kind === 'image' ? (m.body || 'Photo') : m.kind === 'voice' ? 'Voice message' : m.kind === 'file' ? `Document: ${m.body}` : m.kind === 'plan' ? `Plan: ${m.body}` : m.body);
  return (
    <>
      <Header back={cid ? `/chat/${cid}/info` : '/you'} title="Starred" />
      {!list ? <div className="spinner" /> : list.length === 0 ? (
        <Empty title="No starred messages">Hold a message and tap Star to keep it here, so it's easy to find later.</Empty>
      ) : (
        <div className="group-list mt">
          {list.map((m) => (
            <div key={m.id} className="row-item star-row" onClick={() => navigate(`/chat/${m.conversation_id}?m=${m.id}`)}>
              {m.sender ? <Avatar user={m.sender} size={38} /> : <span className="tile-ic" style={{ '--c': 'var(--accent)' }}><Icon name="spark" size={18} /></span>}
              <span className="grow">
                <span className="line1"><b className="ellipsis">{m.sender_id === me?.id ? 'You' : m.sender?.display_name || 'Planner'}{!cid && m.is_group ? ` · ${m.conv_name || 'Group'}` : ''}</b><small>{relDay(m.created_at)}</small></span>
                <small className="wrap star-body"><RichText text={String(preview(m) || '').slice(0, 300)} links={false} /></small>
              </span>
              <button className="icon-plain sm" onClick={(e) => { e.stopPropagation(); unstar(m); }} aria-label="Unstar"><Icon name="star" size={19} className="star-ic" /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

