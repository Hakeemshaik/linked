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

export function bootLook() {
  try { applyLook(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* first visit */ }
}

export const ACCENTS = [
  ['violet', 'Violet', '#6B4EFF'], ['blue', 'Blue', '#2F7BF5'], ['green', 'Green', '#14A36B'], ['pink', 'Pink', '#E0457B'], ['orange', 'Orange', '#EE7A1E'],
];
export const WALLPAPERS = [['dots', 'Dots'], ['plain', 'Plain'], ['waves', 'Lines'], ['hearts', 'Hearts'], ['stars', 'Stars']];
