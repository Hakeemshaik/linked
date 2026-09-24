import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { get, post, patch, del } from '../lib/api.js';
import { useApp, useSocket, STATUS, unreadChats } from '../lib/store.jsx';
import { Avatar, GroupAvatar, Header, Sheet, Empty, Icon, Orb, Confirm } from '../components/ui.jsx';
import { fmtTime, dayKey, addDays } from '../lib/dates.js';
import RichText from '../components/RichText.jsx';
import SetupCard from '../components/SetupCard.jsx';
import InviteSheet from '../components/InviteSheet.jsx';
import { clock } from '../components/Voice.jsx';
import { cached, cache } from '../lib/cache.js';

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (dayKey(d) === dayKey(new Date())) return fmtTime(d);
  if (dayKey(d) === dayKey(addDays(new Date(), -1))) return 'Yesterday';
  if (Date.now() - d < 6 * 86400000) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const HOLD_MS = 450;
const OPEN_LEFT = 150; // More + Archive
const OPEN_RIGHT = 84; // Read / Unread
const FULL = 0.55; // of the row's width: a long swipe does the action straight away

/* One chat in the list. Swipe left for More and Archive, right for read/unread; hold for everything else. */
function SwipeRow({ c, onOpen, onHold, onArchive, onRead, onMore, openId, setOpenId, leaving, children }) {
  const ref = useRef(null);
  const g = useRef(null);
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  const set = (v) => { dxRef.current = v; setDx(v); };
  useEffect(() => { if (openId !== c.id && dxRef.current) set(0); }, [openId]); // eslint-disable-line

  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const s = { x: e.clientX, y: e.clientY, id: e.pointerId, base: dxRef.current, w: ref.current?.offsetWidth || 360 };
    s.t = setTimeout(() => { if (!s.swiping) { s.fired = true; navigator.vibrate?.(12); onHold(); } }, HOLD_MS);
    g.current = s;
  };
  const move = (e) => {
    const s = g.current;
    if (!s || s.fired || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.swiping) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      clearTimeout(s.t);
      if (Math.abs(mx) < Math.abs(my) * 1.3) { g.current = null; return; }
      s.swiping = true;
      setOpenId(c.id);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    let v = s.base + mx;
    // Past the buttons it gets heavier; a long enough swipe does the action.
    if (v < -OPEN_LEFT) v = -OPEN_LEFT + (v + OPEN_LEFT) * 0.75;
    if (v > OPEN_RIGHT) v = OPEN_RIGHT + (v - OPEN_RIGHT) * 0.6;
    v = Math.max(-s.w * 0.92, Math.min(s.w * 0.7, v));
    const crossed = (x) => Math.abs(x) > s.w * FULL;
    if (crossed(v) !== crossed(dxRef.current)) navigator.vibrate?.(10);
    set(v);
  };
  const up = () => {
    const s = g.current;
    if (!s) return;
    clearTimeout(s.t);
    if (s.swiping) {
      const v = dxRef.current;
      if (v < -s.w * FULL) { set(-s.w); onArchive(); }
      else if (v > s.w * FULL) { set(0); onRead(); }
      else if (v < -OPEN_LEFT / 2) set(-OPEN_LEFT);
      else if (v > OPEN_RIGHT / 2) set(OPEN_RIGHT);
      else { set(0); setOpenId(null); }
      g.current = { fired: true };
    } else if (!s.fired) g.current = null;
  };
  const click = (e) => {
    e.preventDefault();
    if (g.current?.fired) { e.stopPropagation(); g.current = null; return; }
    if (dxRef.current) { set(0); setOpenId(null); return; }
    onOpen();
  };
  const unreadish = c.unread > 0 || c.marked_unread;
  const w = ref.current?.offsetWidth || 360;
  return (
    <div ref={ref} className={`swipe ${leaving ? 'leaving' : ''} ${dx ? 'moving' : ''}`} onContextMenu={(e) => { e.preventDefault(); onHold(); }}>
      {dx > 0 && (
        <div className="swipe-under left">
          <button className="swipe-btn" style={{ '--c': 'var(--blue)', width: Math.max(OPEN_RIGHT, dx) }} onClick={() => { set(0); onRead(); }}>
            <Icon name={unreadish ? 'chatRead' : 'chatUnread'} size={22} /><span>{unreadish ? 'Read' : 'Unread'}</span>
          </button>
        </div>
      )}
      {dx < 0 && (
        <div className="swipe-under right">
          {-dx < w * FULL && (
            <button className="swipe-btn" style={{ '--c': '#8A8A99', width: -dx / 2 }} onClick={() => { set(0); setOpenId(null); onMore(); }}>
              <Icon name="more" size={22} /><span>More</span>
            </button>
          )}
          <button className="swipe-btn" style={{ '--c': 'var(--accent)', width: -dx < w * FULL ? -dx / 2 : -dx }} onClick={() => { set(-w); onArchive(); }}>
            <Icon name="archive" size={22} /><span>{c.archived ? 'Unarchive' : 'Archive'}</span>
          </button>
        </div>
      )}
      <div role="button" tabIndex={0} className="row-item swipe-face" style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={click}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
        {children}
      </div>
    </div>
  );
}

