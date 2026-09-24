import { EMOJI_IDS, emojiUrl } from '../lib/art.js';

const TOKEN = /:([a-z]+):/g;
const PARTS = /:([a-z]+):|@(planner|ai)\b/gi;

/** How many of the app's own emoji a message is made of, if it's nothing else (1 to 3), else 0. Those show big. */
export function emojiOnly(text = '') {
  let n = 0;
  const rest = text.replace(TOKEN, (m, id) => (EMOJI_IDS.has(id) ? (n++, '') : m));
  return !rest.trim() && n >= 1 && n <= 3 ? n : 0;
}

/** Message text with :love: style codes drawn as the app's emoji, and @Planner shown as a mention. */
export default function RichText({ text = '' }) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(PARTS)) {
    if (m[1] && !EMOJI_IDS.has(m[1])) continue;
    out.push(text.slice(last, m.index));
    out.push(m[1]
      ? <img key={m.index} className="emo" src={emojiUrl(m[1])} alt={m[0]} title={m[1]} draggable="false" />
      : <b key={m.index} className="mention">@Planner</b>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
