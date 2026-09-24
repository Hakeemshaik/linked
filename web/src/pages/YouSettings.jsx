import { useEffect, useState } from 'react';
import { get, post, patch, del } from '../lib/api.js';
import { useApp, STATUS } from '../lib/store.jsx';
import { Avatar, Header, Icon, Sheet, Cell, ToggleCell, Choice, Confirm } from '../components/ui.jsx';
import { StatusSheet } from './You.jsx';
import { AVATARS } from '../lib/art.js';
import { ACCENTS, WALLPAPERS } from '../lib/look.js';
import { enablePush, disablePush, pushState, isIOS, isStandalone } from '../lib/push.js';
import { permissionStates, askMedia, settingsSteps } from '../lib/perms.js';
import { clearCache } from '../lib/cache.js';
import { APP_VERSION } from '../lib/update.js';
import { fileSize } from './ChatRoom.jsx';

/* ---------- Profile ---------- */
export function Profile() {
  const { me, setMe, toast } = useApp();
  const [name, setName] = useState(me?.display_name || '');
  const [pic, setPic] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  useEffect(() => { setName(me?.display_name || ''); }, [me?.display_name]);
  const st = STATUS[me?.status] || STATUS.available;
  const save = async (body) => {
    try { const r = await patch('/me', body); setMe((m) => ({ ...m, ...r.user })); return true; }
    catch (e) { toast({ title: 'Could not save', body: e.message }); return false; }
  };
  return (
    <>
      <Header back="/you" title="Profile" />
      <section className="info-hero">
        <button className="info-pic" onClick={() => setPic(true)} aria-label="Change profile picture">
          <Avatar user={me} size={112} /><i><Icon name="camera" size={16} /></i>
        </button>
        <button className="link" onClick={() => setPic(true)}>Change picture</button>
      </section>
      <div className="list-label">Name</div>
      <div className="group-list form-list">
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== me?.display_name && save({ display_name: name }).then((ok) => ok && toast({ title: 'Name saved', ms: 1500 }))} aria-label="Your name" />
      </div>
      <p className="note">This is what friends see. They add you with your username.</p>
      <div className="group-list mt">
        <Cell icon="user" color="#8A8A99" title="Username" value={`@${me?.username}`} />
        <Cell icon="status" color={st.color} title="Status" value={`${st.label}${me?.status_text ? ` · ${me.status_text}` : ''}`} onClick={() => setStatusOpen(true)} />
      </div>
      <Sheet open={pic} onClose={() => setPic(false)} title="Profile picture">
        <div className="pic-grid">
          {AVATARS.map((a) => (
            <button key={a.id} className={me?.avatar === a.id ? 'on' : ''} onClick={async () => { if (await save({ avatar: a.id })) setPic(false); }} aria-label={a.name}>
              <Avatar user={{ ...me, avatar: a.id }} size={64} />
            </button>
          ))}
        </div>
        {me?.avatar && <button className="btn quiet block" onClick={async () => { if (await save({ avatar: '' })) setPic(false); }}>Use my initials instead</button>}
      </Sheet>
      <StatusSheet open={statusOpen} onClose={() => setStatusOpen(false)} />
    </>
  );
}

/* ---------- Privacy ---------- */
export function Privacy() {
  const { prefs, savePrefs, navigate } = useApp();
  const [blocked, setBlocked] = useState(null);
  const [sheet, setSheet] = useState(false);
  useEffect(() => { get('/blocks').then((r) => setBlocked(r.blocked)).catch(() => setBlocked([])); }, []);
  return (
    <>
      <Header back="/you" title="Privacy" />
      <div className="list-label">Who can see my personal info</div>
      <div className="group-list">
        <Cell title="Last seen and online" value={prefs.last_seen === 'nobody' ? 'Nobody' : 'Everyone'} onClick={() => setSheet(true)} />
      </div>
      <p className="note">With Nobody, friends see neither when you're online nor when you were last here, and you still see theirs.</p>
      <div className="group-list mt">
        <ToggleCell title="Read receipts" sub="Turn off and friends don't see when you've read their messages. You won't see theirs either." on={prefs.read_receipts !== false} onChange={(v) => savePrefs({ read_receipts: v })} />
      </div>
      <div className="group-list mt">
        <Cell icon="block" color="#E8445A" title="Blocked" value={blocked ? blocked.length || 'None' : ''} onClick={() => navigate('/you/blocked')} />
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Last seen and online">
        <Choice value={prefs.last_seen || 'everyone'} onChange={(v) => { savePrefs({ last_seen: v }); setSheet(false); }}
          options={[['everyone', 'Everyone', 'All your friends'], ['nobody', 'Nobody', 'Hide it from everyone']]} />
      </Sheet>
    </>
  );
}