export default function Chats({ archivedView = false }) {
  const { me, friends, navigate, toast, unread, openPlanner, setChatUnread, loadUnread } = useApp();
  const loc = useLocation();
  const [convs, setConvs] = useState(() => cached('convs') || null); // last visit's list, shown at once
  const [lists, setLists] = useState(() => cached('lists') || []);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [typing, setTyping] = useState({});
  const [newOpen, setNewOpen] = useState(false);
  const [group, setGroup] = useState(false);
  const [pick, setPick] = useState([]);
  const [name, setName] = useState('');
  const [hold, setHold] = useState(null); // chat whose menu is open
  const [sub, setSub] = useState(null); // 'mute' | 'lists' inside that menu
  const [openId, setOpenId] = useState(null);
  const [leaving, setLeaving] = useState({});
  const [ask, setAsk] = useState(null);
  const [invite, setInvite] = useState(false);
  const timers = useRef({});

  const load = () => get('/conversations').then((r) => {
    setConvs(r.conversations); cache('convs', r.conversations); setChatUnread(unreadChats(r.conversations));
  }).catch(() => setConvs((c) => c || []));
  const loadLists = () => get('/lists').then((r) => { setLists(r.lists); cache('lists', r.lists); }).catch(() => {});
  useEffect(() => { load(); loadLists(); }, [loc.pathname]); // eslint-disable-line
  useSocket('message', load);
  useSocket('message:update', load);
  useSocket('read', load);
  useSocket('conversations:changed', load);
  useSocket('presence', load);
  useSocket('typing', (p) => {
    setTyping((t) => ({ ...t, [p.conversation_id]: p.user }));
    clearTimeout(timers.current[p.conversation_id]);
    timers.current[p.conversation_id] = setTimeout(() => setTyping((t) => ({ ...t, [p.conversation_id]: null })), 3000);
  });

  const startDM = async (f) => {
    const r = await post('/conversations', { member_ids: [f.id] });
    setNewOpen(false); navigate(`/chat/${r.conversation.id}`);
  };
  const createGroup = async () => {
    try {
      const r = await post('/conversations', { member_ids: pick, name });
      setNewOpen(false); setGroup(false); setPick([]); setName('');
      navigate(`/chat/${r.conversation.id}`);
    } catch (e) { toast({ title: 'Could not create group', body: e.message }); }
  };

  // Changes show at once; the server's copy follows.
  const local = (cid, p) => setConvs((xs) => xs && xs.map((c) => (c.id === cid ? { ...c, ...p } : c)));
  const setMine = async (c, body, optimistic = {}) => {
    local(c.id, optimistic);
    try { await patch(`/conversations/${c.id}/me`, body); } catch (e) { toast({ title: 'Could not change that', body: e.message }); }
    load(); loadUnread();
  };
  const archive = (c) => {
    setOpenId(null);
    const to = !c.archived;
    setLeaving((l) => ({ ...l, [c.id]: true }));
    setTimeout(async () => {
      await setMine(c, { archived: to }, { archived: to });
      setLeaving((l) => { const n = { ...l }; delete n[c.id]; return n; });
    }, 280);
    toast({ title: to ? 'Chat archived' : 'Chat unarchived', icon: 'archive', ms: 4000, action: { label: 'Undo', run: () => setMine(c, { archived: !to }, { archived: !to }) } });
  };
  const toggleRead = (c) => {
    setOpenId(null);
    if (c.unread > 0 || c.marked_unread) {
      local(c.id, { unread: 0, marked_unread: false });
      post(`/conversations/${c.id}/read`).then(() => { load(); loadUnread(); }).catch(() => {});
    } else setMine(c, { marked_unread: true }, { marked_unread: true });
  };
  const pin = (c) => {
    if (!c.pinned_at && (convs || []).filter((x) => x.pinned_at).length >= 3) return toast({ title: 'You can pin up to 3 chats' });
    setMine(c, { pinned: !c.pinned_at }, { pinned_at: c.pinned_at ? null : new Date().toISOString() });
  };
  const closeHold = () => { setHold(null); setSub(null); };
  const act = (fn) => () => { const c = hold; closeHold(); fn(c); };

  const ai = convs?.find((c) => c.is_ai);
  const all = (convs || []).filter((c) => !c.is_ai);
  const archivedList = all.filter((c) => c.archived);
  let list = archivedView ? archivedList : all.filter((c) => !c.archived);
  const activeList = lists.find((l) => `list:${l.id}` === filter);
  if (filter === 'unread') list = list.filter((c) => c.unread > 0 || c.marked_unread);
  if (filter === 'favourites') list = all.filter((c) => c.favorite);
  if (filter === 'groups') list = list.filter((c) => c.is_group);
  if (activeList) list = all.filter((c) => activeList.conversation_ids.includes(c.id));
  if (q.trim()) list = all.filter((c) => (c.title + ' ' + (c.last_message?.body || '')).toLowerCase().includes(q.trim().toLowerCase()));
  // Pinned chats stay on top, newest pin first.
  if (!archivedView) list = [...list.filter((c) => c.pinned_at).sort((a, b) => b.pinned_at.localeCompare(a.pinned_at)), ...list.filter((c) => !c.pinned_at)];
  const archivedUnread = archivedList.filter((c) => c.unread > 0).length;

  const preview = (c) => {
    const t = typing[c.id];
    if (t) return <span className="accent">{c.is_group ? `${t.display_name.split(' ')[0]} is typing…` : 'typing…'}</span>;
    const m = c.last_message;
    if (!m) return c.is_group ? 'Group created' : 'Say hi';
    const mine = m.sender_id === me?.id;
    const others = c.members.filter((u) => !u.me);
    if (m.kind === 'deleted') return <span className="deleted-line"><Icon name="block" size={15} />{mine ? 'You deleted this message' : 'This message was deleted'}</span>;
    if (m.kind === 'system') return <span>{m.body}</span>;
    const read = mine && others.length && others.every((u) => (c.reads?.[u.id] || '') >= m.created_at);
    const body = m.kind === 'plan' ? `Plan: ${m.body}` : m.body;
    return (
      <>
        {mine && <Icon name={read || others.some((u) => u.online) ? 'ticks' : 'tick'} size={16} className={`tick ${read ? 'read' : ''}`} />}
        {!mine && !!c.is_group && m.sender && <span>{m.sender.display_name.split(' ')[0]}: </span>}
        {!m.sender && m.kind === 'ai' && <span>Planner: </span>}
        {m.kind === 'image' ? <span className="media-line"><Icon name="camera" size={15} />{m.body ? <RichText text={m.body} links={false} /> : 'Photo'}</span>
          : m.kind === 'voice' ? <span className="media-line"><Icon name="mic" size={15} />Voice message ({clock(m.data?.duration)})</span>
          : m.kind === 'file' ? <span className="media-line"><Icon name="doc" size={15} />{m.body || 'Document'}</span>
          : <span><RichText text={body} links={false} /></span>}
      </>
    );
  };

  const face = (c) => {
    const others = c.members.filter((m) => !m.me);
    return c.is_group ? <GroupAvatar conv={c} size={52} /> : <Avatar user={others[0]} size={52} showStatus={others[0]?.online} />;
  };
  const rowBody = (c) => (
    <>
      {face(c)}
      <span className="grow">
        <span className="line1"><b className="ellipsis">{c.title}</b><small className={c.unread && !c.muted ? 'accent' : ''}>{when(c.last_message?.created_at)}</small></span>
        <span className="line2"><span className="ellipsis">{preview(c)}</span>
          <span className="row-flags">
            {c.muted && <Icon name="bellOff" size={16} className="muted" />}
            {c.pinned_at && !archivedView && <Icon name="pinOn" size={16} className="muted" />}
            {c.unread > 0 ? <b key={c.unread} className={`unread ${c.muted ? 'quiet' : ''}`}>{c.unread}</b> : c.marked_unread && <b className="unread dot" />}
          </span>
        </span>
      </span>
    </>
  );
  const exitGroup = (c) => setAsk({
    title: `Exit "${c.title}"?`, body: 'The others are told you left.', ok: 'Exit group', danger: true,
    run: async () => { await del(`/conversations/${c.id}/members/me`); load(); loadUnread(); },
  });
  const deleteChat = (c) => setAsk({
    title: 'Delete this chat?', body: 'Your copy of the messages is cleared. It comes back if they write again.', ok: 'Delete chat', danger: true,
    run: async () => { await post(`/conversations/${c.id}/hide`); load(); loadUnread(); },
  });
  const clearChat = (c) => setAsk({
    title: 'Clear this chat?', body: 'Messages are removed for you only.', ok: 'Clear chat', danger: true,
    run: async () => { await post(`/conversations/${c.id}/clear`); load(); loadUnread(); },
  });

  return (
    <>
      {archivedView ? <Header back="/" title="Archived" /> : (
        <Header
          left={<button className="me-btn plain" onClick={() => navigate('/you')} aria-label="You and settings"><Avatar user={me} size={34} /></button>}
          title="Chats"
          right={<>
            <button className="icon-plain bell-btn" onClick={() => navigate('/alerts')} aria-label={`Notifications${unread ? `, ${unread} new` : ''}`}>
              <Icon name="bell" size={24} />{unread > 0 && <b className="badge sm">{unread > 9 ? '9+' : unread}</b>}
            </button>
            <button className="icon-plain accent" onClick={() => setNewOpen(true)} aria-label="New chat"><Icon name="edit" size={24} /></button>
          </>}
        />
      )}

      {!archivedView && <SetupCard />}
      {!archivedView && (
        <>
          <label className="search">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, or ask Planner" aria-label="Search chats, or ask Planner" />
            {q && <button type="button" className="icon-plain sm" onClick={() => setQ('')} aria-label="Clear search"><Icon name="x" size={16} /></button>}
          </label>
          <div className="filters">
            {[['all', 'All'], ['unread', 'Unread'], ['favourites', 'Favourites'], ['groups', 'Groups'], ...lists.map((l) => [`list:${l.id}`, l.name])].map(([k, l]) => (
              <button key={k} className={`filter ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
            <button className="filter add" onClick={() => navigate('/you/lists?new=1')} aria-label="New list"><Icon name="plus" size={16} /></button>
          </div>
        </>
      )}

      {!archivedView && friends.incoming.length > 0 && (
        <button className="row-item banner-row" onClick={() => navigate('/friends')}>
          <span className="round-ic" style={{ '--c': 'var(--accent)' }}><Icon name="userPlus" size={22} /></span>
          <span className="grow"><b>{friends.incoming.length} friend request{friends.incoming.length > 1 ? 's' : ''}</b><small>{friends.incoming.map((r) => r.user.display_name).join(', ')}</small></span>
          <Icon name="right" size={18} className="muted" />
        </button>
      )}

      {q.trim() && (
        <button className="row-item ask-row" onClick={() => openPlanner(q.trim(), { send: true })}>
          <Orb size={44} />
          <span className="grow"><b>Ask Planner</b><small className="ellipsis">"{q.trim()}"</small></span>
          <Icon name="right" size={18} className="muted" />
        </button>
      )}
      <div className="chat-list">
        {!archivedView && archivedList.length > 0 && filter === 'all' && !q && (
          <button className="row-item archived-row" onClick={() => navigate('/archived')}>
            <span className="archived-ic"><Icon name="archive" size={22} /></span>
            <span className="grow"><b>Archived</b></span>
            {archivedUnread > 0 ? <b className="unread quiet">{archivedUnread}</b> : <small className="muted">{archivedList.length}</small>}
          </button>
        )}
        {ai && filter === 'all' && !q && !archivedView && (
          <button className="row-item enter" style={{ '--i': 0 }} onClick={() => navigate(`/chat/${ai.id}`)}>
            <Orb size={52} />
            <span className="grow">
              <span className="line1"><b>Planner</b><small className={ai.unread ? 'accent' : ''}>{when(ai.last_message?.created_at)}</small></span>
              <span className="line2"><span className="ellipsis">{ai.last_message?.kind === 'plan' ? `Plan: ${ai.last_message.body}` : ai.last_message?.body || 'Ask me anything, I plan too'}</span>
                {ai.unread > 0 ? <b key={ai.unread} className="unread">{ai.unread}</b> : <Icon name="pinOn" size={16} className="muted" />}</span>
            </span>
          </button>
        )}
        {list.map((c, idx) => (
          <SwipeRow key={c.id} c={c} leaving={leaving[c.id]} openId={openId} setOpenId={setOpenId}
            onOpen={() => navigate(`/chat/${c.id}`)} onHold={() => setHold(c)} onArchive={() => archive(c)} onRead={() => toggleRead(c)} onMore={() => setHold(c)}>
            <span className="row-inner enter" style={{ '--i': Math.min(idx + 1, 12) }}>{rowBody(c)}</span>
          </SwipeRow>
        ))}
      </div>
      {archivedView && (convs ? <p className="muted small center mt pad">{archivedList.length ? 'Archived chats stay here when new messages come in. Swipe one to unarchive it.' : 'No archived chats. Swipe a chat left to archive it.'}</p> : <div className="spinner" />)}

      {convs && list.length === 0 && (filter !== 'all' || q) && !archivedView && (
        <p className="muted center small mt pad">{filter === 'favourites' ? 'No favourites yet. Hold a chat and tap Add to Favourites.' : activeList ? 'No chats in this list yet. Hold a chat and tap Add to list.' : 'No chats match.'}</p>
      )}
      {convs && list.length === 0 && filter === 'all' && !q && !archivedView && (
        <Empty art={friends.friends.length ? 'chats' : 'friends'} title={friends.friends.length ? 'No chats yet' : 'Bring your friends'}
          action={friends.friends.length
            ? <button className="btn primary mt" onClick={() => setNewOpen(true)}>Start a chat</button>
            : <button className="btn primary mt" onClick={() => setInvite(true)}>Invite friends</button>}>
          {friends.friends.length ? 'Message a friend or start a group for a trip.' : 'Share your link or code. When they join, your chat opens right here.'}
        </Empty>
      )}

      {/* A held chat: everything you can do with it. */}
      <Sheet open={!!hold} onClose={closeHold}>
        {hold && !sub && (
          <>
            <div className="hold-head">{face(hold)}<span className="grow"><b className="ellipsis">{hold.title}</b><small className="muted">{hold.is_group ? `${hold.members.length} members` : 'Chat'}</small></span></div>
            <div className="group-list hold-menu">
              <button className="row-item cell" onClick={act(pin)}><Icon name="pinOn" size={20} /><span className="grow">{hold.pinned_at ? 'Unpin' : 'Pin to top'}</span></button>
              <button className="row-item cell" onClick={act(toggleRead)}><Icon name={hold.unread || hold.marked_unread ? 'chatRead' : 'chatUnread'} size={20} /><span className="grow">{hold.unread || hold.marked_unread ? 'Mark as read' : 'Mark as unread'}</span></button>
              <button className="row-item cell" onClick={hold.muted ? act((c) => setMine(c, { muted: null }, { muted: false })) : () => setSub('mute')}><Icon name={hold.muted ? 'bell' : 'bellOff'} size={20} /><span className="grow">{hold.muted ? 'Unmute' : 'Mute'}</span></button>
              <button className="row-item cell" onClick={act((c) => setMine(c, { favorite: !c.favorite }, { favorite: !c.favorite }))}><Icon name="heart" size={20} /><span className="grow">{hold.favorite ? 'Remove from Favourites' : 'Add to Favourites'}</span></button>
              <button className="row-item cell" onClick={() => setSub('lists')}><Icon name="list" size={20} /><span className="grow">Add to list</span></button>
              <button className="row-item cell" onClick={act(archive)}><Icon name="archive" size={20} /><span className="grow">{hold.archived ? 'Unarchive' : 'Archive'}</span></button>
              <button className="row-item cell" onClick={act((c) => navigate(`/chat/${c.id}/info`))}><Icon name="info" size={20} /><span className="grow">{hold.is_group ? 'Group info' : 'Contact info'}</span></button>
              <button className="row-item cell danger-cell" onClick={act(clearChat)}><Icon name="broom" size={20} /><span className="grow">Clear chat</span></button>
              {hold.is_group
                ? <button className="row-item cell danger-cell" onClick={act(exitGroup)}><Icon name="logout" size={20} /><span className="grow">Exit group</span></button>
                : <button className="row-item cell danger-cell" onClick={act(deleteChat)}><Icon name="trash" size={20} /><span className="grow">Delete chat</span></button>}
            </div>
          </>
        )}
        {hold && sub === 'mute' && (
          <>
            <h3 className="sheet-title">Mute "{hold.title}"</h3>
            <div className="group-list">
              {[['8h', '8 hours'], ['1w', '1 week'], ['always', 'Always']].map(([k, l]) => (
                <button key={k} className="row-item cell" onClick={act((c) => setMine(c, { muted: k }, { muted: true }))}><span className="grow"><b>{l}</b></span></button>
              ))}
            </div>
          </>
        )}
        {hold && sub === 'lists' && (
          <>
            <h3 className="sheet-title">Add to list</h3>
            {lists.length === 0 && <p className="muted center small">No lists yet.</p>}
            <div className="group-list">
              {lists.map((l) => {
                const on = l.conversation_ids.includes(hold.id);
                return (
                  <button key={l.id} className="row-item cell" onClick={async () => {
                    const ids = on ? l.conversation_ids.filter((x) => x !== hold.id) : [...l.conversation_ids, hold.id];
                    const r = await patch(`/lists/${l.id}`, { conversation_ids: ids });
                    setLists((xs) => xs.map((x) => (x.id === l.id ? r.list : x)));
                  }}>
                    <span className="grow"><b>{l.name}</b></span>
                    <span className={`check ${on ? 'on' : ''}`}>{on && <Icon name="check" size={16} />}</span>
                  </button>
                );
              })}
            </div>
            <button className="btn block" onClick={() => { closeHold(); navigate('/you/lists?new=1'); }}>New list</button>
          </>
        )}
      </Sheet>

      <Sheet open={newOpen} onClose={() => { setNewOpen(false); setGroup(false); setPick([]); }} title={group ? 'New group' : 'New chat'}>
        {!group ? (
          <div className="sheet-list">
            <button className="row-item" onClick={() => setGroup(true)}>
              <span className="round-ic solid"><Icon name="friends" size={22} /></span><span className="grow"><b>New group</b></span>
            </button>
            <button className="row-item" onClick={() => { setNewOpen(false); navigate('/communities?new=1'); }}>
              <span className="round-ic solid" style={{ '--c': 'var(--ok)' }}><Icon name="community" size={22} /></span><span className="grow"><b>New community</b><small>Groups and announcements under one roof</small></span>
            </button>
            <button className="row-item" onClick={() => { setNewOpen(false); setInvite(true); }}>
              <span className="round-ic solid" style={{ '--c': 'var(--pink)' }}><Icon name="userPlus" size={22} /></span><span className="grow"><b>Invite a friend</b><small>Link, QR code or your username</small></span>
            </button>
            <div className="list-label">Friends</div>
            {friends.friends.map((f) => (
              <button key={f.id} className="row-item" onClick={() => startDM(f)}>
                <Avatar user={f} size={44} showStatus={f.online} />
                <span className="grow"><b>{f.display_name}</b><small>{f.status_text || (f.online ? STATUS[f.status]?.label : 'Offline')}</small></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="form">
            <input placeholder="Group name, e.g. Durban trip" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="sheet-list">
              {friends.friends.map((f) => (
                <button key={f.id} className="row-item" onClick={() => setPick(pick.includes(f.id) ? pick.filter((x) => x !== f.id) : [...pick, f.id])}>
                  <Avatar user={f} size={44} />
                  <span className="grow"><b>{f.display_name}</b></span>
                  <span className={`check ${pick.includes(f.id) ? 'on' : ''}`}>{pick.includes(f.id) && <Icon name="check" size={16} />}</span>
                </button>
              ))}
            </div>
            <button className="btn primary block" disabled={pick.length < 1} onClick={createGroup}>Create group{pick.length ? ` (${pick.length + 1})` : ''}</button>
          </div>
        )}
      </Sheet>
      <InviteSheet open={invite} onClose={() => setInvite(false)} />
      <Confirm ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}

export function Archived() {
  return <Chats archivedView />;
}
