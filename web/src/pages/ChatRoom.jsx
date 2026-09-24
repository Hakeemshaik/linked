import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useSearchParams } from 'react-router-dom';
import { get, post, del, patch } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Avatar, GroupAvatar, Orb, Icon, Sheet, TYPE_LABEL, reminderLabel } from '../components/ui.jsx';
import { fmtRange, fmtTime, relDay, dayKey } from '../lib/dates.js';
import ArtPicker from '../components/ArtPicker.jsx';
import RichText, { emojiOnly } from '../components/RichText.jsx';
import { EMOJI, emojiUrl, stickerUrl, gifUrl } from '../lib/art.js';
import { uploadMedia, mediaUrl, savePhoto } from '../lib/media.js';
import { cachedMessages, cacheMessages } from '../lib/cache.js';
import { PhotoSend, PhotoViewer, photoSize } from '../components/Photos.jsx';
import { VoiceNote, RecordingBar, useRecorder, canRecord, clock } from '../components/Voice.jsx';

const QUICK = ['love', 'lol', 'hype', 'cheers', 'party', 'meh'];
const HOLD_MS = 420;
const SWIPE = 56; // px to the right that turns a swipe into a reply
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const keyOf = (m) => m?.client_id || m?.id;
const isMedia = (kind) => kind === 'sticker' || kind === 'gif';
const smooth = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EDIT_MS = 15 * 60000; // your own messages can be edited for 15 minutes
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const fileSize = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const DOC_EXT = (name = '') => (name.split('.').pop() || 'file').slice(0, 4).toUpperCase();

/* A document in the chat: its type, name and size. Tap to download. */
export function DocCard({ m, clone }) {
  const name = m.data?.name || m.body || 'Document';
  const url = m.local || mediaUrl(m.data?.url);
  const Tag = clone || m.pending || !url ? 'div' : 'a';
  return (
    <Tag className="doc-card" {...(Tag === 'a' ? { href: url, download: name, target: '_blank', rel: 'noopener' } : {})}>
      <span className="doc-ic"><Icon name="doc" size={22} /><b>{DOC_EXT(name)}</b></span>
      <span className="grow"><b className="ellipsis">{name}</b><small>{m.pending ? `Sending… ${Math.round((m.progress || 0) * 100)}%` : `${fileSize(m.data?.size || 0)} · ${DOC_EXT(name)}`}</small></span>
      {!m.pending && <Icon name="download" size={20} className="doc-dl" />}
    </Tag>
  );
}

/** One reaction each: the same emoji takes yours back, another swaps it. */
function toggleReaction(r = {}, emoji, uid) {
  const had = (r[emoji] || []).includes(uid);
  const out = {};
  for (const [e, ids] of Object.entries(r)) {
    const left = ids.filter((u) => u !== uid);
    if (left.length) out[e] = left;
  }
  if (!had) out[emoji] = [...(out[emoji] || []), uid];
  return out;
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* older browsers */ }
  const ta = document.createElement('textarea');
  ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return ok;
}

