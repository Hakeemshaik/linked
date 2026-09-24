import { useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { enablePush, pushState } from '../lib/push.js';
import { shareInvite } from '../lib/share.js';
import { Icon } from './ui.jsx';

const KEY = 'linkup_setup_hidden';
const hidden = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

// Three quick things that make Linkup work well. Goes away once they're done (or dismissed).
export default function SetupCard() {
  const { me, friends, navigate, toast, config } = useApp();
  const [push, setPush] = useState(pushState);
  const [gone, setGone] = useState(hidden);
  if (!me || gone) return null;
  const steps = [
    { done: !!me.avatar, icon: 'friends', title: 'Pick a profile picture', go: () => navigate('/you/profile') },
    { done: push === 'granted', icon: 'bell', title: push === 'denied' ? 'Notifications are blocked in your phone settings' : 'Turn on notifications',
      go: async () => { try { await enablePush(config?.vapidPublicKey); toast({ title: 'Notifications on' }); } catch (e) { toast({ title: 'Notifications are off', body: e.message, ms: 7000 }); } setPush(pushState()); } },
    { done: friends.friends.length > 0, icon: 'userPlus', title: 'Invite a friend', go: () => shareInvite(me, toast) },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;
  const hide = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setGone(true); };
  return (
    <section className="setup">
      <div className="setup-head">
        <b>Get set up</b><span className="muted small">{3 - left} of 3</span>
        <button className="icon-plain sm" onClick={hide} aria-label="Hide"><Icon name="x" size={18} /></button>
      </div>
      <div className="setup-bar"><i style={{ width: `${((3 - left) / 3) * 100}%` }} /></div>
      {steps.map((s) => (
        <button key={s.title} className={`setup-row ${s.done ? 'done' : ''}`} onClick={s.done ? undefined : s.go} disabled={s.done}>
          <span className="check-ic">{s.done ? <Icon name="check" size={16} /> : <Icon name={s.icon} size={17} />}</span>
          <span className="grow">{s.title}</span>
          {!s.done && <Icon name="right" size={18} className="muted" />}
        </button>
      ))}
    </section>
  );
}
