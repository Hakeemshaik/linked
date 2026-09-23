// The Linkup character kit: one set of shapes that draws every profile picture, emoji, sticker and GIF,
// so they all look like one family. Everything is plain SVG in a 100x100 box.

export const INK = '#2A1B3D';
const CHEEK = '#FF8FB1';
let uid = 0;
const nid = (p) => `${p}${++uid}`;

export const grad = (id, a, b, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

const BODY = {
  blob: 'M50 21 C73 21 85 38 85 59 C85 80 71 90 50 90 C29 90 15 80 15 59 C15 38 27 21 50 21 Z',
  round: 'M50 16 C74 16 88 33 88 55 C88 77 72 90 50 90 C28 90 12 77 12 55 C12 33 26 16 50 16 Z',
  ghost: 'M50 18 C72 18 84 34 84 56 L84 86 Q78 80 72 86 Q66 92 60 86 Q55 80 50 86 Q45 92 40 86 Q34 80 28 86 Q22 92 16 86 L16 56 C16 34 28 18 50 18 Z',
  robot: 'M26 30 H74 Q86 30 86 42 V78 Q86 90 74 90 H26 Q14 90 14 78 V42 Q14 30 26 30 Z',
};

export function eyes(kind, { y = 55, dx = 12, cx = 50, color = INK } = {}) {
  const at = [cx - dx, cx + dx];
  const arc = (x, up) => `<path d="M${x - 5} ${y + (up ? 1.5 : -1)} Q${x} ${y + (up ? -5 : 4)} ${x + 5} ${y + (up ? 1.5 : -1)}" stroke="${color}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
  const dot = (x, r = 1) => `<ellipse cx="${x}" cy="${y}" rx="${4.4 * r}" ry="${5.4 * r}" fill="${color}"/><circle cx="${x + 1.6 * r}" cy="${y - 2.1 * r}" r="${1.7 * r}" fill="#fff"/>`;
  switch (kind) {
    case 'happy': return at.map((x) => arc(x, true)).join('');
    case 'closed': return at.map((x) => arc(x, false)).join('');
    case 'wink': return dot(at[0]) + arc(at[1], true);
    case 'big': return at.map((x) => `<ellipse cx="${x}" cy="${y}" rx="6" ry="7" fill="${color}"/><circle cx="${x + 2}" cy="${y - 2.6}" r="2.4" fill="#fff"/><circle cx="${x - 2}" cy="${y + 2.4}" r="1.1" fill="#fff"/>`).join('');
    case 'side': return at.map((x) => `<ellipse cx="${x + 2.5}" cy="${y + 0.5}" rx="3.6" ry="4.2" fill="${color}"/><path d="M${x - 6} ${y - 4.5} H${x + 6}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`).join('');
    case 'x': return at.map((x) => `<path d="M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`).join('');
    case 'shades': return `<path d="M${cx - dx - 9} ${y - 5} H${cx + dx + 9}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      at.map((x) => `<path d="M${x - 8} ${y - 5} H${x + 8} Q${x + 8} ${y + 7} ${x} ${y + 7} Q${x - 8} ${y + 7} ${x - 8} ${y - 5} Z" fill="${INK}"/><path d="M${x - 5} ${y - 2} L${x - 1} ${y - 2}" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`).join('');
    default: return at.map((x) => dot(x)).join('');
  }
}

export function mouth(kind, { y = 67, cx = 50 } = {}) {
  switch (kind) {
    case 'open': return `<path d="M${cx - 7} ${y - 1} Q${cx} ${y + 11} ${cx + 7} ${y - 1} Z" fill="#7A1F3D"/><ellipse cx="${cx}" cy="${y + 5.2}" rx="3.4" ry="2.2" fill="#FF6F91"/>`;
    case 'grin': return `<path d="M${cx - 11} ${y - 2} Q${cx} ${y + 13} ${cx + 11} ${y - 2} Z" fill="#7A1F3D"/><path d="M${cx - 9} ${y - 1} H${cx + 9} L${cx + 8} ${y + 2} H${cx - 8} Z" fill="#fff"/><ellipse cx="${cx}" cy="${y + 7}" rx="4.5" ry="2.5" fill="#FF6F91"/>`;
    case 'o': return `<ellipse cx="${cx}" cy="${y + 1}" rx="3.4" ry="4.2" fill="${INK}"/>`;
    case 'flat': return `<path d="M${cx - 5} ${y + 1} H${cx + 5}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
    case 'wavy': return `<path d="M${cx - 7} ${y + 1} Q${cx - 3.5} ${y - 2} ${cx} ${y + 1} Q${cx + 3.5} ${y + 4} ${cx + 7} ${y + 1}" stroke="${INK}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
    case 'cat': return `<path d="M${cx - 6} ${y} Q${cx - 3} ${y + 4.5} ${cx} ${y} Q${cx + 3} ${y + 4.5} ${cx + 6} ${y}" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    case 'beak': return `<path d="M${cx - 6} ${y - 3} L${cx} ${y - 7} L${cx + 6} ${y - 3} L${cx} ${y + 3} Z" fill="#FF9A2E"/><path d="M${cx - 6} ${y - 3} L${cx + 6} ${y - 3}" stroke="#E07512" stroke-width="1.2"/>`;
    case 'none': return '';
    default: return `<path d="M${cx - 6} ${y} Q${cx} ${y + 6.5} ${cx + 6} ${y}" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
}

const cheeks = ({ y = 64, dx = 22, cx = 50 } = {}) =>
  `<ellipse cx="${cx - dx}" cy="${y}" rx="5.2" ry="3.2" fill="${CHEEK}" opacity=".6"/><ellipse cx="${cx + dx}" cy="${y}" rx="5.2" ry="3.2" fill="${CHEEK}" opacity=".6"/>`;
const gloss = (x = 35, y = 35) => `<ellipse cx="${x}" cy="${y}" rx="10" ry="5.5" fill="#fff" opacity=".35" transform="rotate(-28 ${x} ${y})"/>`;

// Things on top of (or behind) the head.
function top(kind, c, back) {
  const [light, dark] = c.body;
  const inner = c.inner || '#FFD6E2';
  switch (kind) {
    case 'cat': return back ? `<path d="M20 44 L24 12 L46 28 Z" fill="${dark}"/><path d="M80 44 L76 12 L54 28 Z" fill="${dark}"/><path d="M25 34 L27 20 L39 29 Z" fill="${inner}"/><path d="M75 34 L73 20 L61 29 Z" fill="${inner}"/>` : '';
    case 'fox': return back ? `<path d="M17 48 L20 6 L48 28 Z" fill="${dark}"/><path d="M83 48 L80 6 L52 28 Z" fill="${dark}"/><path d="M23 36 L24 16 L38 28 Z" fill="${inner}"/><path d="M77 36 L76 16 L62 28 Z" fill="${inner}"/>` : '';
    case 'bunny': return back ? `<ellipse cx="36" cy="16" rx="8" ry="20" fill="${dark}" transform="rotate(-12 36 16)"/><ellipse cx="64" cy="16" rx="8" ry="20" fill="${dark}" transform="rotate(12 64 16)"/><ellipse cx="36" cy="17" rx="4" ry="13" fill="${inner}" transform="rotate(-12 36 17)"/><ellipse cx="64" cy="17" rx="4" ry="13" fill="${inner}" transform="rotate(12 64 17)"/>` : '';
    case 'bear': return back ? `<circle cx="25" cy="30" r="11" fill="${dark}"/><circle cx="75" cy="30" r="11" fill="${dark}"/><circle cx="25" cy="30" r="5.5" fill="${inner}"/><circle cx="75" cy="30" r="5.5" fill="${inner}"/>` : '';
    case 'frog': return back ? `<circle cx="35" cy="29" r="13" fill="${light}"/><circle cx="65" cy="29" r="13" fill="${light}"/>` : '';
    case 'tufts': return back ? `<path d="M18 40 L20 14 L38 26 Z" fill="${dark}"/><path d="M82 40 L80 14 L62 26 Z" fill="${dark}"/>` : '';
    case 'sprout': return back ? '' : `<path d="M50 23 Q49 14 51 8" stroke="#3FA34D" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="43" cy="10" rx="8" ry="4.5" fill="#5CC46A" transform="rotate(25 43 10)"/><ellipse cx="58" cy="8" rx="8" ry="4.5" fill="#4DB85C" transform="rotate(-25 58 8)"/>`;
    case 'tuft': return back ? '' : `<path d="M47 23 Q43 13 49 10 M51 22 Q51 11 57 11" stroke="${dark}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    case 'antenna': return back ? '' : `<path d="M50 30 V17" stroke="#6D7A99" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="13" r="5" fill="#FFC23D"/><circle cx="48.5" cy="11.5" r="1.6" fill="#fff" opacity=".8"/>`;
    case 'alien': return back ? '' : `<path d="M40 24 L31 9 M60 24 L69 9" stroke="${dark}" stroke-width="3" stroke-linecap="round"/><circle cx="30" cy="8" r="5" fill="#FFE066"/><circle cx="70" cy="8" r="5" fill="#FFE066"/>`;
    case 'gills': return back ? [[1, 17], [-1, 83]].map(([s, x]) => [34, 46, 58].map((y, i) => `<path d="M${x} ${y} Q${x - s * 12} ${y - 8 + i * 4} ${x - s * 16} ${y - 2 + i * 3}" stroke="${c.gill || '#FF5C9A'}" stroke-width="5.5" fill="none" stroke-linecap="round"/>`).join('')).join('') : '';
    default: return '';
  }
}

