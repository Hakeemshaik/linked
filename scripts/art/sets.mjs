// The four sets: profile pictures, emojis, stickers and GIFs. Each item is a function returning SVG markup.
import { CAST, character, arm, legs, heart, sparkle, orb, grad, eyes, mouth, INK } from './kit.mjs';

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
const FONT = `font-family="'SF Pro Rounded','Arial Rounded MT Bold','Nunito','Segoe UI',system-ui,sans-serif" font-weight="900"`;

// ---------------- profile pictures ----------------
export const AVATARS = Object.entries(CAST).map(([id, c]) => ({
  id, name: c.name,
  svg: () => svg(100, 100, `<defs>${grad('bg', ...c.bg)}</defs><circle cx="50" cy="50" r="50" fill="url(#bg)"/><g transform="translate(50 57) scale(.8) translate(-50 -52)">${character(c)}</g>`),
}));

// ---------------- emojis (used inline as :id:) ----------------
const face = (fill, inner) => `<defs>${grad('f', ...fill)}</defs><circle cx="50" cy="52" r="38" fill="url(#f)"/><ellipse cx="36" cy="32" rx="11" ry="6" fill="#fff" opacity=".35" transform="rotate(-28 36 32)"/>${inner}`;
const YELLOW = ['#FFE06B', '#FFB22E'];
export const EMOJI = [
  { id: 'love', name: 'love', svg: () => svg(100, 100, `<defs>${grad('h', '#B89BFF', '#FF5C9A')}</defs>${heart('url(#h)', 1.05, 50, 54)}<ellipse cx="34" cy="38" rx="8" ry="4.5" fill="#fff" opacity=".45" transform="rotate(-35 34 38)"/>${sparkle(80, 22, 9)}${sparkle(20, 76, 5, '#fff')}`) },
  { id: 'lol', name: 'lol', svg: () => svg(100, 100, face(YELLOW, `${eyes('happy', { y: 46, dx: 14 })}${mouth('grin', { y: 60 })}<path d="M16 50 Q9 62 16 68 Q22 62 16 50 Z M84 50 Q91 62 84 68 Q78 62 84 50 Z" fill="#5CC8FF"/>`)) },
  { id: 'hype', name: 'hype', svg: () => svg(100, 100, `<defs>${grad('fl', '#FFD24A', '#FF4D2E')}</defs><path d="M50 8 C58 26 80 34 78 62 C77 80 64 92 50 92 C36 92 22 81 22 63 C22 48 32 42 34 30 C42 38 44 44 46 48 C48 36 44 22 50 8 Z" fill="url(#fl)"/><path d="M50 50 C56 60 66 64 64 76 C63 85 57 90 50 90 C43 90 37 85 36 77 C35 68 44 64 50 50 Z" fill="#FFE27A"/>${eyes('happy', { y: 66, dx: 9 })}${mouth('open', { y: 74 })}`) },
  { id: 'omw', name: 'omw', svg: () => svg(100, 100, `<path d="M4 40 H22 M8 52 H24 M4 64 H20" stroke="#8FB7FF" stroke-width="5" stroke-linecap="round"/><g transform="rotate(12 56 56) translate(8 2)">${character(CAST.bo, { eyes: 'dot', mouth: 'open' })}</g>`) },
  { id: 'braai', name: 'braai', svg: () => svg(100, 100, `<defs>${grad('fire', '#FFD24A', '#FF5A2E')}</defs>
    <path d="M30 40 C30 28 38 26 36 16 C44 22 42 30 46 32 C46 24 52 20 50 10 C60 18 58 28 62 32 C64 26 70 26 70 20 C76 30 72 38 72 42 Z" fill="url(#fire)"/>
    <rect x="30" y="34" width="40" height="9" rx="4.5" fill="#C9674A"/><rect x="34" y="36" width="32" height="2.5" rx="1.2" fill="#E88A6A"/>
    <path d="M16 46 H84 Q84 74 50 74 Q16 74 16 46 Z" fill="#2B2B35"/><path d="M16 46 H84" stroke="#555566" stroke-width="4" stroke-linecap="round"/>
    <path d="M30 72 L22 92 M70 72 L78 92 M50 74 V92" stroke="#2B2B35" stroke-width="5" stroke-linecap="round"/><ellipse cx="34" cy="54" rx="10" ry="4" fill="#fff" opacity=".18"/>`) },
  { id: 'cheers', name: 'cheers', svg: () => svg(100, 100, `<defs>${grad('dr', '#FFD86B', '#FF9F1C')}</defs>
    <g transform="rotate(-16 34 60)"><path d="M18 30 H50 L46 78 Q46 86 34 86 Q22 86 22 78 Z" fill="#fff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M20.5 44 H47.8 L45.6 77 Q45 83 34 83 Q23 83 22.5 77 Z" fill="url(#dr)"/><ellipse cx="34" cy="44" rx="13.6" ry="3" fill="#FFF6D6"/></g>
    <g transform="rotate(16 66 60)"><path d="M50 30 H82 L78 78 Q78 86 66 86 Q54 86 54 78 Z" fill="#fff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M52.5 44 H79.8 L77.6 77 Q77 83 66 83 Q55 83 54.5 77 Z" fill="url(#dr)"/><ellipse cx="66" cy="44" rx="13.6" ry="3" fill="#FFF6D6"/></g>
    ${sparkle(50, 16, 9)}${sparkle(24, 16, 4.5, '#FFB22E')}${sparkle(78, 14, 4.5, '#FFB22E')}`) },
  { id: 'free', name: 'free', svg: () => svg(100, 100, `<rect x="14" y="20" width="72" height="68" rx="14" fill="#fff" stroke="${INK}" stroke-width="3.5"/><path d="M14 36 Q14 20 30 20 H70 Q86 20 86 36 V40 H14 Z" fill="#FF5C7A" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M34 12 V28 M66 12 V28" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M32 62 L45 74 L70 50" stroke="#22C065" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: 'meh', name: 'meh', svg: () => svg(100, 100, face(YELLOW, `${eyes('side', { y: 48, dx: 14 })}${mouth('wavy', { y: 66 })}`)) },
  { id: 'sleepy', name: 'sleepy', svg: () => svg(100, 100, `<defs>${grad('m', '#FFE88A', '#FFC53D')}</defs><path d="M58 12 A40 40 0 1 0 88 66 A32 32 0 1 1 58 12 Z" fill="url(#m)"/>${eyes('closed', { y: 58, dx: 9, cx: 40 })}${mouth('smile', { y: 70, cx: 42 })}
    <path d="M66 18 H78 L66 30 H78 M80 36 H88 L80 44 H88" stroke="#8F78FF" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: 'party', name: 'party', svg: () => svg(100, 100, `<defs>${grad('cone', '#8F78FF', '#5A3DF0')}</defs><path d="M14 90 L36 30 L72 66 Z" fill="url(#cone)"/><path d="M22 68 L50 44 M18 80 L60 55" stroke="#FFD84A" stroke-width="5" stroke-linecap="round"/>
    <path d="M44 26 Q52 8 64 18 T84 10" stroke="#FF5C9A" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M58 40 Q72 30 78 44 T92 40" stroke="#3FC3A0" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="82" cy="24" r="4" fill="#FFB22E"/><circle cx="70" cy="8" r="3" fill="#3B8EF0"/><rect x="86" y="52" width="7" height="7" rx="1.5" fill="#FF5C9A" transform="rotate(20 89 55)"/><circle cx="50" cy="12" r="3.5" fill="#22C065"/>${sparkle(90, 72, 5)}`) },
];

// ---------------- stickers: a pose plus a caption, die-cut with a white edge ----------------
const DIECUT = `<filter id="cut" x="-15%" y="-15%" width="130%" height="130%">
  <feMorphology in="SourceAlpha" operator="dilate" radius="6" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="edge"/>
  <feGaussianBlur in="d" stdDeviation="3.5" result="b"/><feOffset in="b" dy="4" result="bo"/><feFlood flood-color="#1B1340" flood-opacity=".22"/><feComposite in2="bo" operator="in" result="shadow"/>
  <feMerge><feMergeNode in="shadow"/><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
const caption = (text, color, y = 186, size = 30, tilt = -4) =>
  `<text x="120" y="${y}" text-anchor="middle" ${FONT} font-size="${size}" fill="${color}" stroke="${INK}" stroke-width="2.4" paint-order="stroke" letter-spacing=".5" transform="rotate(${tilt} 120 ${y})">${text}</text>`;
const sticker = (inner, text, color, opts = {}) => svg(240, 240, `<defs>${DIECUT}</defs><g filter="url(#cut)"><g transform="translate(${opts.x ?? 36} ${opts.y ?? 8}) scale(${opts.s ?? 1.68})">${inner}</g>${caption(text, color, opts.cy, opts.size, opts.tilt)}</g>`);

export const STICKERS = [
  { id: 'letsgo', label: "Let's go!", svg: () => sticker(character(CAST.kit, { eyes: 'happy', mouth: 'open', behind: arm(CAST.kit, 22, 58, 145) + arm(CAST.kit, 78, 58, 215) }), "LET'S GO!", '#FF8A2B') },
  { id: 'omw', label: 'On my way', svg: () => sticker(`<path d="M-4 46 H12 M-8 58 H10 M-4 70 H12" stroke="#FFC23D" stroke-width="5" stroke-linecap="round"/>` + character(CAST.pip, { behind: legs(CAST.pip, 0.2) + arm(CAST.pip, 20, 62, 60) + arm(CAST.pip, 80, 62, -60) }), 'ON MY WAY', '#FFB22E') },
  { id: 'braai', label: 'Braai?', svg: () => sticker(character(CAST.bo, { mouth: 'open', front: `<g transform="translate(58 58) scale(.42)"><path d="M16 46 H84 Q84 74 50 74 Q16 74 16 46 Z" fill="#2B2B35"/><path d="M30 72 L22 92 M70 72 L78 92" stroke="#2B2B35" stroke-width="6" stroke-linecap="round"/><path d="M28 44 C28 30 38 30 36 18 C46 26 44 34 50 36 C50 26 56 22 56 12 C66 22 64 30 70 34 C72 28 76 28 78 22 C82 34 78 40 76 44 Z" fill="#FF7A2E"/></g>` }), 'BRAAI?', '#FF6B3D') },
  { id: 'missyou', label: 'Miss you', svg: () => sticker(character(CAST.hop, { eyes: 'closed', mouth: 'smile', front: heart('#FF5C8A', 0.5, 50, 76) + arm(CAST.hop, 24, 64, -55, 20) + arm(CAST.hop, 76, 64, 55, 20) }), 'MISS YOU', '#FF5C8A') },
  { id: 'yes', label: 'Yes!!', svg: () => sticker(sparkle(8, 20, 8) + sparkle(94, 28, 6, '#FF5C9A') + character(CAST.ribbit, { behind: arm(CAST.ribbit, 20, 58, 150) + arm(CAST.ribbit, 80, 58, 210) }), 'YES!!', '#7CCB2E', { size: 36 }) },
  { id: 'nah', label: 'Nah', svg: () => sticker(character(CAST.mochi, { eyes: 'side', mouth: 'flat', front: `<rect x="24" y="77" width="52" height="11" rx="5.5" fill="#D9493D" transform="rotate(7 50 82)"/><rect x="24" y="77" width="52" height="11" rx="5.5" fill="#E85A4D" transform="rotate(-7 50 82)"/>` }), 'NAH', '#F0685A', { size: 38 }) },
  { id: 'approved', label: 'Planner approved', svg: () => sticker(orb(50, 50, 40) + `<circle cx="82" cy="80" r="16" fill="#22C065"/><path d="M74 80 L80 86 L90 74" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`, 'PLANNER OK', '#6B4EFF', { size: 30 }) },
  { id: 'weekend', label: 'Weekend mode', svg: () => sticker(character(CAST.sprout, { eyes: 'shades', mouth: 'smile', behind: arm(CAST.sprout, 22, 62, 40) + arm(CAST.sprout, 78, 60, 200) }), 'WEEKEND MODE', '#7153F0', { size: 25 }) },
  { id: 'callme', label: 'Call me', svg: () => sticker(character(CAST.lulu, { eyes: 'wink', mouth: 'open', front: `<g transform="rotate(-18 80 54)"><rect x="72" y="36" width="18" height="32" rx="5" fill="${INK}"/><rect x="74.5" y="40" width="13" height="22" rx="2" fill="#8FE0FF"/></g>` + arm(CAST.lulu, 74, 66, 205, 18) }), 'CALL ME', '#FF5C9A') },
  { id: 'thanks', label: 'Thank you', svg: () => sticker(character(CAST.boo, { eyes: 'happy', mouth: 'smile', front: heart('#FF5C8A', 0.42, 50, 74) }) + sparkle(12, 26, 7) + sparkle(92, 18, 5, '#FF9ACB'), 'THANK YOU', '#8F78FF', { size: 27 }) },
];

// ---------------- GIFs: frame(t) with t going 0 -> 1 over one loop ----------------
const S = 160;
const TAU = Math.PI * 2;
// Flat backgrounds: GIFs only have 256 colours, and soft gradients turn into stripes.
const gifFrame = (bg, inner) => svg(S, S, `<rect width="${S}" height="${S}" fill="${bg[1]}"/>${inner}`);
const place = (inner, x = 30, y = 26, s = 1, rot = 0, sx = 1, sy = 1) =>
  `<g transform="translate(${x + 50 * s} ${y + 90 * s}) rotate(${rot}) scale(${s * sx} ${s * sy}) translate(-50 -90)">${inner}</g>`;
const word = (text, color, y = 146, size = 26, scale = 1) =>
  `<text x="80" y="${y}" text-anchor="middle" ${FONT} font-size="${size}" fill="${color}" stroke="${INK}" stroke-width="2.2" paint-order="stroke" transform="translate(80 ${y - 9}) scale(${scale}) translate(-80 ${-(y - 9)})">${text}</text>`;
const rand = (i) => { const x = Math.sin(i * 999.13) * 43758.5453; return x - Math.floor(x); };

export const GIFS = [
  { id: 'wave', label: 'Hi!', frames: 24, delay: 60, frame: (t) => {
    const a = 205 + 32 * Math.sin(t * TAU * 2);
    return gifFrame(CAST.bo.bg, place(character(CAST.bo, { eyes: t > 0.42 && t < 0.5 ? 'closed' : 'dot', mouth: 'open', behind: arm(CAST.bo, 22, 64, 30) + arm(CAST.bo, 80, 58, a, 26) }), 30, 12, 1)
      + word('HI!', '#3F8EF0', 150, 28));
  } },
  { id: 'dance', label: 'Dance', frames: 24, delay: 55, frame: (t) => {
    const sq = Math.sin(t * TAU * 2);
    const note = (i) => { const p = (t + i / 3) % 1; return `<g transform="translate(${20 + i * 55 + 8 * Math.sin((p + i) * TAU)} ${130 - p * 110})" opacity="${1 - p}"><ellipse cx="0" cy="12" rx="6" ry="4.5" fill="#7153F0" transform="rotate(-20 0 12)"/><path d="M5 11 V-6 Q12 -2 14 4" stroke="#7153F0" stroke-width="3" fill="none" stroke-linecap="round"/></g>`; };
    return gifFrame(CAST.sprout.bg, [0, 1, 2].map(note).join('') + place(character(CAST.sprout, { eyes: 'happy', mouth: 'open', behind: arm(CAST.sprout, 22, 62, 150 + 30 * sq) + arm(CAST.sprout, 78, 62, 210 + 30 * sq) }), 30, 34, 1, 9 * Math.sin(t * TAU), 1 - 0.06 * sq, 1 + 0.08 * sq));
  } },
  { id: 'love', label: 'Love you', frames: 20, delay: 60, frame: (t) => {
    const beat = 1 + 0.14 * Math.max(0, Math.sin(t * TAU * 2)) ** 2;
    const sp = [0, 1, 2, 3, 4].map((i) => { const a = t * TAU + i * TAU / 5; return sparkle(80 + 58 * Math.cos(a), 76 + 50 * Math.sin(a), 5 + 2 * Math.sin(t * TAU * 3 + i), i % 2 ? '#FFD84A' : '#fff'); }).join('');
    return gifFrame(['#FFE6F0', '#FFC9DD'], `<defs>${grad('lh', '#B89BFF', '#FF4F8B')}</defs>${sp}${heart('url(#lh)', 1.25 * beat, 80, 80)}<ellipse cx="62" cy="60" rx="10" ry="5" fill="#fff" opacity=".45" transform="rotate(-35 62 60)"/>`);
  } },
  { id: 'yay', label: 'Yay!', frames: 24, delay: 55, frame: (t) => {
    const jump = Math.abs(Math.sin(t * TAU)) * 20;
    const conf = Array.from({ length: 18 }, (_, i) => { const y = ((rand(i) + t) % 1) * 180 - 20; const x = rand(i + 50) * 160; const c = ['#FF5C9A', '#3B8EF0', '#FFB22E', '#22C065', '#8F78FF'][i % 5]; return `<rect x="${x}" y="${y}" width="7" height="11" rx="2" fill="${c}" transform="rotate(${(t * 720 + i * 40) % 360} ${x + 3} ${y + 5})"/>`; }).join('');
    return gifFrame(CAST.pip.bg, conf + place(character(CAST.pip, { eyes: 'happy', behind: arm(CAST.pip, 20, 60, 150) + arm(CAST.pip, 80, 60, 210) + legs(CAST.pip, 0) }), 32, 10 - jump, 0.96) + word('YAY!', '#FF9A2E', 150, 30, 1 + 0.08 * Math.sin(t * TAU * 2)));
  } },
  { id: 'lol', label: 'LOL', frames: 20, delay: 50, frame: (t) => {
    const shake = 7 * Math.sin(t * TAU * 4);
    const tear = (s) => `<path d="M${80 + s * 36} 70 Q${80 + s * 44} ${84 + 6 * Math.sin(t * TAU * 2)} ${80 + s * 38} 92 Q${80 + s * 30} 84 ${80 + s * 36} 70 Z" fill="#5CC8FF"/>`;
    return gifFrame(CAST.mochi.bg, place(character(CAST.mochi, { eyes: 'happy', mouth: 'grin' }), 32, 12, 0.96, shake) + tear(-1) + tear(1) + word('LOL', '#F0685A', 150, 32, 1 + 0.1 * Math.abs(Math.sin(t * TAU * 2))));
  } },
  { id: 'omw', label: 'On my way', frames: 16, delay: 60, frame: (t) => {
    const lines = [0, 1, 2].map((i) => { const x = 160 - ((t * 160 + i * 60) % 180); return `<path d="M${x} ${60 + i * 22} h26" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9"/>`; }).join('');
    const bob = Math.abs(Math.sin(t * TAU * 2)) * 5;
    return gifFrame(['#E3F1FF', '#B9D9FF'], lines + place(character(CAST.pip, { behind: legs(CAST.pip, t * 2) + arm(CAST.pip, 20, 62, 50 * Math.sin(t * TAU * 2)) + arm(CAST.pip, 80, 62, -50 * Math.sin(t * TAU * 2)) }), 32, 6 - bob, 0.94, 8) + word('OMW', '#3F8EF0', 152, 28));
  } },
  { id: 'hype', label: 'Hype', frames: 16, delay: 55, frame: (t) => {
    const f = (k) => 4 * Math.sin(t * TAU * 2 + k);
    const flame = `<path d="M80 ${14 + f(0)} C${92 + f(1)} 42 ${122 + f(2)} 50 ${118 + f(3)} 92 C116 120 98 138 80 138 C60 138 40 122 40 96 C40 74 ${54 + f(1)} 66 ${56 + f(2)} 50 C68 62 70 70 73 76 C${76 + f(3)} 58 ${70 + f(0)} 36 80 ${14 + f(0)} Z" fill="url(#hf)"/><path d="M80 78 C88 92 102 98 99 114 C98 127 90 134 80 134 C70 134 61 127 60 116 C59 102 72 96 80 78 Z" fill="#FFE27A"/>`;
    const sparks = [0, 1, 2, 3].map((i) => { const p = (t + i / 4) % 1; return `<circle cx="${40 + i * 27 + 6 * Math.sin((p + i) * TAU)}" cy="${120 - p * 110}" r="${3 - p * 2}" fill="#FFB22E" opacity="${1 - p}"/>`; }).join('');
    return gifFrame(['#FFF0DC', '#FFD2A6'], `<defs>${grad('hf', '#FFD24A', '#FF4D2E')}</defs>${sparks}${flame}${eyes('happy', { y: 104, dx: 13, cx: 80 })}${mouth('open', { y: 115, cx: 80 })}`);
  } },
  { id: 'planning', label: 'Planning…', frames: 24, delay: 50, frame: (t) => {
    const dots = [0, 1, 2].map((i) => `<circle cx="${62 + i * 18}" cy="146" r="4.5" fill="#6B4EFF" opacity="${0.3 + 0.7 * Math.max(0, Math.sin((t - i / 6) * TAU))}"/>`).join('');
    return gifFrame(['#F1EDFF', '#DCD2FF'], orb(80, 70, 48 * (1 + 0.03 * Math.sin(t * TAU * 2)), t * 360) + dots);
  } },
  { id: 'yes', label: 'Yes!', frames: 20, delay: 55, frame: (t) => {
    const nod = 6 * Math.sin(t * TAU * 2);
    const pop = 1 + 0.18 * Math.max(0, Math.sin(t * TAU));
    return gifFrame(CAST.ribbit.bg, sparkle(24, 30, 7 * pop) + sparkle(138, 40, 5 * pop, '#FF5C9A') + place(character(CAST.ribbit, { eyeDy: nod * 0.3, behind: arm(CAST.ribbit, 20, 58, 150 + nod * 3) + arm(CAST.ribbit, 80, 58, 210 - nod * 3) }), 32, 10 + nod * 0.6, 0.96) + word('YES!', '#6BB82A', 152, 32, pop));
  } },
  { id: 'zzz', label: 'Sleepy', frames: 24, delay: 70, frame: (t) => {
    const bob = 4 * Math.sin(t * TAU);
    const z = (i) => { const p = (t + i / 3) % 1; const s = 0.6 + p * 0.8; return `<g transform="translate(${104 + p * 26 + 4 * Math.sin(p * TAU)} ${60 - p * 48}) scale(${s})" opacity="${1 - p}"><path d="M0 0 H12 L0 14 H12" stroke="#8F78FF" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`; };
    return gifFrame(['#E8E4FA', '#C9C0EE'], place(character(CAST.boo, { eyes: 'closed', mouth: 'o' }), 22, 22 + bob, 0.92, -6) + [0, 1, 2].map(z).join(''));
  } },
];