export function Blocked() {
  const { toast } = useApp();
  const [list, setList] = useState(null);
  const load = () => get('/blocks').then((r) => setList(r.blocked)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  return (
    <>
      <Header back="/you/privacy" title="Blocked" />
      {!list ? <div className="spinner" /> : list.length === 0 ? <p className="muted center mt pad">Nobody is blocked. To block someone, open your chat, tap their name, then Block.</p> : (
        <div className="group-list mt">
          {list.map((u) => (
            <div key={u.id} className="row-item">
              <Avatar user={u} size={42} />
              <span className="grow"><b>{u.display_name}</b><small>@{u.username}</small></span>
              <button className="btn small" onClick={async () => { await del(`/blocks/${u.id}`); load(); toast({ title: `Unblocked ${u.display_name.split(' ')[0]}` }); }}>Unblock</button>
            </div>
          ))}
        </div>
      )}
      <p className="note mt">Blocked people can't message or call you, and aren't told.</p>
    </>
  );
}

/* ---------- Chats ---------- */
export function ChatSettings() {
  const { prefs, savePrefs, toast, loadUnread } = useApp();
  const [ask, setAsk] = useState(null);
  return (
    <>
      <Header back="/you" title="Chats" />
      <div className="list-label">Wallpaper</div>
      <div className="wall-grid">
        {WALLPAPERS.map(([k, label]) => (
          <button key={k} className={`wall-swatch wallpaper wp-${k} ${(prefs.wallpaper || 'dots') === k ? 'on' : ''}`} onClick={(e) => savePrefs({ wallpaper: k }, { x: e.clientX, y: e.clientY })}>
            <span className="sw-in" /><span className="sw-out" /><b>{label}</b>
          </button>
        ))}
      </div>
      <p className="note">For one chat only: open it, tap its name, then Chat theme.</p>
      <div className="group-list mt">
        <ToggleCell title="Enter is send" sub="On a keyboard, Enter sends. Shift+Enter makes a new line." on={prefs.enter_sends !== false} onChange={(v) => savePrefs({ enter_sends: v })} />
        <ToggleCell title="Keep chats archived" sub="Archived chats stay archived when a new message comes in" on={prefs.keep_archived !== false} onChange={(v) => savePrefs({ keep_archived: v })} />
      </div>
      <div className="list-label">Message text size</div>
      <div className="seg">
        {[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, l]) => <button key={k} className={(prefs.text_size || 'm') === k ? 'on' : ''} onClick={() => savePrefs({ text_size: k })}>{l}</button>)}
      </div>
      <div className="group-list mt">
        <Cell icon="archive" color="#8A8A99" title="Archive all chats" chevron={false} onClick={() => setAsk({
          title: 'Archive all chats?', ok: 'Archive all', run: async () => { await post('/conversations/archive-all'); loadUnread(); toast({ title: 'All chats archived' }); },
        })} />
        <Cell icon="broom" danger title="Clear all chats" chevron={false} onClick={() => setAsk({
          title: 'Clear all chats?', body: 'Every message is removed for you. Your friends keep theirs.', ok: 'Clear all', danger: true,
          run: async () => { await post('/conversations/clear-all'); loadUnread(); toast({ title: 'All chats cleared' }); },
        })} />
      </div>
      <Confirm ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}

