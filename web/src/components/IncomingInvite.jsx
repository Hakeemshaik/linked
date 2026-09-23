import { useEffect, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { post } from '../lib/api.js';
import { Avatar, Icon } from './ui.jsx';
import { ring } from '../lib/sound.js';

// Full-screen "ringing" card for video-call and chill invites while the app is open.
export default function IncomingInvite() {
  const { incoming, setIncoming, navigate, toast } = useApp();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!incoming) return;
    const stop = incoming.kind === 'call' ? ring('incoming') : (navigator.vibrate?.([150, 80, 150]), () => {});
    const auto = setTimeout(() => setIncoming(null), 45000); // same as the server's ring window
    return () => { stop(); clearTimeout(auto); };
  }, [incoming, setIncoming]);

  if (!incoming) return null;
  const isCall = incoming.kind === 'call';

  const respond = async (accept) => {
    setBusy(true);
    try {
      const r = await post(`/invites/${incoming.id}/respond`, { accept });
      setIncoming(null);
      if (accept && isCall) navigate(`/call/${r.room_id}`);
      else if (accept) toast({ title: `Told ${incoming.from.display_name} you're down` });
    } catch (e) {
      toast({ title: 'Could not respond', body: e.message });
      setIncoming(null);
    } finally { setBusy(false); }
  };

  return (
    <div className="ring-backdrop" role="alertdialog" aria-label={`${incoming.from.display_name} ${isCall ? 'is calling' : 'wants to chill'}`}>
      <div className="ring">
        <p className="ring-kind">{isCall ? 'Linkup video call' : 'Chill invite'}</p>
        <div className={isCall ? 'ring-pulse' : ''}><Avatar user={incoming.from} size={112} /></div>
        <h2>{incoming.from.display_name}</h2>
        <p className="muted">{isCall ? 'is calling you' : 'wants to chill'}</p>
        {incoming.message && <p className="ring-msg">“{incoming.message}”</p>}
        <div className="ring-actions">
          <div className="ring-act">
            <button className="ring-btn no" disabled={busy} onClick={() => respond(false)} aria-label="Decline"><Icon name={isCall ? 'phone' : 'x'} size={30} /></button>
            <span>{isCall ? 'Decline' : 'Not now'}</span>
          </div>
          <div className="ring-act">
            <button className="ring-btn yes" disabled={busy} onClick={() => respond(true)} aria-label={isCall ? 'Join' : "I'm down"}><Icon name={isCall ? 'video' : 'check'} size={30} /></button>
            <span>{isCall ? 'Join' : "I'm down"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
