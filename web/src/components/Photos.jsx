import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui.jsx';
import RichText from './RichText.jsx';
import { prepareImage, mediaUrl, savePhoto } from '../lib/media.js';
import { fmtTime, relDay } from '../lib/dates.js';

/** How big a photo shows in the chat: fits 250x320, keeps its shape, never a sliver. */
export function photoSize(w = 4, h = 3) {
  let dw = 250;
  let dh = (dw * h) / w;
  if (dh > 320) { dh = 320; dw = Math.max(150, (dh * w) / h); }
  return { w: Math.round(dw), h: Math.round(Math.max(110, dh)) };
}

/* Picked photos: look them over, add a caption, send. Up to 10 at once. */
export function PhotoSend({ files, title, onClose, onSend }) {
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(0);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const list = files.slice(0, 10).map((file, i) => {
      const it = { key: `${i}-${file.name}-${file.size}`, preview: URL.createObjectURL(file) };
      it.ready = prepareImage(file).catch(() => null); // shrink while they look
      return it;
    });
    setItems(list);
    return () => list.forEach((it) => URL.revokeObjectURL(it.preview));
  }, [files]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const remove = (i) => {
    const next = items.filter((_, j) => j !== i);
    if (!next.length) return onClose();
    setItems(next);
    setSel((s) => Math.min(s, next.length - 1));
  };
  const send = async (e) => {
    e?.preventDefault();
    setBusy(true);
    const ready = (await Promise.all(items.map((it) => it.ready))).filter(Boolean);
    setBusy(false);
    if (ready.length) onSend(ready, caption.trim());
    onClose();
  };
  const cur = items[sel];

  return createPortal(
    <div className="photo-send" role="dialog" aria-label="Send photos">
      <header className="viewer-bar">
        <button type="button" className="round-glass" onClick={onClose} aria-label="Cancel"><Icon name="x" size={22} /></button>
        <span className="grow ellipsis center">{title}</span>
        {items.length > 1 ? <button type="button" className="round-glass" onClick={() => remove(sel)} aria-label="Remove this photo"><Icon name="trash" size={20} /></button> : <span style={{ width: 40 }} />}
      </header>
      <div className="photo-stage">{cur && <img key={cur.key} src={cur.preview} alt="" draggable="false" />}</div>
      {items.length > 1 && (
        <div className="photo-strip">
          {items.map((it, i) => (
            <button key={it.key} type="button" className={i === sel ? 'on' : ''} onClick={() => setSel(i)} aria-label={`Photo ${i + 1}`}>
              <img src={it.preview} alt="" draggable="false" />
            </button>
          ))}
        </div>
      )}
      <form className="photo-caption" onSubmit={send}>
        <div className="input-pill"><input ref={inputRef} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption" aria-label="Caption" enterKeyHint="send" /></div>
        <button className="send ready" disabled={busy} aria-label={`Send ${items.length > 1 ? `${items.length} photos` : 'photo'}`}>
          {busy ? <span className="btn-spin" /> : <Icon name="send" size={20} />}
          {items.length > 1 && <b className="count">{items.length}</b>}
        </button>
      </form>
    </div>,
    document.body,
  );
}

/* Full-screen photo. Swipe down or tap X to close; Save opens the phone's share sheet. */
export function PhotoViewer({ m, who, onClose, toast }) {
  const [dy, setDy] = useState(0);
  const drag = useRef(null);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const src = m.local || mediaUrl(m.data?.url);
  const down = (e) => { if (!e.target.closest('button')) drag.current = { y: e.clientY, id: e.pointerId }; };
  const move = (e) => { if (drag.current?.id === e.pointerId) setDy(Math.max(-120, e.clientY - drag.current.y)); };
  const up = () => { if (!drag.current) return; drag.current = null; if (Math.abs(dy) > 110) onClose(); else setDy(0); };
  const save = async () => {
    try { await savePhoto(m.data?.url); } catch { toast?.({ title: "Couldn't save the photo" }); }
  };
  return createPortal(
    <div className="viewer" style={{ '--dy': `${dy}px`, '--fade': 1 - Math.min(0.7, Math.abs(dy) / 360) }} role="dialog" aria-label="Photo"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <header className="viewer-bar">
        <button type="button" className="round-glass" onClick={onClose} aria-label="Close"><Icon name="x" size={22} /></button>
        <span className="grow viewer-who"><b className="ellipsis">{who}</b><small>{relDay(m.created_at)}, {fmtTime(m.created_at)}</small></span>
        {m.data?.url && <button type="button" className="round-glass" onClick={save} aria-label="Save photo"><Icon name="download" size={21} /></button>}
      </header>
      <div className="viewer-stage"><img src={src} alt={m.body || 'Photo'} draggable="false" /></div>
      {m.body && <p className="viewer-caption"><RichText text={m.body} /></p>}
    </div>,
    document.body,
  );
}
