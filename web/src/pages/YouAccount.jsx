import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { api, get, post, del, setToken } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Avatar, Header, Icon, Sheet, Cell, Confirm } from '../components/ui.jsx';
import { QR } from '../components/InviteSheet.jsx';
import { savedAccounts, forgetAccount, rememberAccount } from '../lib/accounts.js';
import { ago } from '../lib/dates.js';
import { disablePush } from '../lib/push.js';

const deviceIcon = (d = '') => (/iPhone|Android|iPad/i.test(d) ? 'phone' : 'devices');

/* ---------- Account: passkeys, password, more accounts, delete ---------- */
export function Account() {
  const { me, toast, addAccount, switchAccount, logout } = useApp();
  const [keys, setKeys] = useState(null);
  const [pw, setPw] = useState(null); // { current, next }
  const [ask, setAsk] = useState(null);
  const [delPw, setDelPw] = useState('');
  const [busy, setBusy] = useState(false);
  const accounts = savedAccounts();
  const load = () => get('/passkeys').then((r) => setKeys(r.passkeys)).catch(() => setKeys([]));
  useEffect(() => { load(); }, []);

  const addPasskey = async () => {
    setBusy(true);
    try {
      const { options, challenge_id } = await post('/passkeys/options');
      const response = await startRegistration({ optionsJSON: options });
      await post('/passkeys', { challenge_id, response });
      await load();
      toast({ title: 'Passkey saved', body: 'Next time, sign in with Face ID, Touch ID or your screen lock' });
    } catch (e) {
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') toast({ title: 'Could not make a passkey', body: e.message, ms: 6000 });
    } finally { setBusy(false); }
  };
  const changePassword = async () => {
    setBusy(true);
    try {
      await post('/me/password', pw);
      setPw(null);
      toast({ title: 'Password changed', body: 'Your other devices were signed out' });
    } catch (e) { toast({ title: 'Password not changed', body: e.message }); } finally { setBusy(false); }
  };

  return (
    <>
      <Header back="/you" title="Account" />
      <div className="list-label">Passkeys</div>
      <div className="group-list">
        {(keys || []).map((k) => (
          <div key={k.id} className="row-item cell">
            <span className="tile-ic" style={{ '--c': '#14A36B' }}><Icon name="key" size={19} /></span>
            <span className="grow"><b>{k.name || 'Passkey'}</b><small>Added {ago(k.created_at)}{k.last_used ? ` · used ${ago(k.last_used)}` : ''}</small></span>
            <button className="icon-plain sm" onClick={() => setAsk({ title: 'Remove this passkey?', body: "You won't be able to sign in with it any more.", ok: 'Remove', danger: true, run: async () => { await del(`/passkeys/${k.id}`); load(); } })} aria-label="Remove passkey"><Icon name="trash" size={18} /></button>
          </div>
        ))}
        <Cell icon="plus" color="#14A36B" title={keys?.length ? 'Add another passkey' : 'Create a passkey'} sub="Sign in with Face ID, Touch ID or your screen lock. No password to remember." chevron={false}
          onClick={browserSupportsWebAuthn() && !busy ? addPasskey : () => toast({ title: 'Passkeys need a newer browser' })} />
      </div>

      <div className="group-list mt">
        <Cell icon="lock" color="#3B8EF0" title="Change password" onClick={() => setPw({ current: '', next: '' })} />
      </div>

      <div className="list-label">Accounts on this phone</div>
      <div className="group-list">
        {accounts.map((a) => (
          <div key={a.id} role="button" tabIndex={0} className="row-item" onClick={() => a.id !== me?.id && switchAccount(a)}>
            <Avatar user={a} size={40} />
            <span className="grow"><b>{a.display_name}</b><small>@{a.username}</small></span>
            {a.id === me?.id ? <Icon name="check" size={20} className="accent" /> : (
              <button className="icon-plain sm" onClick={(e) => { e.stopPropagation(); forgetAccount(a.id); setAsk(null); toast({ title: `Removed @${a.username} from this phone` }); }} aria-label="Remove from this phone"><Icon name="x" size={18} /></button>
            )}
          </div>
        ))}
        <Cell icon="userPlus" color="#8B6CFF" title="Add account" sub="Sign in to another account and switch between them" chevron={false} onClick={() => { rememberAccount(me, localStorage.getItem('linkup_token')); addAccount(); }} />
      </div>

      <div className="group-list mt">
        <Cell icon="logout" color="#8A8A99" title="Sign out" chevron={false} onClick={() => setAsk({ title: 'Sign out of this phone?', ok: 'Sign out', danger: true, run: async () => { await disablePush().catch(() => {}); logout(); } })} />
        <Cell icon="trash" danger title="Delete my account" chevron={false} onClick={() => { setDelPw(''); setAsk({ del: true }); }} />
      </div>

      <Sheet open={!!pw} onClose={() => setPw(null)} title="Change password">
        {pw && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); changePassword(); }}>
            <input type="password" autoComplete="current-password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <input type="password" autoComplete="new-password" placeholder="New password (6 or more characters)" minLength={6} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <p className="muted small">Your other devices will need to sign in again.</p>
            <button className="btn primary block" disabled={busy || !pw.current || pw.next.length < 6}>Change password</button>
          </form>
        )}
      </Sheet>

      <Confirm ask={ask && !ask.del ? ask : null} onClose={() => setAsk(null)} />
      <Confirm ask={ask?.del ? {
        title: 'Delete your account?', danger: true, ok: 'Delete account', quiet: true,
        body: 'You are signed out everywhere, your friends and pictures are removed, and your messages show as "Deleted account". This can\'t be undone.',
        input: <input type="password" className="mt" placeholder="Your password" value={delPw} onChange={(e) => setDelPw(e.target.value)} autoComplete="current-password" />,
        run: async () => {
          try { await post('/me/delete', { password: delPw }); } catch (e) { toast({ title: 'Not deleted', body: e.message }); throw e; }
          if (me?.id) forgetAccount(me.id);
          await disablePush().catch(() => {});
          setToken(null); location.replace('/');
        },
      } : null} onClose={() => setAsk(null)} />
    </>
  );
}