/* ---------- Appearance ---------- */
export function Appearance() {
  const { prefs, savePrefs } = useApp();
  const theme = prefs.theme || 'system';
  return (
    <>
      <Header back="/you" title="Appearance" />
      <div className="list-label">Theme</div>
      <div className="theme-pick">
        {[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => (
          <button key={k} className={`theme-card t-${k} ${theme === k ? 'on' : ''}`} onClick={(e) => savePrefs({ theme: k }, { x: e.clientX, y: e.clientY })}>
            <span className="mini-phone"><i /><i /><i /></span><b>{l}</b>
            <span className={`radio ${theme === k ? 'on' : ''}`} />
          </button>
        ))}
      </div>
      <p className="note">Automatic follows your phone's light and dark mode.</p>
      <div className="list-label">Colour</div>
      <div className="accent-row">
        {ACCENTS.map(([k, l, hex]) => (
          <button key={k} className={`accent-dot ${(prefs.accent || 'violet') === k ? 'on' : ''}`} style={{ '--c': hex }} onClick={(e) => savePrefs({ accent: k }, { x: e.clientX, y: e.clientY })} aria-label={l}>
            {(prefs.accent || 'violet') === k && <Icon name="check" size={20} />}
          </button>
        ))}
      </div>
      <div className="list-label">Message text size</div>
      <div className="seg">
        {[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, l]) => <button key={k} className={(prefs.text_size || 'm') === k ? 'on' : ''} onClick={() => savePrefs({ text_size: k })}>{l}</button>)}
      </div>
      <div className="preview-chat wallpaper">
        <div className="row-msg in first"><div className="bubble"><span className="text">Braai at mine on Saturday?</span><span className="meta">18:02</span></div></div>
        <div className="row-msg out first"><div className="bubble"><span className="text">I'm in! Bringing the salad</span><span className="meta">18:03<Icon name="ticks" size={16} className="tick read" /></span></div></div>
      </div>
    </>
  );
}