// ---------------- scenes: animated illustrations for empty screens and the welcome screen ----------------
// Plain SVG with CSS animation inside, so they move even as an <img>. Moving parts are wrapper <g>s with no
// transform attribute of their own (a CSS transform would replace it); transform-origin is in the local units.
const MOTION = `.bob{animation:bob 2.6s ease-in-out infinite}.bob2{animation:bob 2.6s ease-in-out -1.3s infinite}
.waveR{animation:waveR 1.4s ease-in-out infinite}.waveL{animation:waveL 1.4s ease-in-out -.7s infinite}
.float{animation:float 3.2s ease-out infinite;opacity:0}.twinkle{animation:twinkle 1.8s ease-in-out infinite}
.dot{animation:dot 1.2s ease-in-out infinite}.ring{animation:ring 1.6s ease-out infinite;opacity:0}
.hop{animation:hop 1.6s cubic-bezier(.3,.7,.4,1) infinite}.pulse{animation:pulse 1.6s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-4px)}}
@keyframes waveR{0%,100%{transform:rotate(0)}50%{transform:rotate(26deg)}}
@keyframes waveL{0%,100%{transform:rotate(0)}50%{transform:rotate(-26deg)}}
@keyframes float{0%{opacity:0;transform:translate(0,0) scale(.6)}20%{opacity:1}100%{opacity:0;transform:translate(8px,-34px) scale(1.1)}}
@keyframes twinkle{0%,100%{opacity:.25;transform:scale(.7)}50%{opacity:1;transform:scale(1.1)}}
@keyframes dot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-5px);opacity:1}}
@keyframes ring{0%{opacity:.9;transform:scale(.6)}100%{opacity:0;transform:scale(1.5)}}
@keyframes hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-10px)}60%{transform:translateY(0)}}
@keyframes pulse{50%{transform:scale(1.12)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;opacity:1!important}}`;
const scene = (w, h, body) => svg(w, h, `<style>${MOTION}</style>${body}`);
const at = (x, y, s, inner, cls = '') => `<g transform="translate(${x} ${y}) scale(${s})"><g class="${cls}">${inner}</g></g>`;
// Animated bits placed with a translate, then animated around their own origin.
const bit = (x, y, cls, inner, delay = 0, origin = '0px 0px') =>
  `<g transform="translate(${x} ${y})"><g class="${cls}" style="animation-delay:${delay}s;transform-origin:${origin}">${inner}</g></g>`;
