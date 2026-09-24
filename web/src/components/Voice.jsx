import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import { mediaUrl } from '../lib/media.js';

export const clock = (sec = 0) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const BARS = 40;

// AAC in MP4 plays on every phone, so use it wherever the browser can record it; WebM/Opus otherwise.
const TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
const pickType = () => TYPES.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';

/** Loudness samples (0 to 1) -> BARS digits 0-9, scaled to the loudest moment. */
function waveOf(levels) {
  if (!levels.length) return '2'.repeat(BARS);
  const out = [];
  for (let i = 0; i < BARS; i++) {
    const a = Math.floor((i * levels.length) / BARS);
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / BARS));
    let m = 0;
    for (let j = a; j < b && j < levels.length; j++) m = Math.max(m, levels[j]);
    out.push(m);
  }
  const peak = Math.max(0.04, ...out);
  return out.map((v) => Math.min(9, Math.round((v / peak) * 9))).join('');
}

/** Record a voice message: start() from a tap, then stop() for { blob, duration, wave } or cancel(). */
export function useRecorder({ max = 300, onLimit } = {}) {
  const [state, setState] = useState('idle'); // idle | starting | recording
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState([]);
  const r = useRef({});
  const limit = useRef(onLimit);
  limit.current = onLimit;

  const release = () => {
    const c = r.current;
    clearInterval(c.tick);
    c.stream?.getTracks().forEach((t) => t.stop());
    c.ctx?.close?.().catch(() => {});
    r.current = {};
    setState('idle'); setElapsed(0); setLevels([]);
  };
  useEffect(() => () => { try { r.current.rec?.state !== 'inactive' && r.current.rec?.stop(); } catch { /* ignore */ } release(); }, []); // eslint-disable-line

  const start = async () => {
    if (!canRecord()) throw new Error("This browser can't record voice messages");
    // The audio context has to be made during the tap (iPhone), before waiting for the microphone.
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = Ctx ? new Ctx() : null;
    ctx?.resume?.().catch(() => {});
    setState('starting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      ctx?.close?.().catch(() => {});
      setState('idle');
      throw new Error(e?.name === 'NotAllowedError' ? 'Microphone is blocked. Allow it in your phone settings.' : "Couldn't use the microphone");
    }
    const type = pickType();
    const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
    const all = [];
    let an = null;
    const buf = new Uint8Array(512);
    if (ctx) { an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an); }
    const t0 = performance.now();
    const tick = setInterval(() => {
      let lvl = 0;
      if (an) {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
        lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4.5);
      }
      all.push(lvl);
      setLevels((l) => [...l.slice(-31), lvl]);
      const sec = (performance.now() - t0) / 1000;
      setElapsed(sec);
      if (sec >= max) limit.current?.();
    }, 100);
    rec.start(250);
    r.current = { stream, rec, chunks, ctx, tick, all, t0, type: (rec.mimeType || type || 'audio/webm').split(';')[0] };
    setState('recording');
  };

  const finish = (keep) => new Promise((resolve) => {
    const c = r.current;
    if (!c.rec) return resolve(null);
    clearInterval(c.tick);
    const duration = (performance.now() - c.t0) / 1000;
    const done = () => {
      const out = keep && c.chunks.length ? { blob: new Blob(c.chunks, { type: c.type }), duration, wave: waveOf(c.all) } : null;
      release();
      resolve(out);
    };
    if (c.rec.state === 'inactive') done();
    else { c.rec.onstop = done; c.rec.stop(); }
  });

  return { state, elapsed, levels, start, stop: () => finish(true), cancel: () => finish(false) };
}

let playing = null; // one voice message plays at a time

/* A voice message: play/pause, tap the waveform to jump, 1x / 1.5x / 2x. */
export function VoiceNote({ m, clone = false }) {
  const d = m.data || {};
  const dur = d.duration || 0;
  const bars = (d.wave || '').padEnd(BARS, '2').slice(0, BARS).split('').map(Number);
  const [state, setState] = useState('idle'); // idle | playing | paused
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState(1);
  const audio = useRef(null);
  useEffect(() => () => { audio.current?.pause(); }, []);

  // Made during the tap so the phone lets it play; streams from the server (byte ranges).
  const ensure = () => {
    if (audio.current) return audio.current;
    const a = new Audio(m.local || mediaUrl(d.url));
    a.preload = 'auto';
    a.ontimeupdate = () => setPos(a.currentTime);
    a.onplay = () => setState('playing');
    a.onpause = () => setState(a.ended ? 'idle' : 'paused');
    a.onended = () => { setState('idle'); setPos(0); if (playing === a) playing = null; };
    audio.current = a;
    return a;
  };
  const play = (a) => {
    if (playing && playing !== a) playing.pause();
    playing = a;
    a.playbackRate = rate;
    a.play().catch(() => setState('idle'));
  };
  const toggle = (e) => {
    e.stopPropagation();
    if (clone) return;
    const a = ensure();
    if (!a.paused) a.pause(); else play(a);
  };
  const seek = (e) => {
    e.stopPropagation();
    if (clone || !dur) return;
    const box = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const a = ensure();
    a.currentTime = f * dur;
    setPos(f * dur);
    if (a.paused) play(a);
  };
  const faster = (e) => {
    e.stopPropagation();
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  };
  const done = dur ? Math.min(1, pos / dur) : 0;

  return (
    <div className={`voice ${state}`}>
      <button type="button" className={`voice-play ${m.pending ? 'sending' : ''}`} onClick={toggle} aria-label={state === 'playing' ? 'Pause voice message' : 'Play voice message'}>
        <Icon name={state === 'playing' ? 'pause' : 'play'} size={20} />
      </button>
      <span className="voice-body">
        <span className="voice-wave" onClick={seek} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)}>
          {bars.map((b, i) => <i key={i} className={i / BARS < done ? 'on' : ''} style={{ height: `${18 + b * 9}%` }} />)}
        </span>
        <span className="voice-foot">
          <span className="mono">{state === 'idle' ? clock(dur) : clock(pos)}</span>
          {state !== 'idle' && <button type="button" className="voice-rate" onClick={faster} aria-label="Playback speed">{rate}x</button>}
        </span>
      </span>
    </div>
  );
}

/* The composer while recording: live level bars, timer, bin. */
export function RecordingBar({ rec, onCancel }) {
  return (
    <div className="rec-bar" role="status" aria-label="Recording voice message">
      <button type="button" className="icon-plain rec-bin" onClick={onCancel} aria-label="Delete recording"><Icon name="trash" size={22} /></button>
      <span className="rec-dot" />
      <span className="rec-time mono">{clock(rec.elapsed)}</span>
      <span className="rec-levels" aria-hidden="true">
        {Array.from({ length: 32 }, (_, i) => rec.levels[rec.levels.length - 32 + i] ?? 0).map((v, i) => <i key={i} style={{ height: `${12 + v * 88}%` }} />)}
      </span>
    </div>
  );
}