/** One character, facing front, in a 100x100 box. Options override the character's defaults (for poses). */
export function character(c, o = {}) {
  const id = nid('b');
  const e = o.eyes || c.eyes || 'dot';
  const m = o.mouth || c.mouth || 'smile';
  const eyeY = c.top === 'frog' ? 30 : c.shape === 'robot' ? 58 : 55;
  const shape = BODY[c.shape || 'blob'];
  const [light, dark] = c.body;
  let s = `<defs>${grad(id, light, dark)}</defs>`;
  s += o.behind || '';
  s += top(c.top, c, true);
  s += `<path d="${shape}" fill="url(#${id})"/>`;
  if (c.belly) s += `<ellipse cx="50" cy="72" rx="20" ry="15" fill="#fff" opacity=".35"/>`;
  if (c.muzzle) s += `<path d="M28 66 Q50 52 72 66 Q66 88 50 88 Q34 88 28 66 Z" fill="#FFF3E6"/>`;
  if (c.snout) s += `<ellipse cx="50" cy="69" rx="13" ry="9.5" fill="${c.inner || '#fff'}"/><ellipse cx="50" cy="64.5" rx="4" ry="2.8" fill="${INK}"/>`;
  if (c.shape === 'robot') s += `<rect x="24" y="42" width="52" height="34" rx="12" fill="#1F2A44"/>`;
  s += top(c.top, c, false);
  if (c.top === 'frog') s += `<circle cx="35" cy="29" r="8.5" fill="#fff"/><circle cx="65" cy="29" r="8.5" fill="#fff"/>`;
  s += c.shape !== 'robot' ? gloss() : `<rect x="30" y="46" width="14" height="4" rx="2" fill="#fff" opacity=".18"/>`;
  s += eyes(e, { y: eyeY + (o.eyeDy || 0), cx: 50 + (o.lookX || 0), color: c.shape === 'robot' ? '#7CF3FF' : INK, dx: c.top === 'frog' ? 15 : 12 });
  if (c.shape !== 'robot' && c.cheeks !== false) s += cheeks({ y: c.top === 'frog' ? 60 : 65, dx: c.top === 'frog' ? 26 : 22 });
  if (c.whiskers) s += `<path d="M18 64 H28 M18 70 L28 68 M82 64 H72 M82 70 L72 68" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>`;
  if (c.beak) s += mouth('beak', { y: 69 });
  else if (!c.snout) s += c.shape === 'robot' ? `<path d="M42 68 Q50 72 58 68" stroke="#7CF3FF" stroke-width="3" fill="none" stroke-linecap="round"/>` : mouth(m, { y: c.top === 'frog' ? 64 : 68 });
  else s += mouth(m === 'smile' ? 'cat' : m, { y: 73 });
  s += o.front || '';
  return s;
}

