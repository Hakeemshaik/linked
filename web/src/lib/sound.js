// Ringtone and ringback, synthesised (no audio files). Browsers only allow sound after the person
// has touched the page, so the first tap anywhere unlocks audio for later rings.
let ctx = null;
const audio = () => {
  if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (A) ctx = new A(); }
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};
export function unlockAudioOnTouch() {
  const unlock = () => audio();
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
}

function note(c, freq, at, len, vol) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(c.destination);
  o.start(at); o.stop(at + len + 0.05);
}

// Incoming: a bright four-note figure twice, every 2.4s. Caller: a soft double tone every 3s.
const PATTERNS = {
  incoming: { every: 2400, play: (c, t) => [0, 0.5].forEach((d) => [[784, 0], [988, 0.11], [1175, 0.22], [988, 0.33]].forEach(([f, o]) => note(c, f, t + d + o, 0.28, 0.16))) },
  ringback: { every: 3000, play: (c, t) => [[440, 0], [480, 0], [440, 0.45], [480, 0.45]].forEach(([f, o]) => note(c, f, t + o, 0.38, 0.05)) },
};

/** Start ringing; returns a stop function. Vibrates too where phones allow it (Android). */
export function ring(kind = 'incoming') {
  const p = PATTERNS[kind];
  const c = audio();
  const tick = () => {
    if (c) p.play(c, c.currentTime + 0.02);
    if (kind === 'incoming') navigator.vibrate?.([500, 250, 500]);
  };
  tick();
  const t = setInterval(tick, p.every);
  return () => { clearInterval(t); navigator.vibrate?.(0); };
}