/* Planner's plan suggestion, rendered as a notice card. */
function PlanCard({ msg, members, onDone }) {
  const { toast, me } = useApp();
  const p = msg.data?.plan || {};
  const created = msg.data?.status === 'created';
  const [edit, setEdit] = useState(!p.date && !created);
  const [f, setF] = useState({
    title: p.title || '', date: p.date || '', end_date: p.end_date || '', start_time: p.start_time || '18:00',
    end_time: p.end_time || '21:00', location: p.location || '', notes: p.notes || '', participant_ids: p.participant_ids || [],
    reminder_minutes: p.reminder_minutes || 60,
  });
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const name = (id) => (id === me?.id ? 'You' : members.find((m) => m.id === id)?.display_name.split(' ')[0]);

  const confirm = async () => {
    setBusy(true);
    try {
      const body = edit ? { ...f, end_date: f.end_date || null, reminder_minutes: +f.reminder_minutes } : {};
      await post(`/messages/${msg.id}/confirm-plan`, body);
      setBurst(true); setTimeout(() => setBurst(false), 1400);
      navigator.vibrate?.(30);
      toast({ title: 'Booked. Invites sent', body: `Everyone gets a reminder ${reminderLabel(edit ? f.reminder_minutes : p.reminder_minutes)}` });
    } catch (e) { toast({ title: 'Could not book it', body: e.message }); } finally { setBusy(false); }
  };

  return (
    <div className={`notice ${created ? 'done' : ''} ${burst ? 'celebrate' : ''}`}>
      {burst && <span className="burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--a': `${i * (360 / 14)}deg`, '--d': `${40 + (i % 3) * 18}px` }} />)}</span>}
      <div className="notice-strip"><Icon name={created ? 'check' : 'cal'} size={15} className={created ? 'draw' : ''} />{created ? 'Booked' : 'Plan ready'}<span>{TYPE_LABEL[p.type] || 'Plan'}</span></div>
      <div className="notice-body">
      {!edit ? (
        <>
          <div className="notice-title">{p.title}</div>
          <div className="notice-row"><Icon name="cal" size={16} />{p.start_at ? fmtRange(p.start_at, p.end_at) : 'No date yet'}</div>
          {p.location && <div className="notice-row"><Icon name="pin" size={16} />{p.location}</div>}
          <div className="notice-row"><Icon name="friends" size={16} />{(p.participant_ids || []).map(name).filter(Boolean).join(', ')}</div>
          <div className="notice-row reward"><Icon name="bell" size={16} /><span className="mono">{reminderLabel(p.reminder_minutes || 60)}</span></div>
          {p.notes && <div className="notice-notes">{p.notes}</div>}
          {p.conflicts?.length > 0 && !created && (
            <div className="conflict">{p.conflicts.map((c) => `${name(c.user_id) || c.name}: ${c.detail}`).join(' · ')}</div>
          )}
        </>
      ) : (
        <div className="form tight">
          <input value={f.title} onChange={set('title')} placeholder="What" aria-label="What" />
          <div className="grid2">
            <input type="date" value={f.date} min={dayKey(new Date())} onChange={set('date')} aria-label="Date" />
            <select value={f.reminder_minutes} onChange={set('reminder_minutes')} aria-label="Reminder">
              {[15, 30, 60, 120, 1440].map((v) => <option key={v} value={v}>{reminderLabel(v)}</option>)}
            </select>
            <input type="time" value={f.start_time} onChange={set('start_time')} aria-label="Starts" />
            <input type="time" value={f.end_time} onChange={set('end_time')} aria-label="Ends" />
          </div>
          <input value={f.location} onChange={set('location')} placeholder="Where (optional)" aria-label="Where" />
          <div className="pick">
            {members.map((m) => (
              <button key={m.id} type="button" className={`pick-item ${f.participant_ids.includes(m.id) ? 'on' : ''}`}
                onClick={() => setF({ ...f, participant_ids: f.participant_ids.includes(m.id) ? f.participant_ids.filter((x) => x !== m.id) : [...f.participant_ids, m.id] })}>
                <Avatar user={m} size={30} /><span>{m.id === me?.id ? 'You' : m.display_name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {created ? (
        <button className="btn block" onClick={() => onDone?.(msg.data.event_id)}>View plan</button>
      ) : (
        <div className="row gap mt">
          <button className="btn grow" onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Change'}</button>
          <button className="btn primary grow" disabled={busy || (edit && !f.date)} onClick={confirm}>{busy ? 'Booking…' : 'Book it'}</button>
        </div>
      )}
      </div>
    </div>
  );
}

/* Reveals Planner's words one by one, only for messages that just arrived. */
function Reveal({ text, fresh }) {
  const words = text.split(/(\s+)/);
  const [n, setN] = useState(fresh ? 0 : words.length);
  useEffect(() => {
    if (!fresh || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(words.length); return; }
    const t = setInterval(() => setN((x) => (x >= words.length ? (clearInterval(t), x) : x + 2)), 45);
    return () => clearInterval(t);
  }, []); // eslint-disable-line
  return <RichText text={words.slice(0, n).join('')} />;
}

function lastSeen(u) {
  if (!u) return '';
  if (u.online) return u.status === 'available' ? 'online' : `online · ${({ busy: 'busy', work: 'at work', away: 'away' })[u.status] || ''}`;
  if (!u.last_seen) return 'offline';
  const d = new Date(u.last_seen);
  const day = dayKey(d) === dayKey(new Date()) ? 'today' : relDay(d).toLowerCase();
  return `last seen ${day} at ${fmtTime(d)}`;
}

/* The message being answered: inside a reply bubble, and above the composer while you write one. */
function Quote({ q, me, color, onClick }) {
  const who = q.sender_id && q.sender_id === me?.id ? 'You' : q.sender_name || 'Planner';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className="quote" style={{ '--qc': color }} onClick={onClick}>
      <span className="quote-text">
        <b className="ellipsis">{who}</b>
        <span className="quote-body">{isMedia(q.kind) ? (q.kind === 'gif' ? 'GIF' : 'Sticker')
          : q.kind === 'image' ? <><Icon name="camera" size={15} className="quote-ic" />{q.body ? <RichText text={q.body} links={false} /> : 'Photo'}</>
          : q.kind === 'voice' ? <><Icon name="mic" size={15} className="quote-ic" />Voice message ({clock(q.duration)})</>
          : q.kind === 'file' ? <><Icon name="doc" size={15} className="quote-ic" />{q.body || 'Document'}</>
          : q.kind === 'plan' ? `Plan: ${q.body}` : <RichText text={q.body} links={false} />}</span>
      </span>
      {isMedia(q.kind) && q.ref && <img src={q.kind === 'gif' ? gifUrl(q.ref) : stickerUrl(q.ref)} alt="" draggable="false" />}
      {q.kind === 'image' && q.thumb && <img className="quote-photo" src={q.thumb} alt="" draggable="false" />}
    </Tag>
  );
}

/* The reactions on a message, as one small pill under it. Tap it to see who. */
function ReactPill({ r, meId, onOpen }) {
  const list = Object.entries(r || {}).sort((a, b) => b[1].length - a[1].length);
  if (!list.length) return null;
  const total = list.reduce((n, [, ids]) => n + ids.length, 0);
  return (
    <button key={total} type="button" className={`react-pill ${list.some(([, ids]) => ids.includes(meId)) ? 'mine' : ''}`} onClick={onOpen}
      aria-label={`${total} reaction${total > 1 ? 's' : ''}`}>
      {list.slice(0, 3).map(([e]) => <img key={e} src={emojiUrl(e)} alt="" draggable="false" />)}
      {total > 1 && <span>{total}</span>}
    </button>
  );
}

/* One message row. Hold it (or right-click) for the menu, swipe it right to reply. */
function Row({ id, side, first, pop, onHold, onSwipe, onTap, children }) {
  const ref = useRef(null);
  const g = useRef(null);
  const dxRef = useRef(0);
  const [dx, setDx] = useState(0);
  const offset = (v) => { dxRef.current = v; setDx(v); };
  const hold = () => onHold?.(ref.current?.querySelector('.bubble, .media-msg'));

  const down = (e) => {
    g.current = null;
    if ((!onHold && !onSwipe) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const s = { x: e.clientX, y: e.clientY, id: e.pointerId };
    if (onHold) s.t = setTimeout(() => { s.fired = true; navigator.vibrate?.(12); hold(); }, HOLD_MS);
    g.current = s;
  };
  const move = (e) => {
    const s = g.current;
    if (!s || s.fired || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.swiping) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      clearTimeout(s.t);
      if (!onSwipe || mx <= 0 || Math.abs(mx) < Math.abs(my) * 1.4) { g.current = null; return; }
      s.swiping = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    const v = Math.max(0, Math.min(mx - 8, SWIPE + 28));
    if (v >= SWIPE && dxRef.current < SWIPE) navigator.vibrate?.(8);
    offset(v);
  };
  const up = () => {
    const s = g.current;
    if (!s) return;
    clearTimeout(s.t);
    if (s.swiping) {
      if (dxRef.current >= SWIPE) onSwipe();
      offset(0);
      g.current = { fired: true };
    } else if (!s.fired) g.current = null;
  };
  // The click that ends a hold or a swipe shouldn't also count as a tap.
  const click = (e) => {
    if (!g.current?.fired) return;
    e.preventDefault(); e.stopPropagation();
    g.current = null;
  };
  const context = (e) => {
    e.preventDefault();
    if (!onHold || g.current?.fired) return;
    clearTimeout(g.current?.t);
    g.current = { fired: true };
    hold();
  };
  const p = Math.min(1, dx / SWIPE);
  return (
    <div ref={ref} id={`m-${id}`} className={`row-msg ${side} ${first ? 'first' : ''} ${pop ? 'pop' : ''} ${dx ? 'swiping' : ''}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerLeave={(e) => e.pointerType === 'mouse' && !g.current?.swiping && up()}
      onClickCapture={click} onContextMenu={context}>
      <div className="msg-col" style={dx ? { transform: `translateX(${dx}px)` } : undefined} onClick={onTap}>
        {dx > 0 && <span className="swipe-reply" style={{ opacity: p, transform: `scale(${0.5 + p * 0.5})` }}><Icon name="reply" size={18} /></span>}
        {children}
      </div>
    </div>
  );
}

/* Held message: it lifts out of the chat, with reactions above it and actions below. */
function MessageMenu({ at, side, canReact, reactions, meId, names, onReact, actions, onClose, children }) {
  const [all, setAll] = useState(false);
  const [ask, setAsk] = useState(null);
  // Lifting the finger that opened the menu isn't a tap on it: only a new touch (or a key) does anything.
  const armed = useRef(false);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const vv = window.visualViewport;
  const vTop = vv?.offsetTop || 0;
  const vh = vv?.height || window.innerHeight;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const who = Object.entries(reactions || {});
  const barH = canReact ? (all ? 104 : 52) + 8 : 0;
  const menuH = 8 + (ask ? 112 : actions.length * 46) + (who.length ? who.length * 30 + 16 : 0);
  const clamp = at.height > vh * 0.38;
  const h = clamp ? vh * 0.38 : at.height;
  const top = Math.max(vTop + 56 + barH, Math.min(at.top, vTop + vh - 16 - menuH - h));
  const place = side === 'out' ? { right: Math.max(10, vw - at.right) } : { left: Math.max(10, at.left) };
  const mine = (e) => (reactions?.[e] || []).includes(meId);
  return createPortal(
    <div className="focus-layer" onPointerDown={() => { armed.current = true; }} onContextMenu={(e) => e.preventDefault()}
      onClickCapture={(e) => { if (!armed.current && e.detail !== 0) { e.stopPropagation(); e.preventDefault(); } }} onClick={onClose}>
      <div className={`focus ${side}`} style={{ top, width: at.width, ...place }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Message options">
        {canReact && (
          <div className={`react-bar ${all ? 'all' : ''}`}>
            {(all ? EMOJI.map((e) => e.id) : QUICK).map((e) => (
              <button key={e} type="button" className={mine(e) ? 'on' : ''} onClick={() => onReact(e)} aria-label={`React with ${e}`} aria-pressed={mine(e)}>
                <img src={emojiUrl(e)} alt="" draggable="false" />
              </button>
            ))}
            {!all && <button type="button" className="more" onClick={() => setAll(true)} aria-label="More reactions"><Icon name="plus" size={20} /></button>}
          </div>
        )}
        <div className={`focus-msg ${clamp ? 'clamp' : ''}`} style={clamp ? { maxHeight: h } : undefined}>{children}</div>
        <div className="focus-menu">
          {who.length > 0 && (
            <div className="focus-who">
              {who.map(([e, ids]) => <div key={e}><img src={emojiUrl(e)} alt={e} draggable="false" /><span className="ellipsis">{names(ids)}</span></div>)}
            </div>
          )}
          {ask ? (
            <div className="focus-ask">
              <p>{ask.confirm}</p>
              <div className="row gap">
                <button type="button" className="btn grow" onClick={() => setAsk(null)}>Cancel</button>
                <button type="button" className="btn danger grow" onClick={ask.run}>Delete</button>
              </div>
            </div>
          ) : actions.map((a) => (
            <button key={a.label} type="button" className={a.danger ? 'danger-text' : ''} onClick={a.confirm ? () => setAsk(a) : a.run}>
              {a.label}<Icon name={a.icon} size={20} />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const SKELETON = [['in', 58, 36], ['in', 36, 36], ['out', 52, 50], ['in', 66, 50], ['out', 34, 36], ['out', 60, 36], ['in', 44, 36]];

export function ChatView({ convId: id }) {
  const { me, friends, navigate, toast, loadUnread, prefs } = useApp();
  const enterSends = prefs.enter_sends !== false;
  const [qs, setQs] = useSearchParams();
  const [conv, setConv] = useState(null);
  // Who you are, from the chat itself too, so nothing waits for the profile to load.
  const self = me || conv?.members.find((u) => u.me) || null;
  const meId = self?.id;
  const [msgs, setMsgs] = useState([]);
  const [more, setMore] = useState(false);
  const [older, setOlder] = useState(false);
  const [text, setText] = useState(qs.get('draft') || '');
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState(null); // Planner's answer while it's being written
  const [typing, setTyping] = useState(null);
  const [attach, setAttach] = useState(false);
  const [picker, setPicker] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [menu, setMenu] = useState(null);
  const [photos, setPhotos] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [editing, setEditing] = useState(null); // your message being edited
  const [search, setSearch] = useState(qs.get('search') ? { q: '', results: [], i: 0 } : null);
  const fileRef = useRef(null);
  const docRef = useRef(null);
  const [jump, setJump] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const lastTyping = useRef(0);
  const typingTimer = useRef(null);
  const freshIds = useRef(new Set());
  const initialIds = useRef(null);
  const nearEnd = useRef(true);
  const autoAt = useRef(0);
  const anchor = useRef(null);
  const placed = useRef(false);
  const lastKey = useRef(null);
  const lastHeight = useRef(0);
  const unreadMark = useRef(null);
  const loadingOlder = useRef(false);
  const draftRef = useRef(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;

  const markRead = () => post(`/conversations/${id}/read`).then(loadUnread).catch(() => {});

  useEffect(() => {
    let live = true;
    // The last visit's messages show at once; the fresh copy replaces them a moment later.
    const hit = cachedMessages(id);
    if (hit?.conv) {
      initialIds.current = new Set(hit.msgs.map((m) => m.id));
      setConv(hit.conv); setMsgs(hit.msgs); setMore(hit.msgs.length >= 40);
    }
    Promise.all([get(`/conversations/${id}`), get(`/conversations/${id}/messages`)]).then(async ([c, r]) => {
      // Where you left off: the first message that came in since you last read this chat.
      const myId = c.conversation.members.find((u) => u.me)?.id;
      const seen = c.conversation.reads?.[myId] || '';
      const isNew = (m) => m.sender_id !== myId && m.kind !== 'system' && m.created_at > seen;
      const unread = c.conversation.unread;
      const shown = r.messages.filter(isNew).length;
      // Lots came in: load back far enough to start at the first one you haven't seen.
      if (unread > shown && r.more && r.messages.length) {
        const back = await get(`/conversations/${id}/messages?before=${encodeURIComponent(r.messages[0].created_at)}&limit=${Math.min(200, unread - shown + 5)}`).catch(() => null);
        if (back) r = { messages: [...back.messages, ...r.messages], more: back.more };
      }
      if (!live) return;
      const firstNew = unread > 0 && r.messages.find(isNew);
      // Only worth a line when there's earlier conversation above it.
      const above = firstNew && (r.more || r.messages.slice(0, r.messages.indexOf(firstNew)).some((m) => m.kind !== 'system'));
      unreadMark.current = above ? { id: firstNew.id, n: unread } : null;
      if (unreadMark.current) placed.current = false; // open at the unread line, even if the cached copy showed first
      initialIds.current = new Set([...(initialIds.current || []), ...r.messages.map((m) => m.id)]);
      setConv(c.conversation);
      // Keep anything you started sending in the meantime.
      setMsgs((x) => [...r.messages, ...x.filter((m) => (m.pending || m.failed) && !r.messages.some((y) => y.id === m.id))]);
      setMore(!!r.more);
      markRead();
      const target = qs.get('m');
      if (target) { setQs({}, { replace: true }); setTimeout(() => reveal(target), 120); }
    }).catch(() => live && navigate('/', { replace: true }));
    // Reading the chat clears its notifications from the lock screen.
    navigator.serviceWorker?.ready.then((r) => r.getNotifications({ tag: `chat-${id}` })).then((ns) => ns?.forEach((n) => n.close())).catch(() => {});
    if (qs.get('draft')) { setText(qs.get('draft')); setQs({}, { replace: true }); setTimeout(() => inputRef.current?.focus(), 300); }
    if (qs.get('ask') || qs.get('search')) setQs({}, { replace: true });
    return () => { live = false; };
  }, [id]); // eslint-disable-line

  // Asked from the Chats search: send it once the chat is open.
  const askRef = useRef(qs.get('ask'));
  useEffect(() => {
    if (!conv || !askRef.current) return;
    const q = askRef.current;
    askRef.current = null;
    sendText(q);
  }, [conv]); // eslint-disable-line

  const toEnd = (animate) => {
    const el = listRef.current;
    if (!el) return;
    nearEnd.current = true;
    autoAt.current = Date.now();
    if (animate && smooth()) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
    setUnseen(0);
  };

  // Scroll: open where you left off, follow new messages only if you're already at the bottom
  // (or you sent it), and keep your place when older messages load in above.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !conv) return;
    if (anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.h + anchor.current.top;
      anchor.current = null;
      lastHeight.current = el.scrollHeight;
      return;
    }
    const last = msgs[msgs.length - 1];
    const appended = keyOf(last) !== lastKey.current;
    lastKey.current = keyOf(last);
    if (!placed.current) {
      placed.current = true;
      const mark = unreadMark.current && document.getElementById('unread-mark');
      if (mark) el.scrollTop += mark.getBoundingClientRect().top - el.getBoundingClientRect().top - 48;
      else el.scrollTop = el.scrollHeight;
      nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      lastHeight.current = el.scrollHeight;
      return;
    }
    const grew = el.scrollHeight !== lastHeight.current;
    lastHeight.current = el.scrollHeight;
    if (appended && last?.pending) return toEnd(true); // you just sent it from here
    if (nearEnd.current && (appended || grew)) return toEnd(appended);
    if (appended && last) setUnseen((n) => n + 1);
  }, [msgs, conv, thinking, typing, draft]); // eslint-disable-line

  const loadOlder = async () => {
    const oldest = msgs.find((m) => !m.pending && !m.failed);
    if (!oldest || loadingOlder.current) return;
    loadingOlder.current = true; setOlder(true);
    try {
      const r = await get(`/conversations/${id}/messages?before=${encodeURIComponent(oldest.created_at)}`);
      const el = listRef.current;
      if (el) anchor.current = { h: el.scrollHeight, top: el.scrollTop };
      r.messages.forEach((m) => initialIds.current?.add(m.id));
      setMsgs((x) => [...r.messages.filter((m) => !x.some((y) => y.id === m.id)), ...x]);
      setMore(!!r.more);
    } catch { /* the next scroll tries again */ } finally { loadingOlder.current = false; setOlder(false); }
  };

  // Show a message that may not be loaded yet (from search, starred or media): load back until it's there.
  const reveal = async (mid) => {
    for (let i = 0; i < 12; i++) {
      if (document.getElementById(`m-${mid}`)) return jumpTo(mid);
      const oldest = msgsRef.current.find((m) => !m.pending && !m.failed);
      if (!oldest) break;
      const r = await get(`/conversations/${id}/messages?before=${encodeURIComponent(oldest.created_at)}&limit=200`).catch(() => null);
      if (!r || !r.messages.length) break;
      r.messages.forEach((m) => initialIds.current?.add(m.id));
      const el = listRef.current;
      if (el) anchor.current = { h: el.scrollHeight, top: el.scrollTop };
      setMsgs((x) => [...r.messages.filter((m) => !x.some((y) => y.id === m.id)), ...x]);
      setMore(!!r.more);
      await wait(80);
      if (!r.more && !document.getElementById(`m-${mid}`)) break;
    }
    if (document.getElementById(`m-${mid}`)) jumpTo(mid);
    else toast({ title: "Couldn't find that message", body: 'It may have been cleared' });
  };

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    // A smooth scroll to the bottom passes through "not at the bottom"; don't let that count.
    if (dist < 150 || Date.now() - autoAt.current > 700) nearEnd.current = dist < 150;
    if ((dist > 360) !== jump) setJump(dist > 360);
    if (dist < 150 && unseen) setUnseen(0);
    if (more && el.scrollTop < 400) loadOlder();
  };

  /** Add a message, or swap in the server's copy of one we're already showing (by id, or by client_id for our own). */
  const upsert = (m) => setMsgs((x) => {
    const byId = x.findIndex((y) => y.id === m.id);
    const byCid = m.client_id ? x.findIndex((y) => y.client_id === m.client_id && y.id !== m.id) : -1;
    const keep = x[byCid]?.local || x[byId]?.local; // keep showing the local copy of a photo or voice message
    const merged = { ...m, client_id: x[byCid]?.client_id || x[byId]?.client_id || m.client_id, ...(keep ? { local: keep } : {}) };
    if (byId < 0 && byCid < 0) return [...x, m];
    const next = x.slice();
    if (byId >= 0) { next[byId] = merged; if (byCid >= 0) next.splice(byCid, 1); }
    else next[byCid] = merged;
    return next;
  });
  useEffect(() => { if (conv && msgs.length) cacheMessages(id, conv, msgs); }, [msgs, conv]); // eslint-disable-line

  useSocket('message', (m) => {
    if (m.conversation_id !== id) return;
    // Planner's words appear one by one, unless they already streamed in.
    if (!m.sender_id) { if (m.kind === 'ai' && draftRef.current) { draftRef.current = null; setDraft(null); } else freshIds.current.add(m.id); }
    upsert(m);
    if (m.sender_id !== meId) markRead();
    if (m.sender_id) setTyping((t) => (t?.id === m.sender_id ? null : t));
  });
  useSocket('message:update', (m) => {
    if (m.conversation_id !== id) return;
    setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, ...m } : y)));
    if (m.kind === 'deleted') {
      setReplyTo((r) => (r?.id === m.id ? null : r));
      setMenu((x) => (x?.m.id === m.id ? null : x));
    }
  });
  useSocket('message:react', (p) => p.conversation_id === id && setMsgs((x) => x.map((y) => (y.id === p.message_id ? { ...y, reactions: p.reactions } : y))));
  useSocket('ai:thinking', (p) => {
    if (p.conversation_id !== id) return;
    setThinking(p.on);
    if (!p.on) { draftRef.current = null; setDraft(null); }
  });
  useSocket('ai:stream', (p) => {
    if (p.conversation_id !== id || (draftRef.current && draftRef.current.seq >= p.seq)) return;
    draftRef.current = p;
    setDraft(p.text);
  });
  useSocket('read', (p) => p.conversation_id === id && setConv((c) => c && { ...c, reads: { ...c.reads, [p.user_id]: p.at } }));
  useSocket('typing', (p) => {
    if (p.conversation_id !== id) return;
    setTyping(p.user);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(null), 3000);
  });
  useSocket('presence', (p) => setConv((c) => c && { ...c, members: c.members.map((m) => (m.id === p.id && !m.me ? p : m)) }));

  // The box grows with what you write, up to about five lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 124)}px`;
  }, [text]);
  const onType = (e) => {
    setText(e.target.value);
    if (Date.now() - lastTyping.current > 2000) { lastTyping.current = Date.now(); post(`/conversations/${id}/typing`).catch(() => {}); }
  };

  const nameOf = (uid) => (uid === meId ? 'You' : conv?.members.find((u) => u.id === uid)?.display_name.split(' ')[0] || 'Someone');
  const replyData = (m) => ({
    id: m.id, kind: m.kind, body: String(m.body || '').slice(0, 140), sender_id: m.sender_id,
    sender_name: m.sender_id ? (m.sender_id === meId ? self?.display_name : m.sender?.display_name) : 'Planner',
    ...(m.data?.ref ? { ref: m.data.ref } : {}),
    ...(m.kind === 'image' && m.data?.thumb ? { thumb: m.data.thumb } : {}),
    ...(m.kind === 'voice' ? { duration: m.data?.duration || 0 } : {}),
  });

  // Sending: the message shows at once with a clock, and the server's copy replaces it (matched by client_id).
  // If it fails it stays, marked "Not sent", until you tap it or the phone comes back online.
  const deliver = async (t, after) => {
    setMsgs((x) => [...x.filter((y) => y.id !== t.id), { ...t, pending: true, failed: false }]);
    const patchMsg = (p) => setMsgs((x) => x.map((y) => (y.id === t.id ? { ...y, ...p } : y)));
    if (after) await after; // several photos at once go out in the order they were picked
    try {
      let req = t.req;
      // Photos and voice messages upload first; a retry after that only resends the message.
      if (t.file && !req.media) {
        let shown = 0;
        const media = await uploadMedia(id, t.file, (p) => { if (p - shown >= 0.1 || p === 1) { shown = p; patchMsg({ progress: p }); } }, t.fileName);
        req = { ...req, media: media.id };
        patchMsg({ req });
      }
      const r = await post(`/conversations/${id}/messages`, { ...req, client_id: t.client_id });
      upsert(r.message);
    } catch (x) {
      setMsgs((xs) => xs.map((y) => (y.id === t.id ? { ...y, pending: false, failed: true } : y)));
      if (/can't message|blocked/i.test(x?.message || '')) toast({ title: 'Not sent', body: x.message });
    }
  };
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;
  useEffect(() => {
    const retry = () => msgsRef.current.filter((m) => m.failed).forEach((m) => deliverRef.current(m));
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);

  const queue = (req, local, quoting = replyTo, after = null) => {
    const cid = newId();
    const data = { ...(local.data || {}) };
    if (quoting) { req = { ...req, reply_to: quoting.id }; data.reply = replyData(quoting); }
    setReplyTo(null);
    unreadMark.current = null;
    return deliver({
      ...local, id: `tmp-${cid}`, client_id: cid, conversation_id: id, sender_id: meId, sender: self,
      created_at: new Date().toISOString(), reactions: {}, data: Object.keys(data).length ? data : null, req,
    }, after);
  };
  const sendText = (body) => {
    body = body.trim();
    if (!body) return;
    setText('');
    queue({ body }, { kind: 'text', body });
  };
  const send = (e) => { e?.preventDefault(); if (editing) saveEdit(); else sendText(text); inputRef.current?.focus(); };
  // Emoji go into the text at the cursor; stickers and GIFs send at once.
  const addEmoji = (eid) => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? text.length;
    const code = `:${eid}:`;
    setText((t) => t.slice(0, at) + code + t.slice(at));
    setPicker(false);
    setTimeout(() => { el?.focus(); el?.setSelectionRange(at + code.length, at + code.length); }, 250);
  };
  const sendArt = (kind, ref) => {
    setPicker(false);
    queue({ kind, ref }, { kind, body: kind === 'gif' ? 'GIF' : 'Sticker', data: { ref } });
  };
  // Photos: pick, look them over with a caption, send (caption goes with the first).
  const pickPhotos = () => { setAttach(false); fileRef.current?.click(); };
  const onPicked = (e) => {
    const files = [...(e.target.files || [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    e.target.value = '';
    if (files.length) setPhotos(files);
  };
  const sendPhotos = (items, caption) => {
    items.reduce((prev, p, i) => queue(
      { kind: 'image', w: p.w, h: p.h, thumb: p.thumb, body: i === 0 ? caption : '' },
      { kind: 'image', body: i === 0 ? caption : '', data: { w: p.w, h: p.h, thumb: p.thumb }, local: p.local, file: p.blob },
      i === 0 ? replyTo : null, prev,
    ), null);
  };
  // Voice messages: tap the mic, talk, tap send (or the bin).
  const sendVoice = async () => {
    const v = await rec.stop();
    if (!v) return;
    if (v.duration < 0.7) return toast({ title: 'Too short', body: 'Tap the mic, talk, then tap send' });
    queue({ kind: 'voice', duration: v.duration, wave: v.wave }, { kind: 'voice', body: '', data: { duration: v.duration, wave: v.wave }, local: URL.createObjectURL(v.blob), file: v.blob });
  };
  const rec = useRecorder({ onLimit: () => sendVoice() });
  const startVoice = async () => {
    try { await rec.start(); navigator.vibrate?.(15); }
    catch (x) { toast({ title: 'Voice message', body: x.message }); }
  };

  const startReply = (m) => {
    setMenu(null);
    setReplyTo(m);
    inputRef.current?.focus();
  };
  const react = async (m, emoji) => {
    setMenu(null);
    const before = m.reactions || {};
    const set = (r) => setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, reactions: r } : y)));
    set(toggleReaction(before, emoji, meId));
    navigator.vibrate?.(8);
    try { set((await post(`/messages/${m.id}/react`, { emoji })).reactions); }
    catch (x) { set(before); toast({ title: 'Could not react', body: x.message }); }
  };
  const copy = async (m) => {
    setMenu(null);
    toast({ title: (await copyText(m.body)) ? 'Copied' : 'Could not copy' });
  };
  const remove = async (m) => {
    setMenu(null);
    if (m.failed) { setMsgs((x) => x.filter((y) => y.id !== m.id)); return; }
    if (replyTo?.id === m.id) setReplyTo(null);
    setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, kind: 'deleted', body: '', data: null, reactions: {} } : y)));
    try { await del(`/messages/${m.id}`); }
    catch (x) { setMsgs((xs) => xs.map((y) => (y.id === m.id ? m : y))); toast({ title: 'Could not delete', body: x.message }); }
  };
  const jumpTo = (mid) => {
    const el = document.getElementById(`m-${mid}`);
    if (!el) return toast({ title: 'That message is further back' });
    el.scrollIntoView({ block: 'center', behavior: smooth() ? 'smooth' : 'auto' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the highlight
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  };
  const openMenu = (m, el, side, first) => el && setMenu({ m, at: el.getBoundingClientRect(), side, first });

  // Search in the chat: newest match first, arrows step through them.
  const searchTimer = useRef(null);
  const runSearch = (q) => {
    setSearch((s) => ({ ...s, q }));
    clearTimeout(searchTimer.current);
    if (q.trim().length < 2) return setSearch((s) => ({ ...s, results: [], i: 0, done: false }));
    searchTimer.current = setTimeout(async () => {
      const r = await get(`/conversations/${id}/search?q=${encodeURIComponent(q.trim())}`).catch(() => ({ results: [] }));
      setSearch((s) => (s && s.q === q ? { ...s, results: r.results, i: 0, done: true } : s));
      if (r.results[0]) reveal(r.results[0].id);
    }, 280);
  };
  const stepSearch = (d) => setSearch((s) => {
    if (!s?.results.length) return s;
    const i = (s.i + d + s.results.length) % s.results.length;
    reveal(s.results[i].id);
    return { ...s, i };
  });

  const star = async (m) => {
    setMenu(null);
    const on = !m.starred;
    setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, starred: on } : y)));
    try { await post(`/messages/${m.id}/star`); toast({ title: on ? 'Starred' : 'Unstarred', icon: 'star', ms: 1600 }); }
    catch (x) { setMsgs((xs) => xs.map((y) => (y.id === m.id ? { ...y, starred: !on } : y))); toast({ title: 'Could not star', body: x.message }); }
  };
  const startEdit = (m) => {
    setMenu(null); setReplyTo(null);
    setEditing(m);
    setText(m.body || '');
    setTimeout(() => inputRef.current?.focus(), 60);
  };
  const saveEdit = async () => {
    const m = editing;
    const body = text.trim();
    if (!m) return;
    setEditing(null); setText('');
    if (!body || body === m.body) return;
    setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, body, edited_at: new Date().toISOString() } : y)));
    try { upsert((await patch(`/messages/${m.id}`, { body })).message); }
    catch (x) { setMsgs((xs) => xs.map((y) => (y.id === m.id ? m : y))); toast({ title: 'Could not edit', body: x.message }); }
  };
  const cancelEdit = () => { setEditing(null); setText(''); };

  // Documents: PDFs, Word, Excel, slides, text, zip. Up to 4 MB.
  const pickDoc = () => { setAttach(false); docRef.current?.click(); };
  const onDoc = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 4e6) return toast({ title: 'That file is too big', body: 'Documents can be up to 4 MB' });
    queue({ kind: 'file' }, { kind: 'file', body: f.name, data: { name: f.name, size: f.size, type: f.type }, file: f, fileName: f.name });
  };

  // The orb with something typed: ask Planner that, right here in the chat.
  const askPlanner = () => {
    const q = text.trim();
    if (!q) return;
    sendText(/(^|\s)@(ai|planner)\b/i.test(q) ? q : `@Planner ${q}`);
    inputRef.current?.focus();
  };
  const askAbout = (m) => {
    setMenu(null);
    setReplyTo(m);
    setText((t) => (/@planner/i.test(t) ? t : `@Planner ${t}`));
    inputRef.current?.focus();
  };
  const planIt = async () => {
    setAttach(false);
    try { await post(`/conversations/${id}/plan`); } catch (x) { toast({ title: 'Planner', body: x.message }); }
  };
  const callAll = async () => {
    const ids = conv.members.filter((m) => !m.me).map((m) => m.id);
    try { const r = await post('/invites', { to_ids: ids, kind: 'call' }); navigate(`/call/${r.room_id}`); }
    catch (x) { toast({ title: 'Could not call', body: x.message }); }
  };
  const chill = async () => {
    setAttach(false);
    const ids = conv.members.filter((m) => !m.me).map((m) => m.id);
    try { await post('/invites', { to_ids: ids, kind: 'chill', message: text.trim() }); setText(''); toast({ title: 'Chill invite sent' }); }
    catch (x) { toast({ title: 'Could not send', body: x.message }); }
  };
  const openEvent = (eid) => navigate(`/event/${eid}`);

  // Placeholder bubbles while the chat loads.
  if (!conv) return (
    <div className="chat">
      <header className="chat-header">
        <button className="back-btn" onClick={() => navigate('/')} aria-label="Back"><Icon name="left" size={26} /></button>
        <span className="chat-who">
          <span className="skel round" style={{ width: 38, height: 38 }} />
          <span className="grow"><span className="skel line" style={{ width: '42%' }} /><span className="skel line sm" style={{ width: '26%' }} /></span>
        </span>
      </header>
      <div className="messages-wrap">
        <div className="messages wallpaper skel-list" aria-busy="true" aria-label="Loading messages">
          {SKELETON.map(([side, w, h], i) => (
            <div key={i} className={`row-msg ${side} ${i === 0 || SKELETON[i - 1][0] !== side ? 'first' : ''}`}>
              <div className="bubble skel" style={{ width: `${w}%`, height: h }} />
            </div>
          ))}
        </div>
      </div>
      <div className="composer"><div className="input-pill"><span className="muted">Message</span></div><span className="send" style={{ opacity: 0.35 }}><Icon name="send" size={20} /></span></div>
    </div>
  );

  const planner = !!conv.is_ai;
  const recording = rec.state !== 'idle';
  const voiceOk = !planner && canRecord();
  const others = conv.members.filter((m) => !m.me);
  const blockedOther = !conv.is_group && !planner && others[0]?.blocked;
  const planMembers = planner ? [self, ...friends.friends].filter(Boolean) : conv.members;
  const sub = planner ? (thinking ? (draft ? 'writing…' : 'thinking…') : 'ask me anything, I plan too')
    : typing ? `${conv.is_group ? `${typing.display_name.split(' ')[0]} is ` : ''}typing…`
    : conv.kind === 'announcements' ? `Announcements · ${conv.members.length} member${conv.members.length === 1 ? '' : 's'}`
    : conv.is_group ? others.map((m) => m.display_name.split(' ')[0]).join(', ') + ', You'
    : lastSeen(others[0]);

  const tickFor = (m) => {
    if (m.pending) return <Icon name="clock" size={13} className="tick pending" />;
    if (m.failed) return <Icon name="alert" size={15} className="tick failed" />;
    const readAll = others.length && others.every((u) => (conv.reads?.[u.id] || '') >= m.created_at);
    if (readAll) return <Icon name="ticks" size={16} className="tick read" />;
    if (others.some((u) => u.online)) return <Icon name="ticks" size={16} className="tick" />;
    return <Icon name="tick" size={16} className="tick" />;
  };

  const userMsgs = msgs.filter((m) => m.sender_id).length;
  const f1 = friends.friends[0]?.display_name.split(' ')[0];
  const starters = planner && userMsgs === 0 ? [
    f1 ? `Padel with ${f1} this weekend` : 'Braai this Saturday',
    'When is everyone free next week?',
    'Ideas for a fun Friday night',
    'Help me write a birthday message',
    'Remind me to book flights Monday 9am',
  ] : [];
  const lastAi = [...msgs].reverse().find((m) => !m.sender_id && m.kind !== 'system');
  const quick = planner && lastAi?.kind === 'plan' && lastAi.data?.status !== 'created'
    ? ['Make it earlier', 'Invite everyone', 'Remind me a day before'] : [];
  const nameColor = (u) => u?.color || 'var(--accent)';
  const quoteColor = (q) => (!q.sender_id || q.sender_id === meId ? 'var(--accent)' : nameColor(conv.members.find((u) => u.id === q.sender_id)));

  const bubble = (m, first, clone = false) => {
    const mine = m.sender_id === meId;
    const ai = m.kind === 'ai';
    const reply = m.data?.reply;
    const meta = (
      <span className="meta">{m.starred && <Icon name="star" size={11} className="star-ic" />}{m.edited_at && <span className="edited">edited</span>}
        {fmtTime(m.created_at)}{mine && tickFor(m)}</span>
    );
    const who = first && !mine && (conv.is_group || (ai && !planner)) && (
      <span className="who" style={{ color: ai ? 'var(--accent)' : nameColor(m.sender) }}>{ai ? 'Planner' : m.sender?.display_name}</span>
    );
    const quote = reply && <Quote q={reply} me={self} color={quoteColor(reply)} onClick={clone ? undefined : () => reveal(reply.id)} />;
    if (m.kind === 'deleted') return (
      <div className="bubble deleted">
        <span className="text"><Icon name="block" size={15} />{mine ? 'You deleted this message' : 'This message was deleted'}</span>{meta}
      </div>
    );
    if (isMedia(m.kind)) return (
      <div className={`media-msg ${m.kind}`}>
        {who}{quote}
        <img src={m.kind === 'gif' ? gifUrl(m.data?.ref) : stickerUrl(m.data?.ref)} alt={m.body} draggable="false" />
        {meta}
      </div>
    );
    if (m.kind === 'image') {
      const size = photoSize(m.data?.w, m.data?.h);
      const src = m.local || mediaUrl(m.data?.url);
      return (
        <div className={`bubble photo ${m.body ? 'captioned' : ''}`}>
          {who}{quote}
          <button type="button" className="photo-frame" style={{ width: size.w, height: size.h }} onClick={clone || m.pending ? undefined : () => setViewer(m)} aria-label="Open photo">
            {m.data?.thumb && <img className="photo-blur" src={m.data.thumb} alt="" draggable="false" />}
            {src && <img className="photo-img" src={src} alt={m.body || 'Photo'} draggable="false" onLoad={(e) => e.currentTarget.classList.add('in')} />}
            {m.pending && <span className="photo-progress" style={{ '--p': m.progress || 0 }}><i /></span>}
            {!m.body && <span className="meta on-photo">{fmtTime(m.created_at)}{mine && tickFor(m)}</span>}
          </button>
          {m.body && <><span className="text"><RichText text={m.body} /></span>{meta}</>}
        </div>
      );
    }
    if (m.kind === 'file') return (
      <div className="bubble doc-bubble">
        {who}{quote}
        <DocCard m={m} clone={clone} />
        {meta}
      </div>
    );
    if (m.kind === 'voice') return (
      <div className="bubble voice-bubble">
        {who}{quote}
        <VoiceNote m={m} clone={clone} />
        {meta}
      </div>
    );
    const big = !ai && !reply && emojiOnly(m.body);
    return (
      <div className={`bubble ${ai && !planner ? 'ai' : ''} ${big ? `jumbo n${big}` : ''}`}>
        {who}{quote}
        <span className="text">{ai && !search ? (clone ? m.body : <Reveal text={m.body} fresh={freshIds.current.has(m.id)} />) : <RichText text={m.body} highlight={search?.q.trim()} />}</span>
        {meta}
      </div>
    );
  };

  const renderMsg = (m, first) => {
    if (m.kind === 'system') return <div key={keyOf(m)} className="sys"><span>{m.body}</span></div>;
    const isNew = initialIds.current && !initialIds.current.has(m.id);
    if (m.kind === 'plan') return (
      <div key={keyOf(m)} id={`m-${m.id}`} className={`row-msg in ${first ? 'first' : ''} ${isNew ? 'pop' : ''}`}>
        <PlanCard msg={m} members={planMembers} onDone={openEvent} />
      </div>
    );
    const side = m.sender_id === meId ? 'out' : 'in';
    const live = !m.pending && m.kind !== 'deleted';
    return (
      <Row key={keyOf(m)} id={m.id} side={side} first={first} pop={isNew}
        onHold={live ? (el) => openMenu(m, el, side, first) : null}
        onSwipe={live && !m.failed ? () => startReply(m) : null}
        onTap={m.failed ? () => deliver(m) : undefined}>
        {bubble(m, first)}
        {m.kind !== 'deleted' && (
          <ReactPill r={m.reactions} meId={meId}
            onOpen={(e) => { e.stopPropagation(); openMenu(m, e.currentTarget.closest('.row-msg')?.querySelector('.bubble, .media-msg'), side, first); }} />
        )}
        {m.failed && <span className="failed-note"><Icon name="alert" size={14} />Not sent. Tap to try again</span>}
      </Row>
    );
  };

  // Group by day so each date label sticks to the top while you scroll through that day.
  const days = [];
  for (const m of msgs) {
    const d = dayKey(m.created_at);
    if (days[days.length - 1]?.d !== d) days.push({ d, at: m.created_at, list: [] });
    days[days.length - 1].list.push(m);
  }
  const mark = unreadMark.current;
  const menuMsg = menu && (msgs.find((y) => y.id === menu.m.id) || menu.m);
  const menuActions = (m) => (m.failed ? [
    { label: 'Try again', icon: 'send', run: () => { setMenu(null); deliver(m); } },
    { label: 'Delete', icon: 'trash', danger: true, run: () => remove(m) },
  ] : [
    { label: 'Reply', icon: 'reply', run: () => startReply(m) },
    m.sender_id === meId && m.kind === 'text' && Date.now() - Date.parse(m.created_at) < EDIT_MS && { label: 'Edit', icon: 'edit', run: () => startEdit(m) },
    { label: m.starred ? 'Unstar' : 'Star', icon: 'star', run: () => star(m) },
    !planner && m.sender_id && { label: 'Ask Planner', icon: 'spark', run: () => askAbout(m) },
    (m.kind === 'text' || m.kind === 'ai' || (m.kind === 'image' && m.body)) && { label: m.kind === 'image' ? 'Copy caption' : 'Copy', icon: 'copy', run: () => copy(m) },
    m.kind === 'image' && m.data?.url && { label: 'Save photo', icon: 'download', run: () => { setMenu(null); savePhoto(m.data.url).catch(() => toast({ title: "Couldn't save the photo" })); } },
    m.kind === 'file' && m.data?.url && { label: 'Download', icon: 'download', run: () => { setMenu(null); window.open(mediaUrl(m.data.url), '_blank'); } },
    m.sender_id === meId && { label: 'Delete for everyone', icon: 'trash', danger: true, confirm: 'Delete this message for everyone?', run: () => remove(m) },
  ].filter(Boolean));

  return (
    <div className="chat">
      {search ? (
        <header className="chat-header search-head">
          <label className="search grow">
            <Icon name="search" size={18} />
            <input autoFocus value={search.q} onChange={(e) => runSearch(e.target.value)} placeholder="Search this chat" aria-label="Search this chat"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); stepSearch(1); } if (e.key === 'Escape') setSearch(null); }} />
          </label>
          <span className="search-count muted small">{search.results.length ? `${search.i + 1} of ${search.results.length}` : search.done ? 'None' : ''}</span>
          <button className="icon-plain sm" disabled={!search.results.length} onClick={() => stepSearch(1)} aria-label="Older match"><Icon name="up" size={22} /></button>
          <button className="icon-plain sm" disabled={!search.results.length} onClick={() => stepSearch(-1)} aria-label="Newer match"><Icon name="down" size={22} /></button>
          <button className="link" onClick={() => setSearch(null)}>Done</button>
        </header>
      ) : (
      <header className="chat-header">
        <button className="back-btn" onClick={() => navigate('/')} aria-label="Back"><Icon name="left" size={26} /></button>
        <button className="chat-who plain" onClick={() => !planner && navigate(`/chat/${id}/info`)} aria-label={planner ? undefined : 'Contact info'}>
          {planner ? <Orb size={38} state={thinking ? 'thinking' : 'idle'} /> : conv.is_group
            ? <GroupAvatar conv={conv} size={38} />
            : <Avatar user={others[0]} size={38} />}
          <span className="grow">
            <b className="ellipsis">{planner ? 'Planner' : conv.title}{conv.muted && <Icon name="bellOff" size={14} className="muted inline-ic" />}</b>
            <small className={`ellipsis ${typing || (thinking && planner) ? 'accent' : ''}`}>{sub}</small>
          </span>
        </button>
        {!planner && <>
          <button className="icon-plain" onClick={callAll} aria-label="Video call"><Icon name="video" size={24} /></button>
          <button className="icon-plain" onClick={callAll} aria-label="Call"><Icon name="phone" size={22} /></button>
        </>}
      </header>
      )}

      <div className="messages-wrap">
        <div className={`messages wallpaper ${conv.theme ? `theme-${conv.theme}` : ''}`} ref={listRef} onScroll={onScroll}>
          {more && <div className="older">{older && <span className="spinner sm" />}</div>}
          {days.map(({ d, at, list }) => {
            let prev = null;
            return (
              <section className="day" key={d}>
                <div className="day-sep"><span>{relDay(at)}</span></div>
                {list.flatMap((m) => {
                  const unread = mark?.id === m.id;
                  if (unread) prev = null;
                  const senderKey = m.sender_id || 'ai';
                  const first = senderKey !== prev;
                  prev = m.kind === 'system' ? null : senderKey;
                  const row = renderMsg(m, first);
                  return unread ? [<div key="unread-mark" id="unread-mark" className="unread-sep"><span>{mark.n} unread message{mark.n > 1 ? 's' : ''}</span></div>, row] : [row];
                })}
              </section>
            );
          })}
          {draft ? (
            <div className="row-msg in first">
              <div className={`bubble streaming ${!planner ? 'ai' : ''}`}>
                {!planner && <span className="who" style={{ color: 'var(--accent)' }}>Planner</span>}
                <span className="text"><RichText text={draft} /><i className="caret" /></span>
              </div>
            </div>
          ) : (thinking || typing) && (
            <div className="row-msg in first"><div className="bubble typing-bubble"><span /><span /><span /></div></div>
          )}
        </div>
        {jump && (
          <button className="jump" onClick={() => toEnd(true)} aria-label={unseen ? `${unseen} new message${unseen > 1 ? 's' : ''}` : 'Go to latest'}>
            <Icon name="down" size={22} />{unseen > 0 && <b>{unseen}</b>}
          </button>
        )}
      </div>

      {(starters.length > 0 || quick.length > 0) && !thinking && (
        <div className="suggest-row">{[...starters, ...quick].map((q) => <button key={q} className="suggest-chip" onClick={() => sendText(q)}>{q}</button>)}</div>
      )}

      {editing && (
        <div className="reply-bar edit-bar">
          <span className="edit-ic"><Icon name="edit" size={18} /></span>
          <span className="quote-text grow"><b className="accent">Edit message</b><span className="quote-body">{editing.body}</span></span>
          <button type="button" className="icon-plain sm" onClick={cancelEdit} aria-label="Cancel edit"><Icon name="x" size={20} /></button>
        </div>
      )}
      {replyTo && (
        <div className="reply-bar">
          <Quote q={replyData(replyTo)} me={self} color={quoteColor(replyTo)} />
          <button type="button" className="icon-plain sm" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="x" size={20} /></button>
        </div>
      )}
      {blockedOther ? (
        <button className="composer blocked-bar" onClick={() => navigate(`/chat/${id}/info`)}>
          <Icon name="block" size={18} /><span>You blocked {others[0].display_name.split(' ')[0]}. Tap to unblock.</span>
        </button>
      ) : (
      <form className={`composer ${recording ? 'recording' : ''}`} onSubmit={send}>
        {!planner && !recording && <button type="button" className="icon-plain" onClick={() => setAttach(true)} aria-label="More"><Icon name="plus" size={26} /></button>}
        {recording ? <RecordingBar rec={rec} onCancel={() => rec.cancel()} /> : (
          <div className="input-pill">
            <textarea ref={inputRef} value={text} onChange={onType} rows={1} enterKeyHint={enterSends ? 'send' : 'enter'}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { if (editing) cancelEdit(); else if (replyTo) setReplyTo(null); }
                // Enter sends (unless you turned that off); Shift+Enter is always a new line.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSends) { e.preventDefault(); send(); }
              }}
              placeholder={editing ? 'Edit message' : replyTo ? 'Reply' : planner ? 'Ask me anything' : 'Message'} aria-label="Message" />
            <button type="button" className="icon-plain sm muted-ic" onClick={() => setPicker(true)} aria-label="Emoji, stickers and GIFs"><Icon name="smile" size={24} /></button>
            {!planner && !text.trim() && <button type="button" className="icon-plain sm muted-ic" onClick={pickPhotos} aria-label="Send a photo"><Icon name="camera" size={23} /></button>}
            {!planner && <button type="button" className="icon-plain sm" onClick={text.trim() ? askPlanner : planIt} disabled={thinking && !text.trim()}
              aria-label={text.trim() ? 'Ask Planner' : 'Plan it with Planner'}><Orb size={24} state={thinking ? 'thinking' : 'idle'} /></button>}
          </div>
        )}
        {recording ? <button type="button" className="send ready" onClick={sendVoice} aria-label="Send voice message"><Icon name="send" size={20} /></button>
          : voiceOk && !text.trim() && !editing ? <button type="button" className="send mic" onClick={startVoice} aria-label="Record a voice message"><Icon name="mic" size={22} /></button>
          : <button className={`send ${text.trim() ? 'ready' : ''}`} disabled={!text.trim()} aria-label={editing ? 'Save' : 'Send'}><Icon name={editing ? 'check' : 'send'} size={20} /></button>}
      </form>
      )}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPicked} />
      <input ref={docRef} type="file" hidden onChange={onDoc}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.zip,application/pdf,text/plain,text/csv" />
      {photos && <PhotoSend files={photos} title={planner ? 'Planner' : conv.title} onClose={() => setPhotos(null)} onSend={sendPhotos} />}
      {viewer && <PhotoViewer m={viewer} who={viewer.sender_id === meId ? 'You' : viewer.sender?.display_name || ''} onClose={() => setViewer(null)} toast={toast} />}

      {menuMsg && menuMsg.kind !== 'deleted' && (
        <MessageMenu at={menu.at} side={menu.side} canReact={!menuMsg.failed} reactions={menuMsg.reactions} meId={meId}
          names={(ids) => ids.map(nameOf).join(', ')} onReact={(e) => react(menuMsg, e)} actions={menuActions(menuMsg)} onClose={() => setMenu(null)}>
          <div className={`row-msg ${menu.side} ${menu.first ? 'first' : ''}`}>{bubble(menuMsg, menu.first, true)}</div>
        </MessageMenu>
      )}
      <ArtPicker open={picker} onClose={() => setPicker(false)} onEmoji={addEmoji} onSend={sendArt} />
      <Sheet open={attach} onClose={() => setAttach(false)}>
        <div className="attach-grid">
          <button onClick={pickPhotos}><span style={{ '--c': 'var(--blue)' }}><Icon name="image" size={26} /></span>Photos</button>
          <button onClick={pickDoc}><span style={{ '--c': 'var(--gold)' }}><Icon name="doc" size={26} /></span>Document</button>
          <button onClick={planIt}><span className="ai-tile"><Orb size={30} /></span>Plan it</button>
          <button onClick={() => { setAttach(false); navigate(`/plans/new?with=${others.map((o) => o.id).join(',')}`); }}><span style={{ '--c': 'var(--violet)' }}><Icon name="cal" size={26} /></span>New plan</button>
          <button onClick={() => { setAttach(false); callAll(); }}><span style={{ '--c': 'var(--ok)' }}><Icon name="video" size={26} /></span>Video call</button>
          <button onClick={chill}><span style={{ '--c': 'var(--pink)' }}><Icon name="coffee" size={26} /></span>Chill invite</button>
        </div>
        <p className="muted small center">Tip: start a message with @Planner, or type it and tap the orb, to ask Planner anything right here.</p>
      </Sheet>
    </div>
  );
}

export default function ChatRoom() {
  const { id } = useParams();
  return <ChatView key={id} convId={id} />;
}
