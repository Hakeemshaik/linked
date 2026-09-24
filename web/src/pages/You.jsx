import { useEffect, useState } from 'react';
import { get, patch } from '../lib/api.js';
import { APP_VERSION } from '../lib/update.js';
import { useApp, STATUS } from '../lib/store.jsx';
import { Avatar, Header, Icon, Sheet, Cell, Confirm } from '../components/ui.jsx';
import InviteSheet from '../components/Invite.jsx';
import { disablePush, pushState } from '../lib/push.js';
import { permissionStates } from '../lib/perms.js';
import { savedAccounts } from '../lib/accounts.js';

export const STATUS_HINTS = [
  ['available', 'Friends can call or invite you'], ['busy', 'Invites still arrive, quietly'], ['work', 'Shown as at work'], ['away', 'Back later'], ['invisible', 'Look offline to everyone'],
];

/** Your status and what you're up to. */
export function StatusSheet({ open, onClose }) {
  const { me, setMe } = useApp();
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(me?.status_text || ''); }, [open]); // eslint-disable-line
  const setStatus = async (status) => { const r = await patch('/me', { status }); setMe((m) => ({ ...m, ...r.user })); };
  const save = async () => { const r = await patch('/me', { status_text: text }); setMe((m) => ({ ...m, ...r.user })); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Your status">
      <div className="form">
        <div className="group-list">
          {STATUS_HINTS.map(([k, hint]) => (
            <button key={k} className="row-item cell" onClick={() => setStatus(k)}>
              <i className="dot-lg" style={{ background: STATUS[k].color }} />
              <span className="grow"><b>{STATUS[k].label}</b><small>{hint}</small></span>
              {me?.status === k && <Icon name="check" size={20} className="accent" />}
            </button>
          ))}
        </div>
        <label>What are you up to?
          <input placeholder="e.g. at the gym till 6" value={text} maxLength={80} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="chips">
          {['At the gym', 'Driving', 'In a meeting', 'On holiday', 'Studying'].map((t) => <button key={t} type="button" className="chip" onClick={() => setText(t)}>{t}</button>)}
        </div>
        <button className="btn primary block" onClick={save}>Done</button>
      </div>
    </Sheet>
  );
}

