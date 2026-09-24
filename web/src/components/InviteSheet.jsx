import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { get, post } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Avatar, Icon, Sheet } from './ui.jsx';

/** A QR code as crisp rounded dots, with the Linkup mark in the middle (high error correction keeps it scannable). */
export function QR({ text, size = 220, logo = true }) {
  const svg = useMemo(() => {
    if (!text) return null;
    const qr = qrcode(0, 'H');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const hole = logo ? Math.ceil(n * 0.24) | 1 : 0; // keep the middle clear for the mark
    const lo = Math.floor((n - hole) / 2), hi = lo + hole;
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    const dots = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || finder(r, c) || (logo && r >= lo && r < hi && c >= lo && c < hi)) continue;
      dots.push(`<rect x="${c + 0.08}" y="${r + 0.08}" width=".84" height=".84" rx=".32"/>`);
    }
    const eye = (x, y) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" fill="currentColor">${dots.join('')}${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</svg>`;
  }, [text, logo]);
  if (!svg) return <div className="qr" style={{ width: size, height: size }}><span className="spinner sm" /></div>;
  return (
    <div className="qr" style={{ width: size, height: size }}>
      <span className="qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
      {logo && <img className="qr-logo" src="/brand/logo.svg" alt="" draggable="false" />}
    </div>
  );
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/* Inviting, made easy: your code to scan, a link to share, your username, and adding someone by theirs. */
export default function InviteSheet({ open, onClose }) {
  const { me, toast, loadFriends } = useApp();
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || link) return;
    get('/invite-link').then((r) => setLink(r.url || `${location.origin}/join/${r.token}`)).catch((e) => toast({ title: 'Could not make your link', body: e.message }));
  }, [open]); // eslint-disable-line

  const text = `${me?.display_name || 'I'} invited you to Linkup. Tap to join and we'll be connected:`;
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Join me on Linkup', text, url: link }); onClose(); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    const copied = await copy(`${text} ${link}`);
    toast({ title: copied ? 'Invite link copied' : 'Could not copy', body: 'Paste it in a message to your friend' });
    if (copied) onClose();
  };
  const add = async (e) => {
    e.preventDefault();
    const u = name.trim().replace(/^@/, '');
    if (!u) return;
    setBusy(true);
    try {
      const r = await post('/friends/request', { username: u });
      toast({ title: r.accepted ? 'You are now friends' : 'Request sent', body: r.accepted ? undefined : `@${u} needs to accept` });
      setName(''); loadFriends();
    } catch (x) { toast({ title: 'Could not add', body: x.message }); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Invite friends">
      <div className="invite-card">
        <div className="invite-who"><Avatar user={me} size={44} /><span className="grow"><b>{me?.display_name}</b><small className="muted">@{me?.username}</small></span></div>
        <QR text={link} size={216} />
        <p className="muted small center">Scan with any phone camera. You're connected as soon as they join.</p>
      </div>
      <div className="invite-actions">
        <button className="btn primary grow big-btn" onClick={share} disabled={!link}><Icon name="share" size={20} />Share invite link</button>
      </div>
      <div className="invite-actions">
        <button className="btn grow" onClick={async () => toast({ title: (await copy(link)) ? 'Link copied' : 'Could not copy' })} disabled={!link}><Icon name="link" size={18} />Copy link</button>
        <button className="btn grow" onClick={async () => toast({ title: (await copy(`@${me?.username}`)) ? 'Username copied' : 'Could not copy', body: 'Friends can add you with it' })}><Icon name="copy" size={18} />@{me?.username}</button>
      </div>
      <form className="add-by-name" onSubmit={add}>
        <label className="search grow">
          <Icon name="userPlus" size={18} />
          <input value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, ''))} placeholder="Add by username" autoCapitalize="none" autoCorrect="off" aria-label="Add a friend by username" />
        </label>
        <button className="btn primary" disabled={!name.trim() || busy}>Add</button>
      </form>
    </Sheet>
  );
}
