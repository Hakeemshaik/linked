import { useEffect, useRef, useState } from 'react';
import { AVATARS, avatarUrl, sceneUrl, emojiUrl, EMOJI_IDS } from '../lib/art.js';
import { NavLink, useLocation } from 'react-router-dom';
import { STATUS, useApp } from '../lib/store.jsx';

/* ---------- icons: 24x24, stroke 1.8, round caps, currentColor ---------- */
const P = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  cal: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12Z" />,
  friends: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.3A6.5 6.5 0 0 1 21.5 20" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  bell: <><path d="M6 10a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  video: <><rect x="2.5" y="6" width="13" height="12" rx="3" /><path d="m15.5 10.5 6-3.5v10l-6-3.5" /></>,
  phone: <path d="M5 4h3.5l1.8 4.3-2.2 1.4a11 11 0 0 0 6.2 6.2l1.4-2.2L20 15.5V19a2 2 0 0 1-2.2 2A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4Z" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  micOff: <><path d="M15 9.3V6a3 3 0 0 0-5.9-.8M9 9v2a3 3 0 0 0 4.9 2.3M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10.2 5.3M12 17.5V21M3 3l18 18" /></>,
  camOff: <><path d="M15.5 10.5 21.5 7v10l-2.2-1.3M3 3l18 18M13 6h-.5M2.5 8v7a3 3 0 0 0 3 3h7a3 3 0 0 0 2.7-1.6" /></>,
  flip: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" /></>,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  pin: <><path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  coffee: <><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" /><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2M12 3.5v2" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  left: <path d="m15 6-6 6 6 6" />,
  right: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  block: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  status: <><circle cx="12" cy="12" r="8.5" strokeDasharray="3.2 2.6" /><circle cx="12" cy="12" r="4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  tick: <path d="m4.5 12.5 4 4L19 6.5" />,
  ticks: <><path d="m2 12.5 4 4L16.5 6.5" /><path d="m11 16 .5.5L22 6.5" /></>,
  arrowIn: <path d="M17 7 7 17M7 9v8h8" />,
  arrowOut: <path d="M7 17 17 7M9 7h8v8" />,
  more: <><circle cx="12" cy="5.5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="18.5" r="1.2" /></>,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.3 14.2c.9 1.3 2.2 2 3.7 2s2.8-.7 3.7-2" /><path d="M9 9.6h.01M15 9.6h.01" strokeWidth="2.6" /></>,
  userPlus: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" /></>,
  reply: <path d="M9.5 6.5 4 12l5.5 5.5M4.5 12H14a6 6 0 0 1 6 6v.5" />,
  copy: <><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" /><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2" /></>,
  trash: <><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 11.6A2 2 0 0 0 9.4 20.5h5.2a2 2 0 0 0 2-1.9L17.5 7M10 11v5.5M14 11v5.5" /></>,
  alert: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.8v4.9M12 16.2h.01" /></>,
  camera: <><path d="M3.5 8.8A2.5 2.5 0 0 1 6 6.3h1.9l1.6-2.1h5l1.6 2.1H18a2.5 2.5 0 0 1 2.5 2.5V17A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17Z" /><circle cx="12" cy="12.6" r="3.6" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4" /></>,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  play: <path d="M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L9.7 5.1a.8.8 0 0 0-1.2.7Z" fill="currentColor" />,
  pause: <><rect x="6.5" y="5" width="4" height="14" rx="1.3" fill="currentColor" /><rect x="13.5" y="5" width="4" height="14" rx="1.3" fill="currentColor" /></>,
  doc: <><path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8Z" /><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" /></>,
  star: <path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8Z" />,
  bellOff: <><path d="M8.7 4.9A6 6 0 0 1 18 10c0 2.3.4 3.9.9 4.9M17 17.5H4S6 16 6 10c0-.9.2-1.8.5-2.6M10 20a2 2 0 0 0 4 0M3 3l18 18" /></>,
  archive: <><rect x="3" y="4" width="18" height="4.5" rx="1.5" /><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></>,
  devices: <><rect x="2.5" y="5" width="13" height="10" rx="2" /><path d="M6 19h6M9 15v4" /><rect x="17" y="8" width="5" height="11" rx="1.5" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-1.3-1.2-1.7-1.2-2.9 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1.1" /><circle cx="10" cy="7" r="1.1" /><circle cx="14.5" cy="7" r="1.1" /></>,
  shield: <><path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6Z" /><path d="m9 12 2 2 4-4" /></>,
  megaphone: <><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M17 8.5a5 5 0 0 1 0 7M7 15l1.5 5" /></>,
  community: <><circle cx="12" cy="7" r="3" /><circle cx="5" cy="10" r="2.3" /><circle cx="19" cy="10" r="2.3" /><path d="M7 20a5 5 0 0 1 10 0M1.5 18.5a3.8 3.8 0 0 1 5-3.4M22.5 18.5a3.8 3.8 0 0 0-5-3.4" /></>,
  qr: <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2" /><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.4M12 17h.01" /></>,
  storage: <><ellipse cx="12" cy="6" rx="7.5" ry="2.8" /><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20.5a8 8 0 0 1 16 0" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  logout: <><path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8h.01" /></>,
  wallpaper: <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="m3.5 16 5-5 4 4 3-3 5 5" /><circle cx="15.5" cy="8.5" r="1.5" /></>,
  swap: <path d="M7 4 3.5 7.5 7 11M3.5 7.5H17M17 20l3.5-3.5L17 13M20.5 16.5H7" />,
  undo: <path d="M9 14 4.5 9.5 9 5M4.5 9.5H15a5 5 0 0 1 0 10h-3" />,
  pinOn: <><path d="M9 3.5h6l-1 6 3.5 3.5H6.5L10 9.5Z" /><path d="M12 13v7.5" /></>,
  chatRead: <><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12Z" /><path d="m8.5 12 2.3 2.3 4.7-4.6" /></>,
  chatUnread: <><path d="M13.5 4.2A8 8 0 1 0 20 12" /><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4" /><circle cx="19" cy="5" r="2.5" fill="currentColor" /></>,
  broom: <><path d="m14 4 6 6M9.5 8.5l6 6M4 20c1-4 2.5-6.5 5.5-11.5l6 6C10.5 17.5 8 19 4 20Z" /></>,
  pip: <><rect x="2.5" y="4.5" width="19" height="15" rx="3" /><rect x="11.5" y="11" width="7.5" height="5.5" rx="1.5" fill="currentColor" stroke="none" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5Z" /></>,
  share: <><path d="M12 14V3.5M8 7.5l4-4 4 4" /><path d="M8.5 10H7a2.5 2.5 0 0 0-2.5 2.5V18A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-5.5A2.5 2.5 0 0 0 17 10h-1.5" /></>,
};
export function Icon({ name, size = 22, className = '' }) {
  return (
    <svg className={`ic ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}

/* ---------- the Planner orb (iridescent glass) ---------- */
export function Orb({ size = 40, state = 'idle', className = '' }) {
  const sm = size <= 48 ? 'sm' : '';
  return <span className={`orb ${sm} ${state} ${className}`} style={{ width: size, height: size }} aria-hidden="true" />;
}

const PIC_IDS = new Set(AVATARS.map((a) => a.id));
export function Avatar({ user, size = 40, showStatus = false }) {
  if (!user) return <Orb size={size} />;
  const initials = (user.display_name || user.username || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const st = STATUS[user.status] || STATUS.offline;
  const pic = PIC_IDS.has(user.avatar);
  return (
    <span className={`avatar ${pic ? 'pic' : ''}`} style={{ width: size, height: size, '--hue': user.color, fontSize: size * 0.38 }}>
      {pic ? <img src={avatarUrl(user.avatar)} alt="" draggable="false" /> : initials}
      {showStatus && <span className="avatar-dot" style={{ background: st.color }} />}
    </span>
  );
}

export function StatusPill({ status }) {
  const st = STATUS[status] || STATUS.offline;
  return <span className="pill" style={{ '--c': st.color }}><i />{st.label}</span>;
}

export function Sheet({ open, onClose, title, children }) {
  // Stay mounted for a moment after closing so the sheet can slide away.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <div className={`sheet-backdrop ${open ? '' : 'closing'}`} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-handle" />
        {title && <h3 className="sheet-title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

/* ---------- bottom tab bar ---------- */
export function TabBar() {
  const { chatUnread, friends } = useApp();
  const tabs = [
    ['/', 'chat', 'Chats', chatUnread],
    ['/calendar', 'cal', 'Calendar'],
    ['/calls', 'phone', 'Calls'],
    ['/communities', 'community', 'Communities'],
    ['/you', 'user', 'You', friends.incoming.length],
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map(([to, icon, label, badge]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          <span className="tab-icon"><Icon name={icon} size={25} />{badge > 0 && <b className="badge">{badge > 99 ? '99+' : badge}</b>}</span>
          <span className="tab-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/* In-app banners: they drop in just under the top bar (so its buttons stay tappable),
   go away on their own, and can be flicked up or sideways to dismiss. */
function Banner({ t, onDismiss, onOpen }) {
  const ref = useRef(null);
  const g = useRef(null);
  const [out, setOut] = useState('');
  const move = (dx, dy) => { if (ref.current) ref.current.style.transform = `translate3d(${dx}px, ${Math.min(0, dy)}px, 0)`; };
  const down = (e) => { g.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
  const onMove = (e) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) s.moved = true;
    if (s.moved) move(Math.abs(dx) > Math.abs(dy) ? dx : 0, Math.abs(dy) >= Math.abs(dx) ? dy : 0);
  };
  const up = (e) => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.moved) return onOpen();
    if (dy < -24 || Math.abs(dx) > 70) { setOut(dy < -24 ? 'up' : dx > 0 ? 'right' : 'left'); setTimeout(onDismiss, 200); }
    else if (ref.current) { ref.current.style.transition = 'transform .3s var(--spring)'; move(0, 0); setTimeout(() => { if (ref.current) ref.current.style.transition = ''; }, 320); }
  };
  return (
    <div ref={ref} role="button" tabIndex={0} className={`toast island ${out ? `out-${out}` : ''}`}
      onPointerDown={down} onPointerMove={onMove} onPointerUp={up} onPointerCancel={() => { g.current = null; move(0, 0); }}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      {t.user ? <Avatar user={t.user} size={36} /> : t.planner ? <Orb size={36} /> : <span className="island-ic"><Icon name={t.icon || 'bell'} size={17} /></span>}
      <span className="grow"><strong className="ellipsis">{t.title}</strong>{t.body && <span className="ellipsis">{t.body}</span>}</span>
      {t.action && <button type="button" className="island-btn" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDismiss(); t.action.run(); }}>{t.action.label}</button>}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast, navigate } = useApp();
  const { pathname } = useLocation();
  return (
    <div className="toasts island-wrap">
      {toasts.filter((t) => t.url !== pathname).map((t) => (
        <Banner key={t.tid} t={t} onDismiss={() => dismissToast(t.tid)} onOpen={() => { dismissToast(t.tid); if (t.url) navigate(t.url); }} />
      ))}
    </div>
  );
}

export function Empty({ title, children, action, art }) {
  return (
    <div className="empty">
      {art && <img className="empty-art" src={sceneUrl(art)} alt="" draggable="false" />}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Header({ title, sub, right, back, left }) {
  const { navigate } = useApp();
  return (
    <header className={`header ${back ? 'nav' : 'large'}`}>
      {back ? (
        <button className="back-btn" onClick={() => (window.history.length > 1 ? window.history.back() : navigate(back))} aria-label="Back">
          <Icon name="left" size={26} />
        </button>
      ) : left || <span className="header-left" />}
      <div className="grow">
        {title && <h1>{title}</h1>}
        {sub && <div className="subtitle">{sub}</div>}
      </div>
      <div className="header-right">{right}</div>
    </header>
  );
}

export const TYPE_LABEL = { hangout: 'Hangout', trip: 'Trip', call: 'Video call', meeting: 'Meeting', event: 'Event' };
export const reminderLabel = (m) => {
  m = Number(m) || 0;
  if (m >= 1440) return m === 1440 ? '1 day before' : `${Math.round(m / 1440)} days before`;
  if (m >= 60) return m === 60 ? '1 hour before' : `${+(m / 60).toFixed(1)} hours before`;
  return `${m} min before`;
};

/* ---------- settings-style building blocks ---------- */
/** A row in a settings list: coloured icon tile, title, a hint underneath or a value on the right. */
export function Cell({ icon, color, title, sub, value, badge, onClick, danger, right, chevron = !!onClick, className = '' }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`row-item cell ${danger ? 'danger-cell' : ''} ${className}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      {icon && <span className="tile-ic" style={{ '--c': danger ? 'var(--danger)' : color || 'var(--accent)' }}><Icon name={icon} size={19} /></span>}
      <span className="grow"><b className={danger ? 'danger' : ''}>{title}</b>{sub && <small>{sub}</small>}</span>
      {value !== undefined && value !== null && value !== '' && <span className="cell-value">{value}</span>}
      {badge > 0 && <b className="unread">{badge > 99 ? '99+' : badge}</b>}
      {right}
      {chevron && <Icon name="right" size={18} className="muted chev" />}
    </Tag>
  );
}

/** An on/off switch. */
export function Toggle({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled}
      className={`switch ${on ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }}><i /></button>
  );
}

/** A switch row. */
export function ToggleCell({ icon, color, title, sub, on, onChange, disabled }) {
  return (
    <div className="row-item cell" onClick={() => !disabled && onChange(!on)}>
      {icon && <span className="tile-ic" style={{ '--c': color || 'var(--accent)' }}><Icon name={icon} size={19} /></span>}
      <span className="grow"><b>{title}</b>{sub && <small>{sub}</small>}</span>
      <Toggle on={on} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

/** Pick one of a few options, shown as a list with a check. */
export function Choice({ options, value, onChange }) {
  return (
    <div className="group-list">
      {options.map(([k, label, hint]) => (
        <button key={k} type="button" className="row-item cell" onClick={() => onChange(k)}>
          <span className="grow"><b>{label}</b>{hint && <small>{hint}</small>}</span>
          {value === k && <Icon name="check" size={20} className="accent" />}
        </button>
      ))}
    </div>
  );
}

/** "Are you sure?" as a bottom sheet. ask = { title, body, ok, danger, run } */
export function Confirm({ ask, onClose }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={!!ask} onClose={onClose}>
      {ask && (
        <div className="confirm">
          <h3>{ask.title}</h3>
          {ask.body && <p>{ask.body}</p>}
          {ask.input}
          <button className={`btn block big-btn ${ask.danger ? 'danger' : 'primary'}`} disabled={busy}
            onClick={async () => { setBusy(true); try { await ask.run(); onClose(); } catch (e) { if (!ask.quiet) toast({ title: "That didn't work", body: e.message }); } finally { setBusy(false); } }}>{busy ? <span className="btn-spin" /> : ask.ok || 'OK'}</button>
          <button className="btn quiet block" onClick={onClose}>Cancel</button>
        </div>
      )}
    </Sheet>
  );
}

/** Friends to tick. */
export function FriendPicker({ friends, picked, onChange, exclude = [] }) {
  const list = friends.filter((f) => !exclude.includes(f.id));
  if (!list.length) return <p className="muted center small">No friends to add yet. Invite some first.</p>;
  return (
    <div className="sheet-list picker-list">
      {list.map((f) => (
        <button key={f.id} type="button" className="row-item" onClick={() => onChange(picked.includes(f.id) ? picked.filter((x) => x !== f.id) : [...picked, f.id])}>
          <Avatar user={f} size={44} />
          <span className="grow"><b>{f.display_name}</b><small>@{f.username}</small></span>
          <span className={`check ${picked.includes(f.id) ? 'on' : ''}`}>{picked.includes(f.id) && <Icon name="check" size={16} />}</span>
        </button>
      ))}
    </div>
  );
}

/** A group's picture: its own art if it has one, otherwise two members' faces. */
export function GroupAvatar({ conv, size = 52 }) {
  if (conv?.avatar && PIC_IDS.has(conv.avatar)) return <Avatar user={{ avatar: conv.avatar, display_name: conv.title || conv.name }} size={size} />;
  if (conv?.avatar && EMOJI_IDS.has(conv.avatar)) return <span className="avatar emoji-av" style={{ width: size, height: size }}><img src={emojiUrl(conv.avatar)} alt="" draggable="false" /></span>;
  const others = (conv?.members || []).filter((m) => !m.me);
  if (!others.length) return <span className="avatar group-av" style={{ width: size, height: size }}><Icon name="friends" size={size * 0.45} /></span>;
  return <span className="stack" style={{ width: size, height: size }}>{others.slice(0, 2).map((m) => <Avatar key={m.id} user={m} size={Math.round(size * 0.7)} />)}</span>;
}
