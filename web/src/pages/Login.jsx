import { useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Avatar, Icon } from '../components/ui.jsx';
import { sceneUrl } from '../lib/art.js';
import { savedAccounts, forgetAccount } from '../lib/accounts.js';
import { setToken } from '../lib/api.js';

const inviteFromPath = () => (location.pathname.match(/^\/join\/([^/]+)/) || [])[1] || null;
const linkFromPath = () => (location.pathname.match(/^\/link\/([^/]+)/) || [])[1] || null;
const adding = () => { try { return sessionStorage.getItem('linkup_adding') === '1'; } catch { return false; } };

export default function Login() {
  const { login, config } = useApp();
  const invite = inviteFromPath();
  const [inviter, setInviter] = useState(null);
  const [step, setStep] = useState(invite ? 'register' : adding() ? 'login' : 'welcome'); // welcome | login | register
  const [accounts, setAccounts] = useState(savedAccounts);
  const [linking, setLinking] = useState(!!linkFromPath());
  const [f, setF] = useState({ username: '', display_name: '', password: '', code: '' });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const userRef = useRef(null);

  useEffect(() => {
    if (!invite) return;
    try { sessionStorage.setItem('linkup_invite', invite); } catch { /* ignore */ }
    get(`/invite-link/${invite}`).then((r) => setInviter(r.user)).catch(() => setErr('This invite link has expired. You can still create an account.'));
  }, [invite]);
  useEffect(() => { if (step !== 'welcome' && !linking) setTimeout(() => userRef.current?.focus(), 350); }, [step]); // eslint-disable-line

  // Opened a "link a device" link from a signed-in phone: sign straight in.
  useEffect(() => {
    const code = linkFromPath();
    if (!code) return;
    post(`/auth/link/${code}`).then((r) => login(r.token, r.user)).catch((x) => { setLinking(false); setStep('login'); setErr(x.message); });
  }, []); // eslint-disable-line

  const passkey = async () => {
    setErr(''); setBusy(true);
    try {
      const { options, challenge_id } = await post('/auth/passkey/options');
      const response = await startAuthentication({ optionsJSON: options });
      const r = await post('/auth/passkey', { challenge_id, response });
      login(r.token, r.user);
    } catch (x) {
      if (x?.name !== 'NotAllowedError' && x?.name !== 'AbortError') { setErr(x.message); setShake((n) => n + 1); }
    } finally { setBusy(false); }
  };
  // Continue as an account already signed in on this phone.
  const resume = async (a) => {
    setBusy(true);
    setToken(a.token);
    try { const r = await get('/me'); login(a.token, r.user); }
    catch { setToken(null); forgetAccount(a.id); setAccounts(savedAccounts()); setErr(`@${a.username} was signed out. Sign in again.`); }
    finally { setBusy(false); }
  };

  const set = (k) => (e) => setF({ ...f, [k]: k === 'username' ? e.target.value.replace(/\s/g, '') : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const body = step === 'login' ? { username: f.username, password: f.password } : { ...f, invite };
      const r = await post(step === 'login' ? '/auth/login' : '/auth/register', body);
      login(r.token, r.user);
    } catch (x) {
      setErr(x.message); setShake((n) => n + 1);
    } finally { setBusy(false); }
  };

  const needCode = step === 'register' && config?.registrationCodeRequired && !inviter;

  return (
    <div className="login">
      <div className="blobs" aria-hidden="true"><i /><i /><i /></div>

      <div className={`login-hero ${step !== 'welcome' ? 'up' : ''}`}>
        <div className="float"><img className="login-logo" src="/brand/logo.svg" alt="" width={step === 'welcome' ? 120 : 76} height={step === 'welcome' ? 120 : 76} draggable="false" /></div>
        <h1 className="wordmark" aria-label="Linkup">{'Linkup'.split('').map((c, i) => <span key={i} style={{ animationDelay: `${120 + i * 60}ms` }}>{c}</span>)}</h1>
        <p className="tagline">Your people. Your plans. One chat.</p>
      </div>

      {inviter && (
        <div className="invite-banner">
          <Avatar user={inviter} size={36} />
          <span><b>{inviter.display_name}</b> invited you. Sign up and you're connected straight away.</span>
        </div>
      )}

      {linking ? <div className="spinner" /> : step === 'welcome' ? (
        <div className="welcome-actions">
          {accounts.length > 0 && (
            <div className="saved-accounts">
              {accounts.map((a) => (
                <button key={a.id} className="saved-acc" onClick={() => resume(a)} disabled={busy}>
                  <Avatar user={a} size={40} /><span className="grow"><b>Continue as {a.display_name.split(' ')[0]}</b><small>@{a.username}</small></span><Icon name="right" size={18} />
                </button>
              ))}
            </div>
          )}
          <img className="hello-cast" src={sceneUrl('hello')} alt="" draggable="false" />
          <button className="btn primary block big-btn" onClick={() => setStep('register')}>Create account</button>
          <button className="btn quiet block" onClick={() => setStep('login')}>I already have an account</button>
          <ul className="perks">
            <li><Icon name="chat" size={18} />Chat, send photos and voice notes, video call</li>
            <li><Icon name="cal" size={18} />See who's free and plan together</li>
            <li><Icon name="spark" size={18} />Ask Planner anything. It books plans and reminds everyone</li>
          </ul>
        </div>
      ) : (
        <form key={shake} onSubmit={submit} className={`login-card ${shake ? 'shake' : ''}`}>
          <div className="seg">
            <button type="button" className={step === 'register' ? 'on' : ''} onClick={() => { setStep('register'); setErr(''); }}>Create account</button>
            <button type="button" className={step === 'login' ? 'on' : ''} onClick={() => { setStep('login'); setErr(''); }}>Sign in</button>
          </div>
          <label className="field">
            <input ref={userRef} autoComplete="username" autoCapitalize="none" autoCorrect="off" placeholder=" " value={f.username} onChange={set('username')} required />
            <span>Username</span>
          </label>
          {step === 'register' && (
            <label className="field">
              <input autoComplete="name" placeholder=" " value={f.display_name} onChange={set('display_name')} />
              <span>Your name (what friends see)</span>
            </label>
          )}
          <label className="field">
            <input type={show ? 'text' : 'password'} autoComplete={step === 'login' ? 'current-password' : 'new-password'} placeholder=" " value={f.password} onChange={set('password')} required minLength={6} />
            <span>Password</span>
            <button type="button" className="peek" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </label>
          {needCode && (
            <label className="field">
              <input placeholder=" " value={f.code} onChange={set('code')} required />
              <span>Invite code</span>
            </label>
          )}
          {err && <p className="error">{err}</p>}
          <button className="btn primary block big-btn" disabled={busy}>
            {busy ? <span className="btn-spin" /> : step === 'login' ? 'Sign in' : inviter ? `Join ${inviter.display_name.split(' ')[0]}` : 'Create account'}
          </button>
          {step === 'register' && <p className="muted small center">Usernames are 3 to 20 letters or numbers. Friends add you with it.</p>}
          {step === 'login' && browserSupportsWebAuthn() && (
            <button type="button" className="btn block passkey-btn" onClick={passkey} disabled={busy}><Icon name="key" size={19} />Sign in with a passkey</button>
          )}
          {adding() && accounts.length > 0 && (
            <button type="button" className="btn quiet block" onClick={() => { try { sessionStorage.removeItem('linkup_adding'); } catch { /* ignore */ } resume(accounts[0]); }}>Cancel, back to @{accounts[0].username}</button>
          )}
        </form>
      )}
    </div>
  );
}
