import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get, post, getToken, setToken } from './api.js';
import { connectRealtime } from './realtime.js';
import { unlockAudioOnTouch } from './sound.js';
import { registerSW, syncPush } from './push.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const STATUS = {
  available: { label: 'Available', color: 'var(--ok)' },
  busy: { label: 'Busy', color: 'var(--danger)' },
  work: { label: 'At work', color: 'var(--blue)' },
  away: { label: 'Away', color: 'var(--gold)' },
  invisible: { label: 'Invisible', color: 'var(--muted)' },
  offline: { label: 'Offline', color: 'var(--muted)' },
};

export function AppProvider({ children, navigate }) {
  const [token, setTok] = useState(getToken());
  const [me, setMe] = useState(null);
  const [config, setConfig] = useState(null);
  const [friends, setFriends] = useState({ friends: [], incoming: [], outgoing: [] });
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [incoming, setIncoming] = useState(null); // ringing invite
  const [aiConvId, setAiConvId] = useState(null);
  const aiRef = useRef(null);
  aiRef.current = aiConvId;
  // Planner is a pinned chat. Open it, optionally with text ready to send.
  const openPlanner = useCallback(async (draft = '') => {
    let cid = aiRef.current;
    if (!cid) { const r = await get('/conversations'); cid = r.conversations.find((c) => c.is_ai)?.id; setAiConvId(cid); }
    if (cid) navRef.current(`/chat/${cid}${draft ? `?draft=${encodeURIComponent(draft)}` : ''}`);
  }, []);
  const rtRef = useRef(null);
  const [rt, setRt] = useState(null);
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const toast = useCallback((t) => {
    const tid = Math.random().toString(36).slice(2);
    setToasts((x) => [...x.slice(-1), { ...t, tid }]); // at most two banners at once
    setTimeout(() => setToasts((x) => x.filter((y) => y.tid !== tid)), t.ms || 3800);
  }, []);
  const dismissToast = (tid) => setToasts((x) => x.filter((y) => y.tid !== tid));

  const loadFriends = useCallback(() => get('/friends').then(setFriends).catch(() => {}), []);
  const loadUnread = useCallback(() => {
    get('/notifications').then((r) => setUnread(r.unread)).catch(() => {});
    get('/conversations').then((r) => { setChatUnread(r.conversations.reduce((a, c) => a + c.unread, 0)); setAiConvId(r.conversations.find((c) => c.is_ai)?.id || null); }).catch(() => {});
  }, []);

  const login = (t, user) => {
    setToken(t); setTok(t); setMe(user);
    if (!location.pathname.startsWith('/join/')) navRef.current('/', { replace: true });
  };
  const logout = () => { post('/presence', { visible: false }, { keepalive: true }).catch(() => {}); setToken(null); setTok(null); setMe(null); navRef.current('/', { replace: true }); };

  useEffect(() => unlockAudioOnTouch(), []);
  useEffect(() => {
    registerSW();
    get('/config').then(setConfig).catch(() => {});
    const onLogout = () => { setTok(null); setMe(null); };
    window.addEventListener('linkup:logout', onLogout);
    const onSW = (e) => {
      if (e.data?.type === 'navigate') navRef.current(e.data.url);
      if (e.data?.type === 'resubscribe' && config) syncPush(config.vapidPublicKey);
    };
    navigator.serviceWorker?.addEventListener('message', onSW);
    return () => { window.removeEventListener('linkup:logout', onLogout); navigator.serviceWorker?.removeEventListener('message', onSW); };
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!token) return;
    get('/me').then((r) => setMe(r.user)).catch(() => {});
    loadFriends();
    loadUnread();
  }, [token]); // eslint-disable-line

  // Live events, once we know who we are and how the server delivers them.
  const meId = me?.id;
  const rtKey = config && JSON.stringify(config.realtime);
  useEffect(() => {
    if (!token || !meId || !rtKey) return;
    const s = connectRealtime(config.realtime, meId);
    rtRef.current = s;
    setRt(s);
    // On every (re)connect: pick up any invite that rang while we were offline.
    s.on('connect', () => {
      get('/invites').then((r) => {
        const fresh = r.invites.find((i) => Date.now() - Date.parse(i.created_at) < 45000);
        if (fresh) setIncoming((cur) => cur || fresh);
      }).catch(() => {});
    });
    s.on('presence', (p) => {
      if (p.self) { setMe((m) => (m ? { ...m, ...p } : m)); return; }
      setFriends((f) => ({ ...f, friends: f.friends.map((x) => (x.id === p.id ? p : x)) }));
    });
    s.on('friends:changed', loadFriends);
    s.on('notification', (n) => {
      if (n.kind === 'message') {
        const path = window.location.pathname;
        if (path === n.url) return; // already looking at that chat
        setChatUnread((c) => c + 1);
      } else setUnread((u) => u + 1);
      if (n.kind === 'invite_call' || n.kind === 'invite_chill') return; // ring modal handles it
      toast({ title: n.title, body: n.body, url: n.url, user: n.data?.from, planner: n.kind === 'message' && !n.data?.from });
    });
    s.on('invite', (inv) => setIncoming(inv));
    // The caller hung up or gave up: stop ringing.
    s.on('invite:cancel', (p) => setIncoming((cur) => (cur?.id === p.invite_id ? null : cur)));
    return () => { s.disconnect(); rtRef.current = null; setRt(null); };
  }, [token, meId, rtKey]); // eslint-disable-line

  // Presence: a heartbeat every 45s while the app is on screen, one more when it's hidden.
  // The reply carries friends' presence, so someone whose phone died drops to "last seen" too.
  const friendsRef = useRef(friends);
  friendsRef.current = friends;
  useEffect(() => {
    if (!token) return;
    const beat = () => {
      const visible = document.visibilityState === 'visible';
      post('/presence', { visible }, { keepalive: !visible }).then((r) => {
        for (const p of r.friends || []) {
          const cur = friendsRef.current.friends.find((f) => f.id === p.id);
          if (cur && (cur.online !== p.online || cur.status !== p.status)) rtRef.current?.emitLocal('presence', p);
        }
      }).catch(() => {});
    };
    beat();
    const t = setInterval(() => document.visibilityState === 'visible' && beat(), 45000);
    document.addEventListener('visibilitychange', beat);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', beat); };
  }, [token]);

  useEffect(() => {
    if (token && config) syncPush(config.vapidPublicKey);
  }, [token, config]);

  useEffect(() => {
    if (navigator.setAppBadge) {
      const n = unread + chatUnread;
      (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
    }
  }, [unread, chatUnread]);

  const value = useMemo(() => ({
    token, me, setMe, config, friends, loadFriends, unread, setUnread, chatUnread, setChatUnread, loadUnread,
    toasts, toast, dismissToast, incoming, setIncoming, rt, login, logout, navigate, openPlanner, aiConvId,
  }), [token, me, config, friends, unread, chatUnread, toasts, incoming, rt, navigate, aiConvId]); // eslint-disable-line

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Subscribe to a live event for the lifetime of a component. */
export function useSocket(event, handler) {
  const { rt } = useApp();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!rt) return;
    const fn = (...a) => ref.current(...a);
    rt.on(event, fn);
    return () => rt.off(event, fn);
  }, [rt, event]);
}

export const friendName = (friends, uid) => friends.friends.find((f) => f.id === uid)?.display_name;
export { post };
