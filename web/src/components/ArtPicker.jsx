import { useState } from 'react';
import { Sheet } from './ui.jsx';
import { EMOJI, STICKERS, GIFS, emojiUrl, stickerUrl, gifUrl } from '../lib/art.js';

const TABS = [['emoji', 'Emoji'], ['sticker', 'Stickers'], ['gif', 'GIFs']];

// Emoji go into the message you're typing; stickers and GIFs send straight away.
export default function ArtPicker({ open, onClose, onEmoji, onSend }) {
  const [tab, setTab] = useState('emoji');
  return (
    <Sheet open={open} onClose={onClose} title="Emoji, stickers and GIFs">
      <div className="seg">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'emoji' && (
        <div className="art-grid emoji">
          {EMOJI.map((e) => <button key={e.id} onClick={() => onEmoji(e.id)} aria-label={e.name}><img src={emojiUrl(e.id)} alt="" /></button>)}
        </div>
      )}
      {tab === 'sticker' && (
        <div className="art-grid stickers">
          {STICKERS.map((s) => <button key={s.id} onClick={() => onSend('sticker', s.id)} aria-label={s.label}><img src={stickerUrl(s.id)} alt="" loading="lazy" /></button>)}
        </div>
      )}
      {tab === 'gif' && (
        <div className="art-grid gifs">
          {GIFS.map((g) => <button key={g.id} onClick={() => onSend('gif', g.id)} aria-label={g.label}><img src={gifUrl(g.id)} alt="" loading="lazy" /></button>)}
        </div>
      )}
    </Sheet>
  );
}