const star = (r, fill) => sparkle(0, 0, r, fill);
// A raised arm waving outwards: the right one (x 82) or the left one (x 18), pivoting at the shoulder.
const waveArm = (c, side = 'R') => side === 'R'
  ? `<g class="waveR" style="transform-origin:82px 60px">${arm(c, 82, 60, 222, 25)}</g>`
  : `<g class="waveL" style="transform-origin:18px 60px">${arm(c, 18, 60, 138, 25)}</g>`;
const ground = (w, y, fill = '#000') => `<ellipse cx="${w / 2}" cy="${y}" rx="${w * 0.36}" ry="7" fill="${fill}" opacity=".07"/>`;

export const SCENES = [
  { id: 'chats', svg: () => scene(240, 150, ground(240, 140)
    + at(26, 44, 0.95, character(CAST.bo, { mouth: 'open', behind: arm(CAST.bo, 22, 62, 35) + waveArm(CAST.bo) }), 'bob')
    + at(118, 50, 0.9, character(CAST.mochi, { eyes: 'happy', mouth: 'cat', behind: arm(CAST.mochi, 22, 62, 40) + arm(CAST.mochi, 78, 62, -40) }), 'bob2')
    + `<g transform="translate(84 6)"><path d="M0 14 Q0 0 14 0 H58 Q72 0 72 14 V22 Q72 36 58 36 H26 L14 46 L16 36 H14 Q0 36 0 22 Z" fill="#fff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`
    + [0, 1, 2].map((i) => `<g transform="translate(${22 + i * 14} 18)"><circle class="dot" style="animation-delay:${i * 0.15}s" r="4.2" fill="#8F78FF"/></g>`).join('') + '</g>'
    + bit(206, 70, 'float', heart('#FF5C8A', 0.2, 0, 0), 0.4) + bit(196, 86, 'float', heart('#FF9ACB', 0.14, 0, 0), 1.8)) },
  { id: 'calls', svg: () => scene(240, 150, ground(240, 140)
    + [0, 0.55, 1.1].map((d) => `<g transform="translate(162 52)"><circle class="ring" style="animation-delay:${d}s;transform-origin:0 0" r="24" fill="none" stroke="#3FC3A0" stroke-width="3"/></g>`).join('')
    + at(66, 38, 1, character(CAST.lulu, { eyes: 'happy', mouth: 'open', front: `<g transform="rotate(-18 80 54)"><rect x="72" y="36" width="18" height="32" rx="5" fill="${INK}"/><rect x="74.5" y="40" width="13" height="22" rx="2" fill="#8FE0FF"/></g>` + arm(CAST.lulu, 74, 66, 205, 18) }), 'bob')
    + bit(40, 40, 'twinkle', star(6, '#FFD84A'), 0.3, '0px 0px') + bit(206, 104, 'twinkle', star(5, '#FF9ACB'), 1, '0px 0px')) },
  { id: 'plans', svg: () => scene(240, 150, ground(240, 140)
    + `<g transform="translate(128 34) rotate(8)"><rect x="0" y="8" width="78" height="72" rx="13" fill="#fff" stroke="${INK}" stroke-width="3"/><path d="M0 24 Q0 8 16 8 H62 Q78 8 78 24 V30 H0 Z" fill="#FF5C7A" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M20 0 V16 M58 0 V16" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`
    + `<g transform="translate(39 55)"><g class="pulse"><path d="M-15 0 L-4 11 L17 -11" stroke="#22C065" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g></g>`
    + at(20, 40, 0.98, character(CAST.pip, { eyes: 'happy', behind: arm(CAST.pip, 20, 60, 150) + arm(CAST.pip, 80, 60, 210) + legs(CAST.pip, 0) }), 'hop')
    + bit(118, 26, 'twinkle', star(7, '#FFD84A'), 0) + bit(222, 118, 'twinkle', star(5, '#8F78FF'), 0.9) + bit(26, 28, 'twinkle', star(4.5, '#FF9ACB'), 0.5)) },
  { id: 'alerts', svg: () => scene(240, 150, ground(240, 140)
    + `<g transform="translate(120 72)"><ellipse rx="70" ry="10" cy="58" fill="#8F78FF" opacity=".12"/></g>`
    + at(62, 36, 1.05, character(CAST.boo, { eyes: 'closed', mouth: 'o' }), 'bob')
    + [0, 1.05, 2.1].map((d, i) => bit(158 + i * 6, 52 - i * 4, 'float', `<path d="M0 0 H12 L0 14 H12" transform="scale(${1 - i * 0.18})" stroke="#8F78FF" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`, d)).join('')) },
  { id: 'friends', svg: () => scene(240, 150, ground(240, 140)
    + at(24, 42, 0.95, character(CAST.hop, { mouth: 'open', behind: arm(CAST.hop, 22, 62, 35) + waveArm(CAST.hop) }), 'bob')
    + at(120, 42, 0.95, character(CAST.kit, { eyes: 'happy', mouth: 'open', behind: waveArm(CAST.kit, 'L') + arm(CAST.kit, 78, 62, -35) }), 'bob2')
    + bit(118, 30, 'float', heart('#FF5C8A', 0.2, 0, 0), 0.2) + bit(128, 36, 'float', heart('#B89BFF', 0.14, 0, 0), 1.7)
    + bit(22, 32, 'twinkle', star(5, '#FFD84A'), 0.6) + bit(220, 40, 'twinkle', star(6, '#FFD84A'), 1.2)) },
  { id: 'hello', svg: () => scene(376, 100, [['kit', { eyes: 'happy', mouth: 'open' }], ['bo', { mouth: 'open', behind: arm(CAST.bo, 22, 62, 35) + waveArm(CAST.bo) }], ['lulu', { eyes: 'wink', mouth: 'open' }], ['pip', {}], ['zib', { mouth: 'open' }], ['honey', { eyes: 'happy' }]]
    .map(([id, o], i) => `<g transform="translate(${6 + i * 62} 24) scale(.58)"><g class="hop" style="animation-delay:${i * 0.16}s">${character(CAST[id], o)}</g></g>`).join('')) },
];