/* Friends whose phones can't get notifications yet: nudge them (a card in your chat, and their app asks at once). */
function NudgeFriends() {
  const { toast } = useApp();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => get('/nudges').then((r) => setList(r.friends)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  if (!list || !list.length) return null;
  const off = list.filter((f) => !f.notifications);
  const recent = (f) => f.nudged_at && Date.now() - Date.parse(f.nudged_at) < 12 * 3600e3;
  const one = async (f) => {
    setBusy(f.id);
    try { await post(`/nudges/${f.id}`); toast({ title: `Nudged ${f.display_name.split(' ')[0]}`, body: "They'll be asked the next time they open Linkup" }); load(); }
    catch (e) { toast({ title: 'Not sent', body: e.message }); } finally { setBusy(''); }
  };
  const all = async () => {
    setBusy('all');
    try { const r = await post('/nudges'); toast({ title: r.sent ? `Nudged ${r.sent} friend${r.sent > 1 ? 's' : ''}` : 'Everyone was nudged recently' }); load(); }
    catch (e) { toast({ title: 'Not sent', body: e.message }); } finally { setBusy(''); }
  };
  const share = async () => {
    const url = `${location.origin}/you/notifications`;
    const text = 'Turn on Linkup notifications so my calls and messages reach you:';
    try { if (navigator.share) { await navigator.share({ title: 'Linkup notifications', text, url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast({ title: 'Reminder copied', body: 'Paste it in WhatsApp or a text' }); } catch { toast({ title: 'Could not copy' }); }
  };
  return (
    <>
      <div className="list-label">Friends</div>
      <div className="group-list">
        {off.length === 0 && <div className="row-item cell"><span className="tile-ic" style={{ '--c': 'var(--ok)' }}><Icon name="check" size={19} /></span><span className="grow"><b>All your friends get notifications</b></span></div>}
        {off.map((f) => (
          <div key={f.id} className="row-item">
            <Avatar user={f} size={40} />
            <span className="grow"><b>{f.display_name}</b><small className="friend-push"><Icon name="bellOff" size={13} />Notifications off</small></span>
            <button className="btn small" disabled={!!busy || recent(f)} onClick={() => one(f)}>{recent(f) ? 'Nudged' : 'Nudge'}</button>
          </div>
        ))}
        {off.length > 1 && <Cell icon="bell" color="#E8A21B" title={`Nudge all ${off.length}`} chevron={false} onClick={busy ? undefined : all} />}
        <Cell icon="share" color="#3B8EF0" title="Send a reminder another way" sub="Share a link by WhatsApp, text or email" chevron={false} onClick={share} />
      </div>
      <p className="note">A phone only gets notifications after they're turned on there. A nudge puts a card in your chat, and their app asks the moment they next open it.</p>
    </>
  );
}

/* ---------- Notifications ---------- */
export function NotificationSettings() {
  const { config, prefs, savePrefs, toast, navigate } = useApp();
  const [ps, setPs] = useState(pushState());
  const turnOn = async () => {
    try { await enablePush(config?.vapidPublicKey); setPs(pushState()); toast({ title: 'Notifications on' }); }
    catch (e) { toast({ title: 'Could not turn them on', body: e.message, ms: 8000 }); setPs(pushState()); }
  };
  const test = async () => {
    const r = await post('/push/test');
    toast({ title: r.total ? `Test sent to ${r.sent} of ${r.total} device${r.total > 1 ? 's' : ''}` : 'No devices subscribed yet', body: r.total ? 'Lock your phone or switch apps to see it' : 'Turn notifications on first' });
  };
  return (
    <>
      <Header back="/you" title="Notifications" />
      <section className="perm-card">
        <span className={`perm-state ${ps === 'granted' ? 'ok' : ps === 'denied' ? 'bad' : ''}`}><Icon name={ps === 'granted' ? 'bell' : 'bellOff'} size={26} /></span>
        <b>{ps === 'granted' ? 'On for this phone' : ps === 'denied' ? 'Blocked on this phone' : ps === 'needs-install' ? 'Add Linkup to your Home Screen' : ps === 'unsupported' ? 'Not supported in this browser' : 'Off for this phone'}</b>
        {ps === 'granted' && <p>Messages, calls, invites and reminders arrive with who it's from and what they said.</p>}
        {ps === 'default' && <p>Hear about calls, messages and plans even when Linkup is closed.</p>}
        {ps === 'denied' && <ol className="steps-list">{settingsSteps('Notifications').map((s, i) => <li key={i}><b>{i + 1}</b>{s}</li>)}</ol>}
        {ps === 'needs-install' && (
          <ol className="steps-list">
            <li><b>1</b>Tap <Icon name="share" size={16} /> Share in Safari</li>
            <li><b>2</b>Choose Add to Home Screen</li>
            <li><b>3</b>Open Linkup from your Home Screen and come back here</li>
          </ol>
        )}
        {ps === 'unsupported' && <p>Use Chrome on Android, or Safari on iPhone (iOS 16.4 or later) added to the Home Screen.</p>}
        <div className="row gap mt">
          {ps === 'default' && <button className="btn primary grow" onClick={turnOn}>Turn on</button>}
          {ps === 'granted' && <button className="btn grow" onClick={test}>Send a test</button>}
          {ps === 'granted' && <button className="btn grow" onClick={async () => { await disablePush(); setPs('default'); toast({ title: 'Off for this phone' }); }}>Turn off</button>}
        </div>
        {isIOS() && isStandalone() && ps === 'granted' && <p className="muted small">Tip: iPhone Settings → Notifications → Linkup → allow Lock Screen and Banners.</p>}
      </section>
      <div className="list-label">Tell me about</div>
      <div className="group-list">
        <ToggleCell icon="chat" color="#3B8EF0" title="Messages" on={prefs.notify_messages !== false} onChange={(v) => savePrefs({ notify_messages: v })} />
        <ToggleCell icon="friends" color="#8B6CFF" title="Group messages" on={prefs.notify_groups !== false} onChange={(v) => savePrefs({ notify_groups: v })} />
        <ToggleCell icon="heart" color="#E3569E" title="Reactions" sub="When someone reacts to your message" on={prefs.notify_reactions !== false} onChange={(v) => savePrefs({ notify_reactions: v })} />
        <ToggleCell icon="clock" color="#E8A21B" title="Plan reminders" on={prefs.notify_reminders !== false} onChange={(v) => savePrefs({ notify_reminders: v })} />
      </div>
      <div className="group-list mt">
        <ToggleCell icon="eye" color="#14A36B" title="Show previews" sub="Off: notifications say who it's from, not what they wrote" on={prefs.previews !== false} onChange={(v) => savePrefs({ previews: v })} />
      </div>
      <p className="note">Calls always ring. To quiet one chat, open it, tap its name, then Notifications.</p>
      <NudgeFriends />
      <div className="group-list mt">
        <Cell icon="bell" color="#8A8A99" title="Recent alerts" onClick={() => navigate('/alerts')} />
      </div>
    </>
  );
}

/* ---------- Camera and microphone ---------- */
export function Permissions() {
  const { toast } = useApp();
  const [st, setSt] = useState({});
  const [help, setHelp] = useState(null);
  const refresh = () => permissionStates().then(setSt);
  useEffect(() => {
    refresh();
    const onShow = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);
  const ask = async (what) => {
    try {
      const ok = await askMedia(what === 'both' ? { video: true, audio: true } : { [what === 'camera' ? 'video' : 'audio']: true });
      await refresh();
      if (ok) toast({ title: 'Allowed', body: 'You are ready for calls' });
      else setHelp(what === 'microphone' ? 'Microphone' : 'Camera');
    } catch (e) { toast({ title: 'Could not ask', body: e.message }); }
  };
  const row = (key, icon, title, sub) => {
    const s = st[key] || 'unknown';
    return (
      <div className="row-item cell">
        <span className="tile-ic" style={{ '--c': s === 'granted' ? 'var(--ok)' : s === 'denied' ? 'var(--danger)' : 'var(--accent)' }}><Icon name={icon} size={19} /></span>
        <span className="grow"><b>{title}</b><small>{s === 'granted' ? 'Allowed' : s === 'denied' ? 'Blocked' : sub}</small></span>
        {s === 'granted' ? <Icon name="check" size={20} className="ok" />
          : s === 'denied' ? <button className="btn small" onClick={() => setHelp(title)}>How to fix</button>
          : <button className="btn small primary" onClick={() => ask(key)}>Allow</button>}
      </div>
    );
  };
  const allOk = st.camera === 'granted' && st.microphone === 'granted';
  return (
    <>
      <Header back="/you" title="Camera and microphone" />
      <section className="perm-card">
        <span className={`perm-state ${allOk ? 'ok' : ''}`}><Icon name="video" size={26} /></span>
        <b>{allOk ? 'Ready for calls' : 'Allow them once, before your first call'}</b>
        <p>Video calls use your camera and microphone. Voice messages use the microphone. Linkup only uses them while you're on a call or recording.</p>
        {!allOk && <button className="btn primary block" onClick={() => ask('both')}>Allow camera and microphone</button>}
      </section>
      <div className="group-list">
        {row('camera', 'camera', 'Camera', 'For video calls')}
        {row('microphone', 'mic', 'Microphone', 'For calls and voice messages')}
      </div>
      <p className="note">A website can't switch these on by itself: your phone always asks you first. If you tapped Don't Allow before, the steps below turn it back on.</p>
      <Sheet open={!!help} onClose={() => setHelp(null)} title={`Turn on the ${help?.toLowerCase()}`}>
        <ol className="steps-list">{settingsSteps(help || 'Camera').map((s, i) => <li key={i}><b>{i + 1}</b>{s}</li>)}</ol>
        <button className="btn primary block" onClick={() => { setHelp(null); refresh(); }}>Done</button>
      </Sheet>
    </>
  );
}

/* ---------- Storage ---------- */
export function Storage() {
  const { toast } = useApp();
  const [s, setS] = useState(null);
  const [local, setLocal] = useState(null);
  useEffect(() => {
    get('/me/storage').then((r) => setS(r.storage)).catch(() => setS({}));
    navigator.storage?.estimate?.().then((e) => setLocal(e.usage)).catch(() => {});
  }, []);
  const total = s ? ['photos', 'voice', 'files'].reduce((a, k) => a + (s[k]?.bytes || 0), 0) : 0;
  const clearHere = async () => {
    clearCache();
    try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ }
    setLocal(0);
    toast({ title: 'Cleared from this phone', body: 'Chats load fresh next time. Nothing was deleted.' });
  };
  return (
    <>
      <Header back="/you" title="Storage and data" />
      <section className="perm-card">
        <span className="perm-state"><Icon name="storage" size={26} /></span>
        <b>{s ? fileSize(total) : '…'}</b>
        <p>Photos, voice messages and documents you've sent</p>
        <div className="storage-bar">
          {s && total > 0 && ['photos', 'voice', 'files'].map((k, i) => <i key={k} style={{ width: `${(s[k].bytes / total) * 100}%`, background: ['var(--blue)', 'var(--accent)', 'var(--gold)'][i] }} />)}
        </div>
      </section>
      {s && (
        <div className="group-list">
          <Cell icon="image" color="#3B8EF0" title="Photos" value={`${s.photos?.n || 0} · ${fileSize(s.photos?.bytes || 0)}`} />
          <Cell icon="mic" color="#8B6CFF" title="Voice messages" value={`${s.voice?.n || 0} · ${fileSize(s.voice?.bytes || 0)}`} />
          <Cell icon="doc" color="#E8A21B" title="Documents" value={`${s.files?.n || 0} · ${fileSize(s.files?.bytes || 0)}`} />
        </div>
      )}
      <div className="group-list mt">
        <Cell icon="broom" color="#8A8A99" title="Clear saved data on this phone" sub={local != null ? `About ${fileSize(local)} kept for speed` : 'Chats kept for opening instantly'} chevron={false} onClick={clearHere} />
      </div>
    </>
  );
}

/* ---------- Help ---------- */
const FAQ = [
  ['Install Linkup on your phone', 'iPhone: open Linkup in Safari, tap Share, then Add to Home Screen. Android: open it in Chrome and tap Install app (or the menu, then Add to Home screen). Notifications and calls work best from the Home Screen.'],
  ['Calls don\'t connect', 'Check You → Camera and microphone, and that both phones have signal. On mobile data a relay server makes calls work behind strict networks; ask whoever runs your Linkup to add one (see the README).'],
  ['Ask Planner anything', 'Start a message with @Planner in any chat, or open the Planner chat. It answers questions, writes messages, and books plans with reminders for everyone.'],
  ['Archive, pin and mute', 'Swipe a chat left to archive it. Hold a chat to pin it, mute it, add it to a list or favourites.'],
  ['Edit, star, reply', 'Hold a message: react, reply, edit (for 15 minutes), star it, copy, or delete it for everyone.'],
  ['Leaving the app during a call', 'The call keeps going as a small picture-in-picture window where your phone supports it, and shows on your lock screen. Tap it to come back.'],
];
export function Help() {
  const { navigate } = useApp();
  const [open, setOpen] = useState(0);
  const [ai, setAi] = useState(null);
  useEffect(() => { get('/ai/status').then(setAi).catch(() => {}); }, []);
  return (
    <>
      <Header back="/you" title="Help" />
      <section className="info-hero">
        <img src="/brand/logo.svg" alt="" className="help-logo" />
        <h2>Linkup</h2>
        <p className="muted small">Version {APP_VERSION} · Planner {ai ? (ai.online ? 'online' : 'offline') : '…'}</p>
      </section>
      <div className="group-list faq">
        {FAQ.map(([q, a], i) => (
          <div key={q} className={`faq-item ${open === i ? 'open' : ''}`}>
            <button className="row-item cell" onClick={() => setOpen(open === i ? -1 : i)}><span className="grow"><b>{q}</b></span><Icon name="down" size={18} className="muted chev" /></button>
            {open === i && <p className="faq-a">{a}</p>}
          </div>
        ))}
      </div>
      <div className="group-list mt">
        <Cell icon="video" color="#1FAE6B" title="Check camera and microphone" onClick={() => navigate('/you/permissions')} />
        <Cell icon="bell" color="#E8445A" title="Check notifications" onClick={() => navigate('/you/notifications')} />
      </div>
    </>
  );
}