/** An arm: a rounded capsule from a shoulder, pointing at `angle` degrees (0 = straight down, 180 = straight up). */
export const arm = (c, x, y, angle, len = 22) =>
  `<rect x="-5" y="0" width="10" height="${len}" rx="5" fill="${c.body[1]}" transform="translate(${x} ${y}) rotate(${angle})"/>`;
export const legs = (c, phase = 0) => {
  const a = Math.sin(phase * Math.PI * 2) * 28;
  return [[-a, 40], [a, 60]].map(([ang, x]) => `<rect x="-4.5" y="0" width="9" height="16" rx="4.5" fill="${c.leg || c.body[1]}" transform="translate(${x} 82) rotate(${ang})"/>`).join('');
};

export const heart = (fill = '#FF5C8A', s = 1, x = 50, y = 50) =>
  `<path transform="translate(${x} ${y}) scale(${s}) translate(-50 -52)" d="M50 84 C22 66 12 48 17 33 C22 18 41 15 50 30 C59 15 78 18 83 33 C88 48 78 66 50 84 Z" fill="${fill}"/>`;
export const sparkle = (x, y, r = 6, fill = '#FFD84A') =>
  `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`;

/** The Planner orb: pearly glass with a blue-violet-pink ring, like the orb in the app. */
export function orb(x = 50, y = 50, r = 36, spin = 0) {
  const g = nid('o'), c = nid('c'), f = nid('f'), m = nid('m');
  const blob = (a, col, rr) => `<circle cx="${x + Math.cos(a) * r * 0.78}" cy="${y + Math.sin(a) * r * 0.78}" r="${r * rr}" fill="${col}"/>`;
  return `<defs><radialGradient id="${g}" cx=".42" cy=".36" r=".72"><stop offset="0" stop-color="#fff"/><stop offset=".62" stop-color="#EEE8FA"/><stop offset="1" stop-color="#C9BEE3"/></radialGradient>
    <radialGradient id="${m}" cx=".5" cy=".5" r=".5"><stop offset=".45" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <clipPath id="${c}"><circle cx="${x}" cy="${y}" r="${r}"/></clipPath><filter id="${f}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${r * 0.09}"/></filter></defs>
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g})"/>
    <g clip-path="url(#${c})"><g filter="url(#${f})" transform="rotate(${spin} ${x} ${y})">
      ${blob(3.4, '#3D5BFF', 0.36)}${blob(4.3, '#6A55FF', 0.3)}${blob(5.2, '#8A4DFF', 0.34)}${blob(0.2, '#FF7AC6', 0.32)}${blob(1.0, '#FF9AD5', 0.2)}</g>
      <circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="url(#${m})"/></g>
    <circle cx="${x}" cy="${y}" r="${r - 0.8}" fill="none" stroke="#fff" stroke-width="1.6" opacity=".9"/>
    <ellipse cx="${x - r * 0.2}" cy="${y - r * 0.56}" rx="${r * 0.34}" ry="${r * 0.14}" fill="#fff" opacity=".95"/>`;
}

