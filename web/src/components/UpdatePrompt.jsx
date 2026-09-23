import { useState } from 'react';
import { useUpdate } from '../lib/update.js';
import { Icon } from './ui.jsx';

// "New version ready": drops in from the island when a newer version is live. Update reloads into it.
export default function UpdatePrompt() {
  const { ready, apply } = useUpdate();
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ready || later) return null;
  return (
    <div className="island-wrap" role="status">
      <div className="island update-island">
        <span className="island-ic"><Icon name="spark" size={18} /></span>
        <span className="grow"><b className="ellipsis">New version ready</b><small className="ellipsis">Get the latest fixes</small></span>
        <button className="island-btn" disabled={busy} onClick={() => { setBusy(true); apply(); }}>{busy ? 'Updating…' : 'Update'}</button>
        <button className="island-x" onClick={() => setLater(true)} aria-label="Later"><Icon name="x" size={16} /></button>
      </div>
    </div>
  );
}
