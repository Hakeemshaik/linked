import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { AppProvider, useApp } from './lib/store.jsx';
import { TabBar, Toasts } from './components/ui.jsx';
import UpdatePrompt from './components/UpdatePrompt.jsx';
import PushPrompt from './components/PushPrompt.jsx';
import { post } from './lib/api.js';
import IncomingInvite from './components/IncomingInvite.jsx';
import Login from './pages/Login.jsx';
import Chats, { Archived } from './pages/Chats.jsx';
import ChatRoom from './pages/ChatRoom.jsx';
import './styles.css';
import { pinViewport } from './lib/viewport.js';
import { bootLook } from './lib/look.js';

bootLook();
pinViewport();

// Chats open straight away; other screens load on first use (and quietly in the background right after start).
const screens = {
  Calendar: () => import('./pages/Calendar.jsx'),
  Calls: () => import('./pages/Calls.jsx'),
  You: () => import('./pages/You.jsx'),
  YouSettings: () => import('./pages/YouSettings.jsx'),
  YouAccount: () => import('./pages/YouAccount.jsx'),
  YouCollections: () => import('./pages/YouCollections.jsx'),
  ChatInfo: () => import('./pages/ChatInfo.jsx'),
  Communities: () => import('./pages/Communities.jsx'),
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
const You = lazy(screens.You);
const part = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const Profile = part(screens.YouSettings, 'Profile');
const Privacy = part(screens.YouSettings, 'Privacy');
const Blocked = part(screens.YouSettings, 'Blocked');
const ChatSettings = part(screens.YouSettings, 'ChatSettings');
const Appearance = part(screens.YouSettings, 'Appearance');
const NotificationSettings = part(screens.YouSettings, 'NotificationSettings');
const Permissions = part(screens.YouSettings, 'Permissions');
const Storage = part(screens.YouSettings, 'Storage');
const Help = part(screens.YouSettings, 'Help');
const Account = part(screens.YouAccount, 'Account');
const Devices = part(screens.YouAccount, 'Devices');
const LinkRedeem = part(screens.YouAccount, 'LinkRedeem');
const Lists = part(screens.YouCollections, 'Lists');
const Broadcasts = part(screens.YouCollections, 'Broadcasts');
const Broadcast = part(screens.YouCollections, 'Broadcast');
const ChatInfo = lazy(screens.ChatInfo);
const ChatMedia = part(screens.ChatInfo, 'ChatMedia');
const Starred = part(screens.ChatInfo, 'Starred');
const Communities = lazy(screens.Communities);
const Community = part(screens.Communities, 'Community');
const Friends = lazy(screens.Friends);
const Plans = lazy(screens.Plans);
const EventForm = lazy(screens.EventForm);
const EventPage = lazy(screens.EventPage);
const Alerts = lazy(screens.Alerts);
const Call = lazy(screens.Call);
const InvitePage = lazy(screens.InvitePage);
const warm = () => Object.values(screens).forEach((load) => load().catch(() => {}));
(window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(warm);

const TAB_ROOTS = ['/', '/calendar', '/calls', '/communities', '/you'];

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
  return <div className="splash" aria-hidden="true"><img className="logo" src="/brand/logo.svg" alt="" width="104" height="104" /><b>Linkup</b></div>;
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
  const fullScreen = !!onCall || /^\/chat\/[^/]+$/.test(loc.pathname);
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
          <Route path="/archived" element={<Archived />} />
          <Route path="/chat/:id" element={<ChatRoom />} />
          <Route path="/chat/:id/info" element={<ChatInfo />} />
          <Route path="/chat/:id/media" element={<ChatMedia />} />
          <Route path="/chat/:id/starred" element={<Starred />} />
          <Route path="/status" element={<Navigate to="/you" replace />} />
          <Route path="/settings" element={<Navigate to="/you" replace />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/communities" element={<Communities />} />
          <Route path="/community/:id" element={<Community />} />
          <Route path="/you" element={<You />} />
          <Route path="/you/profile" element={<Profile />} />
          <Route path="/you/account" element={<Account />} />
          <Route path="/you/devices" element={<Devices />} />
          <Route path="/you/privacy" element={<Privacy />} />
          <Route path="/you/blocked" element={<Blocked />} />
          <Route path="/you/chats" element={<ChatSettings />} />
          <Route path="/you/appearance" element={<Appearance />} />
          <Route path="/you/notifications" element={<NotificationSettings />} />
          <Route path="/you/permissions" element={<Permissions />} />
          <Route path="/you/storage" element={<Storage />} />
          <Route path="/you/help" element={<Help />} />
          <Route path="/you/lists" element={<Lists />} />
          <Route path="/you/broadcasts" element={<Broadcasts />} />
          <Route path="/you/broadcasts/:id" element={<Broadcast />} />
          <Route path="/you/starred" element={<Starred />} />
          <Route path="/link/:code" element={<LinkRedeem />} />
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
