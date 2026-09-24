import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { AppProvider, useApp } from './lib/store.jsx';
import { TabBar, Toasts, Orb } from './components/ui.jsx';
import UpdatePrompt from './components/UpdatePrompt.jsx';
import PushPrompt from './components/PushPrompt.jsx';
import { post } from './lib/api.js';
import IncomingInvite from './components/IncomingInvite.jsx';
import Login from './pages/Login.jsx';
import Chats from './pages/Chats.jsx';
import ChatRoom from './pages/ChatRoom.jsx';
import './styles.css';
import { pinViewport } from './lib/viewport.js';

pinViewport();

// Chats open straight away; other screens load on first use (and quietly in the background right after start).
const screens = {
  Calendar: () => import('./pages/Calendar.jsx'),
  Calls: () => import('./pages/Calls.jsx'),
  Settings: () => import('./pages/Settings.jsx'),
  Friends: () => import('./pages/Friends.jsx'),
  Plans: () => import('./pages/Plans.jsx'),
  EventForm: () => import('./pages/EventForm.jsx'),
  EventPage: () => import('./pages/EventPage.jsx'),
  Alerts: () => import('./pages/Alerts.jsx'),
  Call: () => import('./pages/Call.jsx'),
  InvitePage: () => import('./pages/InvitePage.jsx'),
};
const Calendar = lazy(screens.Calendar);
const Calls = lazy(screens.Calls);
const Settings = lazy(screens.Settings);
const Friends = lazy(screens.Friends);
const Plans = lazy(screens.Plans);
const EventForm = lazy(screens.EventForm);
const EventPage = lazy(screens.EventPage);
const Alerts = lazy(screens.Alerts);
const Call = lazy(screens.Call);
const InvitePage = lazy(screens.InvitePage);
const warm = () => Object.values(screens).forEach((load) => load().catch(() => {}));
(window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(warm);

const TAB_ROOTS = ['/', '/calendar', '/calls'];

/* First-open splash: the orb blooms in, the name settles, then the app. Once per session. */
function Splash() {
  const [show, setShow] = useState(() => { try { return !sessionStorage.getItem('linkup_splash'); } catch { return true; } });
  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem('linkup_splash', '1'); } catch { /* ignore */ }
    const t = setTimeout(() => setShow(false), 700);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return <div className="splash" aria-hidden="true"><Orb size={96} state="speaking" /><b>Linkup</b></div>;
}

/* Signed in with a friend's invite link: connect and jump into the new chat. */
function useInviteAccept(token, navigate, toast) {
  const done = useRef(false);
  useEffect(() => {
    if (!token || done.current) return;
    let inv = (location.pathname.match(/^\/join\/([^/]+)/) || [])[1];
    try { inv = inv || sessionStorage.getItem('linkup_invite'); } catch { /* ignore */ }
    if (!inv) return;
    done.current = true;
    post('/invite-link/accept', { token: inv })
      .then((r) => { toast({ title: `You and ${r.friend.display_name} are connected`, body: 'Say hi!' }); navigate(`/chat/${r.conversation_id}`, { replace: true }); })
      .catch((e) => { toast({ title: 'Invite link', body: e.message }); if (location.pathname.startsWith('/join/')) navigate('/', { replace: true }); })
      .finally(() => { try { sessionStorage.removeItem('linkup_invite'); } catch { /* ignore */ } });
  }, [token]); // eslint-disable-line
}

const depth = (p) => (TAB_ROOTS.includes(p) ? 0 : p.split('/').filter(Boolean).length);

function Shell() {
  const { token, navigate, toast } = useApp();
  const loc = useLocation();
  const navType = useNavigationType();
  const prev = useRef(loc.pathname);
  useInviteAccept(token, navigate, toast);

  // Screen transition: tabs crossfade, going deeper slides in, going back slides the other way.
  let anim = 'fade';
  if (prev.current !== loc.pathname) {
    const a = depth(prev.current), b = depth(loc.pathname);
    anim = b === 0 && a === 0 ? 'fade' : navType === 'POP' || b < a ? 'slide-back' : 'slide-in';
  }
  useEffect(() => { prev.current = loc.pathname; }, [loc.pathname]);

  // The active call lives outside the routes, so it keeps going (as the island pill) on other screens.
  const onCall = (loc.pathname.match(/^\/call\/([^/?#]+)/) || [])[1];
  const [activeCall, setActiveCall] = useState(null);
  useEffect(() => { if (onCall) setActiveCall(onCall); }, [onCall]);

  if (!token) return <><Splash /><Login /><Toasts /><UpdatePrompt /></>;
  const fullScreen = !!onCall || /^\/chat\/.+/.test(loc.pathname);
  const showTabs = TAB_ROOTS.includes(loc.pathname);
  const pill = activeCall && onCall !== activeCall;
  return (
    <div className={`app ${fullScreen ? 'fullscreen' : ''} ${showTabs ? 'with-tabs' : ''} ${pill ? 'island-on' : ''}`}>
      <Splash />
      <main className={`page ${anim}`} key={loc.pathname}>
        <Suspense fallback={<div className="page-wait" />}>
        <Routes>
          <Route path="/" element={<Chats />} />
          <Route path="/chat" element={<Navigate to="/" replace />} />
          <Route path="/chat/:id" element={<ChatRoom />} />
          <Route path="/status" element={<Navigate to="/settings" replace />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/plans/new" element={<EventForm />} />
          <Route path="/event/:id" element={<EventPage />} />
          <Route path="/event/:id/edit" element={<EventForm />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/call/:room" element={null} />
          <Route path="/invite/:id" element={<InvitePage />} />
          <Route path="/join/:token" element={<div className="spinner" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>
      {showTabs && <TabBar />}
      {activeCall && <Suspense fallback={null}><Call key={activeCall} room={activeCall} minimized={onCall !== activeCall} onClose={() => setActiveCall(null)} /></Suspense>}
      <Toasts />
      <IncomingInvite />
      <UpdatePrompt />
      <PushPrompt />
    </div>
  );
}

function Root() {
  const navigate = useNavigate();
  return (
    <AppProvider navigate={navigate}>
      <Shell />
    </AppProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>
);
