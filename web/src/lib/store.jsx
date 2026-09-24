import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, get, post, getToken, setToken } from './api.js';
import { connectRealtime } from './realtime.js';
import { unlockAudioOnTouch } from './sound.js';
import { registerSW, syncPush, closeNotifications, setBadge } from './push.js';
import { cacheFor, cached, cache, clearCache } from './cache.js';
import { applyLook, changeLook } from './look.js';
import { rememberAccount, forgetAccount } from './accounts.js';

// Tokens from before devices were tracked carry no session id; swap them for one that shows in Linked devices.
const hasSession = (t) => { try { return !!JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sid; } catch { return true; } };

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

/** Unread messages that count: muted and archived chats wait quietly, like WhatsApp. */
export const unreadChats = (convs) => convs.filter((c) => !c.muted && !c.archived).reduce((a, c) => a + (c.unread || (c.marked_unread ? 1 : 0)), 0);

export function AppProvider({ children, navigate }) {
  const [token, setTok] = useState(getToken());
  // Shown from the last visit straight away, then refreshed.
  const [me, setMeState] = useState(() => (getToken() ? cached('me') || null : null));
  const setMe = useCallback((u) => setMeState((cur) => {
    const next = typeof u === 'function' ? u(cur) : u;
    if (next?.id) { cacheFor(next.id); cache('me', next); }
    return next;
  }), []);
  const [config, setConfig] = useState(() => cached('config') || null);
  const [prefs, setPrefsState] = useState(() => (getToken() && cached('prefs')) || null);
  const [nudge, setNudge] = useState(null); // a friend asked you to turn notifications on
  const [friends, setFriends] = useState(() => (getToken() && cached('friends')) || { friends: [], incoming: [], outgoing: [] });
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [incoming, setIncoming] = useState(null); // ringing invite
  const [aiConvId, setAiConvId] = useState(null);
  const aiRef = useRef(null);
  aiRef.current = aiConvId;
  // Planner is a pinned chat. Open it, optionally with text ready to send.
  // Open the Planner chat with text ready to send, or ({ send: true }) sent straight away.
  const openPlanner = useCallback(async (draft = '', { send = false } = {}) => {
    let cid = aiRef.current;
    if (!cid) { const r = await get('/conversations'); cid = r.conversations.find((c) => c.is_ai)?.id; setAiConvId(cid); }
    if (cid) navRef.current(`/chat/${cid}${draft ? `?${send ? 'ask' : 'draft'}=${encodeURIComponent(draft)}` : ''}`);
  }, []);
  const rtRef = useRef(null);
  const [rt, setRt] = useState(null);
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const toast = useCallback((t) => {
    const tid = Math.random().toString(36).slice(2);
    setToasts((x) => [...x.slice(-1), { ...t, tid }]); // at most two banners at once
    setTimeout(() => setToasts((x) => x.filter((y) => y.tid !== tid)), t.ms || 3200);
  }, []);
  const dismissToast = (tid) => setToasts((x) => x.filter((y) => y.tid !== tid));

  const loadFriends = useCallback(() => get('/friends').then((f) => { setFriends(f); cache('friends', f); }).catch(() => {}), []);
  const loadUnread = useCallback(() => {
    get('/notifications').then((r) => setUnread(r.unread)).catch(() => {});
    get('/conversations').then((r) => { setChatUnread(unreadChats(r.conversations)); setAiConvId(r.conversations.find((c) => c.is_ai)?.id || null); }).catch(() => {});
  }, []);

  // Seeing something clears its alerts: { kinds: [...] } or { url }.
  const markAlerts = useCallback((what) => post('/notifications/read', what)
    .then((r) => r.read && setUnread((u) => Math.max(0, u - r.read))).catch(() => {}), []);

  const login = (t, user) => {
    setToken(t); setTok(t); setMe(user); rememberAccount(user, t);
    if (!location.pathname.startsWith('/join/')) navRef.current('/', { replace: true });
  };
  const logout = () => {
    post('/presence', { visible: false }, { keepalive: true }).catch(() => {});
    if (me?.id) forgetAccount(me.id);
    clearCache(); setToken(null); setTok(null); setMe(null); setPrefsState(null);
    navRef.current('/', { replace: true });
  };
  // Another account on this phone: it opens fresh, with its own chats.
  const switchAccount = (acc) => { clearCache(); setToken(acc.token); location.replace('/'); };
  const addAccount = () => {
    try { sessionStorage.setItem('linkup_adding', '1'); } catch { /* ignore */ }
    clearCache(); setToken(null); setTok(null); setMe(null); setPrefsState(null);
    navRef.current('/', { replace: true });
  };
  // Settings that follow you to every device: saved at once here, then on the server.
  // at = where it was tapped: a new theme or colour spreads out from there.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const savePrefs = useCallback(async (patchBody, at) => {
    const next = { ...(prefsRef.current || {}), ...patchBody };
    const looks = ['theme', 'accent', 'text_size', 'wallpaper'].some((k) => k in patchBody && patchBody[k] !== prefsRef.current?.[k]);
    const apply = () => { flushSync(() => setPrefsState(next)); applyLook(next); };
    if (looks) changeLook(apply, at); else apply();
    cache('prefs', next);
    try {
      const r = await api('/me/prefs', { method: 'PATCH', body: patchBody });
      setPrefsState(r.prefs); cache('prefs', r.prefs); applyLook(r.prefs);
    } catch (e) { toast({ title: "Couldn't save that", body: e.message }); }
  }, []); // eslint-disable-line

  useEffect(() => unlockAudioOnTouch(), []);
  useEffect(() => {
    registerSW();
    get('/config').then((c) => { setConfig(c); cache('config', c); }).catch(() => {});
    const onLogout = () => { clearCache(); setTok(null); setMe((m) => { if (m?.id) forgetAccount(m.id); return null; }); };
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
    try { sessionStorage.removeItem('linkup_adding'); } catch { /* ignore */ }
    get('/me').then((r) => { setMe(r.user); setNudge(r.nudge || null); rememberAccount(r.user, getToken()); }).catch(() => {});
    get('/me/prefs').then((r) => { setPrefsState(r.prefs); cache('prefs', r.prefs); applyLook(r.prefs); }).catch(() => {});
    if (!hasSession(token)) post('/auth/refresh').then((r) => { if (r.token) { setToken(r.token); setTok(r.token); } }).catch(() => {});
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
    // Read on this or another device: the counts (and the icon badge) catch up.
    let t = null;
    const recount = () => { clearTimeout(t); t = setTimeout(loadUnread, 400); };
    s.on('read', (p) => p.user_id === meId && recount());
    s.on('conversations:changed', recount);
    s.on('notification', (n) => {
      // A reaction to your message: just the alert, it isn't an unread message.
      if (n.kind === 'reaction') {
        if (window.location.pathname !== n.url) toast({ title: n.title, body: n.body, url: n.url, user: n.data?.from });
        return;
      }
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

  // Opening the app clears its notifications off the lock screen, like WhatsApp. The icon keeps only what's still unread.
  useEffect(() => {
    if (!token) return;
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      closeNotifications();
      loadUnread();
    };
    onShow();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [token]); // eslint-disable-line
  useEffect(() => { setBadge(token ? unread + chatUnread : 0); }, [unread, chatUnread, token]);

  const value = useMemo(() => ({
    token, me, setMe, config, friends, loadFriends, unread, setUnread, chatUnread, setChatUnread, loadUnread, markAlerts,
    toasts, toast, dismissToast, incoming, setIncoming, rt, login, logout, navigate, openPlanner, aiConvId,
    prefs: prefs || {}, savePrefs, switchAccount, addAccount, nudge, setNudge,
  }), [token, me, config, friends, unread, chatUnread, toasts, incoming, rt, navigate, aiConvId, prefs, nudge]); // eslint-disable-line

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