/* The You tab: your profile up top, then everything you can set, grouped the way WhatsApp does it. */
export default function You() {
  const { me, friends, navigate, unread, logout, prefs, switchAccount } = useApp();
  const [statusOpen, setStatusOpen] = useState(false);
  const [invite, setInvite] = useState(false);
  const [ask, setAsk] = useState(null);
  const [perm, setPerm] = useState({});
  const [counts, setCounts] = useState({});
  const st = STATUS[me?.status] || STATUS.available;
  const others = savedAccounts().filter((a) => a.id !== me?.id);
  useEffect(() => {
    permissionStates().then(setPerm);
    Promise.all([get('/starred').catch(() => null), get('/lists').catch(() => null), get('/broadcasts').catch(() => null), get('/sessions').catch(() => null)])
      .then(([s, l, b, d]) => setCounts({ starred: s?.starred.length, lists: l?.lists.length, broadcasts: b?.broadcasts.length, devices: d?.sessions.length }));
  }, []);
  const push = pushState();
  const permIssue = perm.camera === 'denied' || perm.microphone === 'denied';

  return (
    <>
      <Header title="You" right={<button className="icon-plain accent" onClick={() => setInvite(true)} aria-label="Your QR code"><Icon name="qr" size={24} /></button>} />

      <button className="you-card" onClick={() => navigate('/you/profile')}>
        <span className="you-pic"><Avatar user={me} size={72} /><i><Icon name="camera" size={13} /></i></span>
        <span className="grow">
          <b className="you-name">{me?.display_name}</b>
          <small className="muted">@{me?.username}</small>
          <small className="you-status"><i style={{ background: st.color }} />{st.label}{me?.status_text && ` · ${me.status_text}`}</small>
        </span>
        <Icon name="right" size={20} className="muted" />
      </button>
      <div className="you-quick">
        <button onClick={() => setStatusOpen(true)}><span style={{ '--c': st.color }}><Icon name="status" size={22} /></span>Status</button>
        <button onClick={() => setInvite(true)}><span style={{ '--c': 'var(--pink)' }}><Icon name="userPlus" size={22} /></span>Invite</button>
        <button onClick={() => navigate('/friends')}><span style={{ '--c': 'var(--blue)' }}><Icon name="friends" size={22} /></span>Friends{friends.incoming.length > 0 && <b className="badge">{friends.incoming.length}</b>}</button>
        <button onClick={() => navigate('/plans')}><span style={{ '--c': 'var(--gold)' }}><Icon name="cal" size={22} /></span>Plans</button>
      </div>

      {(push !== 'granted' || permIssue) && (
        <button className="row-item banner-row card-row" onClick={() => navigate(push !== 'granted' ? '/you/notifications' : '/you/permissions')}>
          <span className="round-ic solid" style={{ '--c': 'var(--gold)' }}><Icon name={push !== 'granted' ? 'bell' : 'camera'} size={20} /></span>
          <span className="grow"><b>{push !== 'granted' ? 'Turn on notifications' : 'Camera or microphone is blocked'}</b>
            <small>{push !== 'granted' ? "So calls and messages reach you when Linkup is closed" : 'Calls need them. Tap to fix it'}</small></span>
          <Icon name="right" size={18} className="muted" />
        </button>
      )}

      <div className="group-list">
        <Cell icon="star" color="#E8A21B" title="Starred" value={counts.starred || undefined} onClick={() => navigate('/you/starred')} />
        <Cell icon="list" color="#8B6CFF" title="Lists" sub="Your own chat filters" value={counts.lists || undefined} onClick={() => navigate('/you/lists')} />
        <Cell icon="megaphone" color="#14A36B" title="Broadcast messages" sub="One message, sent to each person separately" value={counts.broadcasts || undefined} onClick={() => navigate('/you/broadcasts')} />
        <Cell icon="devices" color="#3B8EF0" title="Linked devices" value={counts.devices || undefined} onClick={() => navigate('/you/devices')} />
      </div>

      <div className="group-list">
        <Cell icon="key" color="#3B8EF0" title="Account" sub="Passkeys, password, add account" onClick={() => navigate('/you/account')} />
        <Cell icon="lock" color="#14A36B" title="Privacy" sub={`Last seen: ${prefs.last_seen === 'nobody' ? 'Nobody' : 'Everyone'} · Read receipts ${prefs.read_receipts === false ? 'off' : 'on'}`} onClick={() => navigate('/you/privacy')} />
        <Cell icon="chat" color="#8B6CFF" title="Chats" sub="Wallpaper, archive, enter to send" onClick={() => navigate('/you/chats')} />
        <Cell icon="palette" color="#E3569E" title="Appearance" sub={`${{ light: 'Light', dark: 'Dark' }[prefs.theme] || 'Automatic'} · ${prefs.accent ? prefs.accent[0].toUpperCase() + prefs.accent.slice(1) : 'Violet'}`} onClick={() => navigate('/you/appearance')} />
        <Cell icon="bell" color="#E8445A" title="Notifications" sub={push === 'granted' ? 'On for this phone' : 'Off for this phone'} badge={unread} onClick={() => navigate('/you/notifications')} />
        <Cell icon="video" color="#1FAE6B" title="Camera and microphone" sub={permIssue ? 'Blocked. Tap to fix' : 'For calls and voice messages'} onClick={() => navigate('/you/permissions')} />
        <Cell icon="storage" color="#8A8A99" title="Storage and data" onClick={() => navigate('/you/storage')} />
      </div>

      <div className="group-list">
        <Cell icon="userPlus" color="#E3569E" title="Invite friends" sub="Link, QR code or username" onClick={() => setInvite(true)} />
        <Cell icon="help" color="#3B8EF0" title="Help" sub="Install, calls, Planner, questions" onClick={() => navigate('/you/help')} />
      </div>

      {others.length > 0 && (
        <>
          <div className="list-label">Switch account</div>
          <div className="group-list">
            {others.map((a) => (
              <button key={a.id} className="row-item" onClick={() => switchAccount(a)}>
                <Avatar user={a} size={40} />
                <span className="grow"><b>{a.display_name}</b><small>@{a.username}</small></span>
                <Icon name="swap" size={20} className="muted" />
              </button>
            ))}
          </div>
        </>
      )}

      <div className="group-list">
        <Cell icon="logout" danger title="Sign out" chevron={false} onClick={() => setAsk({
          title: 'Sign out?', body: 'You stop getting notifications on this phone until you sign in again.', ok: 'Sign out', danger: true,
          run: async () => { await disablePush().catch(() => {}); logout(); },
        })} />
      </div>
      <p className="muted small center you-foot"><img src="/brand/logo.svg" alt="" width="22" height="22" />Linkup {APP_VERSION}</p>

      <StatusSheet open={statusOpen} onClose={() => setStatusOpen(false)} />
      <InviteSheet open={invite} onClose={() => setInvite(false)} />
      <Confirm ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}