// ---------------- the cast ----------------
export const CAST = {
  sprout: { name: 'Sprout', body: ['#A58BFF', '#7153F0'], top: 'sprout', bg: ['#EFE9FF', '#D8CBFF'] },
  mochi: { name: 'Mochi', body: ['#FFA391', '#F0685A'], top: 'cat', inner: '#FFD3C8', eyes: 'happy', mouth: 'cat', whiskers: true, bg: ['#FFEAE4', '#FFD0C4'] },
  hop: { name: 'Hop', body: ['#95E6CD', '#3FC3A0'], top: 'bunny', inner: '#FFD6E2', mouth: 'o', bg: ['#E3FAF2', '#C2F0E1'] },
  pip: { name: 'Pip', body: ['#FFE17E', '#FFC23D'], top: 'tuft', beak: true, leg: '#FF9A2E', bg: ['#FFF7D9', '#FFE7A1'] },
  bo: { name: 'Bo', body: ['#86C6FF', '#3F8EF0'], top: 'bear', inner: '#D4E8FF', snout: true, bg: ['#E6F2FF', '#C6DFFF'] },
  lulu: { name: 'Lulu', body: ['#FFB8D4', '#FF7FB0'], top: 'gills', gill: '#FF4F93', eyes: 'big', bg: ['#FFEAF3', '#FFCFE3'] },
  ribbit: { name: 'Ribbit', body: ['#B8EE72', '#7CCB2E'], top: 'frog', mouth: 'grin', bg: ['#F1FBDF', '#DBF3B4'] },
  kit: { name: 'Kit', body: ['#FFB472', '#FF8A2B'], top: 'fox', inner: '#FFE4C8', muzzle: true, bg: ['#FFF1E1', '#FFDBB6'] },
  hoot: { name: 'Hoot', body: ['#A193F2', '#6C5BD6'], top: 'tufts', belly: true, beak: true, eyes: 'big', bg: ['#EEEBFF', '#D5CEFF'] },
  boo: { name: 'Boo', body: ['#FFFFFF', '#DCD6F2'], shape: 'ghost', mouth: 'o', bg: ['#EAE7F8', '#CCC4EC'] },
  bolt: { name: 'Bolt', body: ['#93E3F2', '#3DB8D6'], shape: 'robot', top: 'antenna', cheeks: false, bg: ['#E1F8FC', '#BBEDF6'] },
  zib: { name: 'Zib', body: ['#E595FF', '#B14DF0'], top: 'alien', eyes: 'big', mouth: 'open', bg: ['#F6E8FF', '#E6C9FF'] },
};
