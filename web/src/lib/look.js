// How the app looks on this phone: light/dark, accent colour, text size, chat wallpaper.
// Saved with your account, and kept here too so the right look shows before anything loads.
const KEY = 'linkup_look';
const BG = { light: '#F2F2F7', dark: '#000000' };

export function applyLook(p = {}) {
  const r = document.documentElement;
  const set = (k, v, dflt) => { if (v && v !== dflt) r.dataset[k] = v; else delete r.dataset[k]; };
  set('theme', p.theme, 'system');
  set('accent', p.accent, 'violet');
  set('text', p.text_size, 'm');
  set('wallpaper', p.wallpaper, 'dots');
  // The status bar follows the chosen theme.
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = (m.getAttribute('media') || '').includes('dark') ? 'dark' : 'light';
    m.setAttribute('content', BG[p.theme === 'light' || p.theme === 'dark' ? p.theme : scheme]);
  }
  try { localStorage.setItem(KEY, JSON.stringify({ theme: p.theme, accent: p.accent, text_size: p.text_size, wallpaper: p.wallpaper })); } catch { /* private mode */ }
}

/**
 * Change the look smoothly: the new theme spreads out in a circle from where you tapped (or fades in),
 * as one GPU-drawn picture, so nothing stutters. Browsers without view transitions switch instantly.
 */
export function changeLook(update, at) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce) { update(); return; }
  const root = document.documentElement;
  root.classList.add(at ? 'vt-reveal' : 'vt-fade');
  const t = document.startViewTransition(update);
  if (at) {
    t.ready.then(() => {
      const r = Math.hypot(Math.max(at.x, innerWidth - at.x), Math.max(at.y, innerHeight - at.y));
      root.animate({ clipPath: [`circle(0px at ${at.x}px ${at.y}px)`, `circle(${r}px at ${at.x}px ${at.y}px)`] },
        { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => {});
  }
  t.finished.finally(() => root.classList.remove('vt-reveal', 'vt-fade'));
}

export function bootLook() {
  try { applyLook(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* first visit */ }
}

export const ACCENTS = [
  ['violet', 'Violet', '#6B4EFF'], ['blue', 'Blue', '#2F7BF5'], ['green', 'Green', '#14A36B'], ['pink', 'Pink', '#E0457B'], ['orange', 'Orange', '#EE7A1E'],
];
export const WALLPAPERS = [['dots', 'Dots'], ['plain', 'Plain'], ['waves', 'Lines'], ['hearts', 'Hearts'], ['stars', 'Stars']];
