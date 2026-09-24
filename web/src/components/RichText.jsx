import { EMOJI_IDS, emojiUrl } from '../lib/art.js';

const TOKEN = /:([a-z]+):/g;
const PARTS = /:([a-z]+):|@(planner|ai)\b|(\bhttps?:\/\/[^\s<>"')]+[^\s<>"').,!?:;])/gi;

/** How many of the app's own emoji a message is made of, if it's nothing else (1 to 3), else 0. Those show big. */
export function emojiOnly(text = '') {
  let n = 0;
  const rest = text.replace(TOKEN, (m, id) => (EMOJI_IDS.has(id) ? (n++, '') : m));
  return !rest.trim() && n >= 1 && n <= 3 ? n : 0;
}

/** Plain text, with a search term marked. */
function marked(text, term, key) {
  if (!term || term.length < 2) return text;
  const out = [];
  const lower = text.toLowerCase(), t = term.toLowerCase();
  let at = 0, i;
  while ((i = lower.indexOf(t, at)) !== -1) {
    out.push(text.slice(at, i), <mark key={`${key}-${i}`}>{text.slice(i, i + t.length)}</mark>);
    at = i + t.length;
  }
  out.push(text.slice(at));
  return out;
}

/** Message text: :love: style codes drawn as the app's emoji, @Planner as a mention, links you can tap. */
export default function RichText({ text = '', highlight = '', links = true }) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(PARTS)) {
    if (m[1] && !EMOJI_IDS.has(m[1])) continue;
    if (m[3] && !links) continue;
    out.push(marked(text.slice(last, m.index), highlight, last));
    if (m[1]) out.push(<img key={m.index} className="emo" src={emojiUrl(m[1])} alt={m[0]} title={m[1]} draggable="false" />);
    else if (m[3]) {
      out.push(
        <a key={m.index} className="msg-link" href={m[3]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          {marked(m[3].replace(/^https?:\/\/(www\.)?/, ''), highlight, m.index)}
        </a>,
      );
    } else out.push(<b key={m.index} className="mention">@Planner</b>);
    last = m.index + m[0].length;
  }
  out.push(marked(text.slice(last), highlight, last));
  return <>{out}</>;
}
