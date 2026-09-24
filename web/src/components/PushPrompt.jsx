import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { enablePush, pushState } from '../lib/push.js';
import { post } from '../lib/api.js';
import { settingsSteps } from '../lib/perms.js';
import { Icon, Sheet } from './ui.jsx';

const KEY = 'linkup_push_snooze';
const SNOOZE_MS = 3 * 86400000;
const snoozed = () => { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < SNOOZE_MS; } catch { return false; } };
const snooze = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ } };

// Asks for notifications when the app opens and they're not on yet (again 3 days after "Not now").
// On iPhone in a Safari tab, push can't work at all, so it explains how to add Linkup to the Home Screen.
export default function PushPrompt() {
  const { config, toast, incoming, nudge, setNudge } = useApp();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [st] = useState(pushState);
  const ask = st === 'default' || st === 'needs-install' || (st === 'denied' && !!nudge);
  useEffect(() => {
    // A friend's nudge asks straight away, even if you tapped "Not now" before.
    if (!ask || (snoozed() && !nudge)) return;
    const t = setTimeout(() => setOpen(true), nudge ? 900 : 1600); // after the splash
    return () => clearTimeout(t);
  }, [ask, nudge]);
  const seen = () => { if (nudge) { setNudge(null); post('/nudges/seen').catch(() => {}); } };
  if (!open || incoming || pathname.startsWith('/call/') || pathname.startsWith('/join/')) return null;

  const later = () => { snooze(); seen(); setOpen(false); };
  const turnOn = async () => {
    setBusy(true);
    try { await enablePush(config?.vapidPublicKey); seen(); toast({ title: 'Notifications on', body: "You'll hear about calls, messages and plans" }); setOpen(false); }
    catch (e) { toast({ title: 'Notifications are off', body: e.message, ms: 7000 }); snooze(); setOpen(false); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={later}>
      <div className="prompt">
        <span className="prompt-ic"><Icon name="bell" size={34} /></span>
        {st === 'needs-install' ? (
          <>
            <h3>Get Linkup on your Home Screen</h3>
            <p>iPhone only sends calls and messages to apps on the Home Screen.</p>
            <ol className="prompt-steps">
              <li><b>1</b>Tap <Icon name="share" size={18} /> <b>Share</b> at the bottom of Safari</li>
              <li><b>2</b>Choose <b>Add to Home Screen</b></li>
              <li><b>3</b>Open Linkup from your Home Screen</li>
            </ol>
            <button className="btn primary block big-btn" onClick={later}>Got it</button>
          </>
        ) : st === 'denied' ? (
          <>
            <h3>{nudge?.by?.split(' ')[0] || 'A friend'} wants to reach you</h3>
            <p>Notifications for Linkup are switched off on this phone. Here's how to turn them back on:</p>
            <ol className="prompt-steps">{settingsSteps('Notifications').map((x, i) => <li key={i}><b>{i + 1}</b>{x}</li>)}</ol>
            <button className="btn primary block big-btn" onClick={later}>Got it</button>
          </>
        ) : (
          <>
            <h3>{nudge ? `${nudge.by?.split(' ')[0] || 'A friend'} wants to reach you` : "Don't miss a call"}</h3>
            <p>{nudge ? `${nudge.by?.split(' ')[0] || 'Your friend'} asked you to turn on notifications, so their calls and messages reach you even when Linkup is closed.` : 'Turn on notifications to hear about calls, messages and plan reminders, even when Linkup is closed.'}</p>
            <button className="btn primary block big-btn" disabled={busy} onClick={turnOn}>{busy ? 'Turning on…' : 'Turn on notifications'}</button>
            <button className="btn quiet block" onClick={later}>Not now</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