/* ---------- Linked devices ---------- */
export function Devices() {
  const { toast } = useApp();
  const [list, setList] = useState(null);
  const [link, setLink] = useState(null);
  const [left, setLeft] = useState(0);
  const [ask, setAsk] = useState(null);
  const load = () => get('/sessions').then((r) => setList(r.sessions)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!link) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((Date.parse(link.expires_at) - Date.now()) / 1000));
      setLeft(s);
      if (!s) { setLink(null); load(); }
    }, 1000);
    return () => clearInterval(t);
  }, [link]);
  const makeLink = async () => {
    try { const r = await post('/link-codes'); setLink(r); setLeft(600); } catch (e) { toast({ title: 'Could not make a link', body: e.message }); }
  };
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ title: 'Sign in to Linkup', url: link.url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(link.url); toast({ title: 'Link copied', body: 'Open it on the other device' }); } catch { toast({ title: 'Could not copy' }); }
  };
  const cur = list?.find((s) => s.current);
  const others = (list || []).filter((s) => !s.current);
  return (
    <>
      <Header back="/you" title="Linked devices" />
      <section className="perm-card">
        <span className="perm-state"><Icon name="devices" size={26} /></span>
        <b>Use Linkup on another phone, tablet or computer</b>
        <p>Scan the code with the other device's camera (or open the link there). It signs in straight away. The code works once, for 10 minutes.</p>
        <button className="btn primary block" onClick={makeLink}><Icon name="qr" size={20} />Link a device</button>
      </section>
      {cur && (
        <>
          <div className="list-label">This device</div>
          <div className="group-list">
            <div className="row-item cell"><span className="tile-ic" style={{ '--c': '#14A36B' }}><Icon name={deviceIcon(cur.device)} size={19} /></span>
              <span className="grow"><b>{cur.device}</b><small>Active now</small></span></div>
          </div>
        </>
      )}
      {others.length > 0 && (
        <>
          <div className="list-label">Other devices</div>
          <div className="group-list">
            {others.map((s) => (
              <div key={s.id} className="row-item cell">
                <span className="tile-ic" style={{ '--c': '#3B8EF0' }}><Icon name={deviceIcon(s.device)} size={19} /></span>
                <span className="grow"><b>{s.device}</b><small>Last active {ago(s.last_active)} · since {new Date(s.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></span>
                <button className="btn small" onClick={() => setAsk({ title: `Log out ${s.device}?`, ok: 'Log out', danger: true, run: async () => { await del(`/sessions/${s.id}`); load(); } })}>Log out</button>
              </div>
            ))}
          </div>
          <div className="group-list mt">
            <Cell icon="logout" danger title="Log out all other devices" chevron={false} onClick={() => setAsk({
              title: 'Log out all other devices?', body: 'Only this one stays signed in.', ok: 'Log out others', danger: true,
              run: async () => { const r = await post('/sessions/others/revoke'); load(); toast({ title: `Logged out ${r.revoked} device${r.revoked === 1 ? '' : 's'}` }); },
            })} />
          </div>
        </>
      )}
      {list && !others.length && <p className="muted small center mt pad">No other devices are signed in.</p>}

      <Sheet open={!!link} onClose={() => setLink(null)} title="Link a device">
        {link && (
          <div className="invite-card">
            <QR text={link.url} size={220} />
            <p className="mono center big">{link.code.replace(/(.{4})/, '$1 ')}</p>
            <p className="muted small center">Scan with the other device, or open <b>{link.url.replace(/^https?:\/\//, '')}</b> on it. Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.</p>
            <button className="btn block" onClick={share}><Icon name="share" size={18} />Send the link</button>
          </div>
        )}
      </Sheet>
      <Confirm ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}

/* Opened a "link a device" link while already signed in here: sign in as that account (added to this phone). */
export function LinkRedeem() {
  const { code } = useParams();
  const { navigate, toast, me } = useApp();
  const [err, setErr] = useState('');
  useEffect(() => {
    api(`/auth/link/${code}`, { method: 'POST', body: {} }).then((r) => {
      if (r.user.id === me?.id) { toast({ title: 'Already signed in', body: 'This device is linked' }); navigate('/', { replace: true }); return; }
      rememberAccount(r.user, r.token);
      setToken(r.token); location.replace('/');
    }).catch((e) => setErr(e.message));
  }, [code]); // eslint-disable-line
  return (
    <>
      <Header back="/" title="Link device" />
      {err ? <p className="center mt pad">{err}</p> : <div className="spinner" />}
    </>
  );
}
