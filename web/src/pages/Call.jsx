import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { get, post } from '../lib/api.js';
import { Avatar, Icon } from '../components/ui.jsx';
import { ring } from '../lib/sound.js';

function Video({ stream, muted, mirror, hidden, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream || null;
    v.play?.().catch(() => {}); // iOS sometimes needs a nudge after the stream changes
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={`${mirror ? 'mirror' : ''} ${hidden ? 'hidden' : ''} ${className}`} />;
}

// Connected as soon as either the connection or ICE says so (browsers don't all report both).
const stateOf = (pc) => {
  const c = pc.connectionState, i = pc.iceConnectionState;
  if (c === 'connected' || i === 'connected' || i === 'completed') return 'connected';
  if (c === 'failed' || i === 'failed') return 'failed';
  if (i === 'disconnected' || c === 'disconnected') return 'reconnecting';
  return 'connecting';
};

const PIP = { w: 108, h: 156, m: 14 };
const pipSpot = (corner) => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const top = 74, bottom = 128; // clear of the top bar and the call controls
  return { x: corner.includes('l') ? PIP.m : vw - PIP.w - PIP.m, y: corner.includes('t') ? top : vh - PIP.h - bottom };
};

/**
 * A call stays alive while you use the rest of the app: leaving the call screen shrinks it into
 * the island pill at the top (see main.jsx). Only Leave, or everyone else hanging up, ends it.
 *
 * Connecting: the later joiner sends the offer. Every set-up message goes out live and is also kept on
 * the server, so /sync (every 1.5s while connecting) picks up anything the live channel dropped.
 */
export default function Call({ room, minimized, onClose }) {
  const { rt, me, navigate } = useApp();
  const [local, setLocal] = useState(null);
  const [peers, setPeers] = useState([]); // [{ peerId, user, stream, mic, cam, state, since }]
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [facing, setFacing] = useState('user');
  const [error, setError] = useState('');
  const [stage, setStage] = useState('camera'); // camera -> joining -> in
  const [relay, setRelay] = useState(true);
  const [started] = useState(Date.now());
  const [, tick] = useState(0);
  const [ringing, setRinging] = useState([]); // people this caller is ringing: [{ invite_id, user, status }]
  const [ended, setEnded] = useState('');
  const [swapped, setSwapped] = useState(false); // your video big, theirs small
  const [corner, setCorner] = useState('tr');
  const [drag, setDrag] = useState(null); // { x, y } while the small video is being dragged
  const pcs = useRef(new Map());
  const localRef = useRef(null);
  const selfRef = useRef(null); // this browser's peer id in the call
  const everJoined = useRef(false);
  const endTimer = useRef(null);

  const onCallScreen = () => location.pathname.startsWith('/call/');
  const minimize = () => navigate(window.history.length > 1 ? -1 : '/');
  const back = () => { onClose?.(); if (onCallScreen()) minimize(); };
  // Show why the call is over for a moment, then go back.
  const end = (why) => {
    if (endTimer.current) return;
    setEnded(why);
    localRef.current?.getTracks().forEach((t) => t.stop());
    endTimer.current = setTimeout(back, 1800);
  };
  useEffect(() => () => clearTimeout(endTimer.current), []);

  const upsert = (peerId, patch) => setPeers((list) => {
    const i = list.findIndex((p) => p.peerId === peerId);
    if (i === -1) return [...list, { peerId, mic: true, cam: true, since: Date.now(), ...patch }];
    const copy = [...list]; copy[i] = { ...copy[i], ...patch }; return copy;
  });

  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!rt) return;
    let cancelled = false;
    let ice = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], policy: 'all' };
    let joinedAt = '';
    let lastSeq = 0;
    const seen = new Set();
    const missing = new Map(); // peers the server no longer lists, counted per sync
    const api = (what, body = {}, opts) => post(`/calls/${room}/${what}`, { from: selfRef.current, ...body }, opts);

    const signal = (to, data) => api('signal', { to, data }).catch(() => {});
    // ICE candidates come in bursts; send each burst as one message.
    const outbox = new Map();
    const sendCandidate = (to, candidate) => {
      if (!outbox.has(to)) { outbox.set(to, []); setTimeout(() => { const c = outbox.get(to); outbox.delete(to); signal(to, { candidates: c }); }, 150); }
      outbox.get(to).push(candidate);
    };

    const offer = async (peerId, entry, restart = false) => {
      const { pc } = entry;
      entry.makingOffer = true;
      try {
        await pc.setLocalDescription(await pc.createOffer(restart ? { iceRestart: true } : undefined));
        signal(peerId, { sdp: pc.localDescription });
      } finally { entry.makingOffer = false; }
    };

    const makePeer = (peerId, user, initiator) => {
      if (pcs.current.has(peerId)) return pcs.current.get(peerId);
      const pc = new RTCPeerConnection({ iceServers: ice.iceServers, iceTransportPolicy: ice.policy });
      const entry = { pc, pending: [], user, initiator, makingOffer: false, restarts: 0, lostAt: 0 };
      pcs.current.set(peerId, entry);
      localRef.current?.getTracks().forEach((t) => pc.addTrack(t, localRef.current));
      pc.onicecandidate = (e) => e.candidate && sendCandidate(peerId, e.candidate);
      pc.ontrack = (e) => upsert(peerId, { stream: e.streams[0] || new MediaStream([e.track]) });
      const onState = () => {
        const st = stateOf(pc);
        upsert(peerId, { state: st });
        entry.lostAt = st === 'reconnecting' ? entry.lostAt || Date.now() : 0;
        // The offering side restarts ICE when a connection fails.
        if (st === 'failed' && entry.initiator && entry.restarts < 3) { entry.restarts++; offer(peerId, entry, true).catch(() => {}); }
      };
      pc.onconnectionstatechange = onState;
      pc.oniceconnectionstatechange = onState;
      upsert(peerId, { user, state: 'connecting', since: Date.now() });
      if (initiator) offer(peerId, entry).catch(console.warn);
      return entry;
    };

    const drop = (peerId) => {
      pcs.current.get(peerId)?.pc.close();
      pcs.current.delete(peerId);
      setPeers((l) => l.filter((p) => p.peerId !== peerId));
    };

    const handleSignal = async ({ seq, from, data }) => {
      if (seq) { if (seen.has(seq)) return; seen.add(seq); lastSeq = Math.max(lastSeq, seq); }
      if (!data) return;
      const entry = pcs.current.get(from) || makePeer(from, null, false);
      const { pc } = entry;
      try {
        if (data.sdp) {
          // Both sides offered at once: the offering side keeps its offer, the other gives way.
          const collision = data.sdp.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
          if (collision && entry.initiator) return;
          if (collision) await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
          if (data.sdp.type === 'answer' && pc.signalingState !== 'have-local-offer') return; // a repeat
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            signal(from, { sdp: pc.localDescription });
          }
          for (const c of entry.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        }
        for (const c of data.candidates || []) {
          if (pc.remoteDescription) await pc.addIceCandidate(c).catch(() => {});
          else entry.pending.push(c);
        }
      } catch (e) { console.warn('signal error', e); }
    };

    // The later joiner makes the offer, so both phones agree without talking first.
    const iStart = (p) => (p.joined_at || '') < joinedAt || ((p.joined_at || '') === joinedAt && p.peerId < selfRef.current);

    const mine = (p) => p.room === room && selfRef.current && p.peerId !== selfRef.current;
    const onSignal = (p) => { if (p.room === room && p.to === selfRef.current) handleSignal(p); };
    const onJoined = (p) => mine(p) && makePeer(p.peerId, p.user, false);
    const onLeft = (p) => mine(p) && drop(p.peerId);
    const onMedia = (p) => mine(p) && upsert(p.peerId, { mic: p.mic, cam: p.cam });
    const onAnswer = (p) => p.room_id === room && setRinging((l) => l.map((r) => (r.invite_id === p.invite_id ? { ...r, status: p.accept ? 'accepted' : 'declined' } : r)));

    let syncTimer, giveUp;
    const join = async () => {
      const res = await post(`/calls/${room}/join`);
      if (cancelled) { selfRef.current = res.self; leave(); return false; }
      selfRef.current = res.self;
      joinedAt = res.joined_at || new Date().toISOString();
      lastSeq = 0; seen.clear();
      return res;
    };
    const sync = async () => {
      if (cancelled || !selfRef.current) return;
      try {
        const r = await get(`/calls/${room}/sync?peer=${selfRef.current}&after=${lastSeq}`);
        if (cancelled) return;
        if (r.gone) { // the server lost track of us (phone slept): join again
          pcs.current.forEach((_, id) => drop(id));
          const res = await join();
          res?.peers?.forEach((p) => makePeer(p.peerId, p.user, true));
          return;
        }
        for (const s of r.signals) await handleSignal(s);
        const listed = new Set(r.peers.map((p) => p.peerId));
        for (const p of r.peers) {
          if (!pcs.current.has(p.peerId)) makePeer(p.peerId, p.user, iStart(p));
          else if (!pcs.current.get(p.peerId).user && p.user) { pcs.current.get(p.peerId).user = p.user; upsert(p.peerId, { user: p.user }); }
        }
        for (const id of pcs.current.keys()) {
          if (listed.has(id)) { missing.delete(id); continue; }
          missing.set(id, (missing.get(id) || 0) + 1);
          if (missing.get(id) >= 2) drop(id); // they left and the live event got lost
        }
        // Stuck on "reconnecting" for a while: the offering side tries a fresh route.
        for (const [id, e] of pcs.current) if (e.initiator && e.lostAt && Date.now() - e.lostAt > 6000 && e.restarts < 3) { e.restarts++; e.lostAt = Date.now(); offer(id, e, true).catch(() => {}); }
      } catch { /* offline for a moment: try again next round */ } finally {
        const settled = pcs.current.size > 0 && [...pcs.current.values()].every((e) => stateOf(e.pc) === 'connected');
        if (!cancelled) syncTimer = setTimeout(sync, settled ? 10000 : 1500);
      }
    };

    const leave = () => { if (selfRef.current) api('leave', {}, { keepalive: true }).catch(() => {}); selfRef.current = null; };
    (async () => {
      const iceP = get('/calls/ice').then((r) => { ice = r; setRelay(!!r.relay); }).catch(() => {});
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); setCam(false); }
        catch { setError('Camera and microphone are blocked. Allow them for this site and try again.'); return; }
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      localRef.current = stream;
      setLocal(stream);
      await iceP;
      rt.on('call:signal', onSignal);
      rt.on('call:peer-joined', onJoined);
      rt.on('call:peer-left', onLeft);
      rt.on('call:media', onMedia);
      rt.on('invite:response', onAnswer);
      setStage('joining');
      try {
        const res = await join();
        if (!res) return;
        setStage('in');
        setRinging(res.ringing || []);
        res.peers.forEach((p) => makePeer(p.peerId, p.user, true));
        syncTimer = setTimeout(sync, 1200);
        // Nobody picked up in time: stop ringing them (leaving marks it missed) and close the call.
        giveUp = setTimeout(() => { if (!everJoined.current) end(res.ringing?.length ? 'No answer' : 'Call ended'); }, res.ring_ms || 45000);
      } catch (e) { end(e.message); }
    })();
    window.addEventListener('pagehide', leave);

    return () => {
      cancelled = true;
      clearTimeout(syncTimer);
      clearTimeout(giveUp);
      window.removeEventListener('pagehide', leave);
      leave();
      rt.off('invite:response', onAnswer);
      rt.off('call:signal', onSignal);
      rt.off('call:peer-joined', onJoined);
      rt.off('call:peer-left', onLeft);
      rt.off('call:media', onMedia);
      pcs.current.forEach(({ pc }) => pc.close());
      pcs.current.clear();
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
      setPeers([]);
    };
  }, [rt, room]); // eslint-disable-line

  // Everyone else hung up: the call is over.
  useEffect(() => {
    if (peers.length) everJoined.current = true;
    else if (everJoined.current) end('Call ended');
    if (peers.length !== 1) setSwapped(false);
  }, [peers.length]); // eslint-disable-line

  // Caller hears a soft ringback while it rings.
  const ringingOut = !ended && !peers.length && ringing.some((r) => r.status === 'pending');
  useEffect(() => (ringingOut ? ring('ringback') : undefined), [ringingOut]);

  // Everyone we rang said no.
  useEffect(() => {
    if (everJoined.current || !ringing.length || !ringing.every((r) => r.status === 'declined')) return;
    end(ringing.length === 1 ? `${ringing[0].user?.display_name?.split(' ')[0] || 'They'} declined` : 'Nobody can make it right now');
  }, [ringing]); // eslint-disable-line

  const toggleMic = () => {
    const v = !mic; setMic(v);
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = v));
    post(`/calls/${room}/media`, { from: selfRef.current, mic: v, cam }).catch(() => {});
  };
  const toggleCam = () => {
    const v = !cam; setCam(v);
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = v));
    post(`/calls/${room}/media`, { from: selfRef.current, mic, cam: v }).catch(() => {});
  };
  const flip = async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next } });
      const track = s.getVideoTracks()[0];
      const old = localRef.current.getVideoTracks()[0];
      pcs.current.forEach(({ pc }) => pc.getSenders().find((x) => x.track?.kind === 'video')?.replaceTrack(track));
      if (old) { localRef.current.removeTrack(old); old.stop(); }
      localRef.current.addTrack(track);
      setLocal(new MediaStream(localRef.current.getTracks()));
      setFacing(next);
    } catch { /* single camera */ }
  };
  const hangup = () => { clearTimeout(endTimer.current); back(); };

  // The small video: tap to swap with the big one, drag to any corner.
  const press = useRef(null);
  const onPipDown = (e) => {
    const spot = pipSpot(corner);
    press.current = { sx: e.clientX, sy: e.clientY, x: spot.x, y: spot.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPipMove = (e) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
    if (!p.moved && Math.hypot(dx, dy) < 6) return;
    p.moved = true;
    setDrag({ x: p.x + dx, y: p.y + dy });
  };
  const onPipUp = (e) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (!p.moved) { if (peers.length === 1) setSwapped((s) => !s); return; }
    const cx = p.x + (e.clientX - p.sx) + PIP.w / 2, cy = p.y + (e.clientY - p.sy) + PIP.h / 2;
    setCorner(`${cy < window.innerHeight / 2 ? 't' : 'b'}${cx < window.innerWidth / 2 ? 'l' : 'r'}`);
    setDrag(null);
  };

  const connectedAt = useRef(0);
  const connected = peers.some((p) => p.state === 'connected');
  if (connected && !connectedAt.current) connectedAt.current = Date.now();
  // The timer starts when someone picks up, like a phone call.
  const secs = Math.floor((Date.now() - (connectedAt.current || started)) / 1000);
  const dur = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const first = (u) => u?.display_name?.split(' ')[0] || 'Friend';
  const joining = ringing.filter((r) => r.status === 'accepted');
  const waitingFor = ringing.filter((r) => r.status === 'pending');
  const waiting = ended || error
    || (stage === 'camera' ? 'Starting your camera…'
      : joining.length ? `${joining.map((r) => first(r.user)).join(', ')} ${joining.length > 1 ? 'are' : 'is'} joining…`
        : waitingFor.length ? `Ringing ${waitingFor.map((r) => first(r.user)).join(', ')}…` : 'Connecting…');
  const who = ringing[0]?.user || null;

  const names = peers.map((p) => first(p.user)).join(', ') || waitingFor.map((r) => first(r.user)).join(', ');
  const solo = peers.length === 1 ? peers[0] : null;
  const status = (p) => {
    if (p.state === 'connected') return '';
    const long = Date.now() - (p.since || Date.now()) > 12000;
    if (p.state === 'reconnecting') return 'Reconnecting…';
    if (!long) return 'Connecting…';
    return relay ? 'Still connecting… weak network' : "Can't reach them directly. Mobile data may need a call relay (see README).";
  };
  const remoteView = (p, big) => (
    <div key={p.peerId} className={`tile ${big ? 'big' : ''}`}>
      {p.stream && <Video stream={p.stream} hidden={p.cam === false} />}
      {(!p.stream || p.cam === false) && <div className="tile-avatar"><Avatar user={p.user} size={big ? 110 : 64} /></div>}
      {status(p) && <div className="tile-status">{status(p)}</div>}
      <span className="tile-name">{p.user?.display_name || 'Friend'}{p.mic === false ? ' · muted' : ''}</span>
    </div>
  );
  const selfView = (big) => (
    <div className={`self ${big ? 'big' : ''}`}>
      {local && <Video stream={local} muted mirror={facing === 'user'} hidden={!cam} />}
      {(!local || !cam) && <div className="tile-avatar"><Avatar user={me} size={big ? 110 : 44} /></div>}
    </div>
  );
  const spot = drag || pipSpot(corner);
  const pipContent = solo ? (swapped ? remoteView(solo, false) : selfView(false)) : peers.length > 1 || local ? selfView(false) : null;

  return (
    <>
    {minimized && (
      <button className={`island call-pill ${connected ? 'live' : ''}`} onClick={() => navigate(`/call/${room}`)} aria-label="Back to the call">
        <span className="pill-dot" />
        <span className="pill-name ellipsis">{ended || names || 'Call'}</span>
        <span className="mono">{ended ? '' : connected ? dur : '…'}</span>
      </button>
    )}
    <div className={`call ${minimized ? 'mini' : ''}`} aria-hidden={minimized}>
      <button className="call-min" onClick={minimize} aria-label="Minimise call"><Icon name="down" size={26} /></button>
      {peers.length === 0 ? (
        <div className="call-waiting">
          {local && cam && <Video stream={local} muted mirror={facing === 'user'} className="call-backdrop" />}
          <div className="call-waiting-card">
            <div className={ringingOut ? 'ring-pulse' : ''}><Avatar user={who || me} size={104} /></div>
            {who && <h2>{who.display_name}</h2>}
            <p>{waiting}</p>
          </div>
        </div>
      ) : solo ? (
        <div className="call-solo">{swapped ? selfView(true) : remoteView(solo, true)}</div>
      ) : (
        <div className={`call-grid n${Math.min(peers.length, 4)}`}>{peers.map((p) => remoteView(p, false))}</div>
      )}
      {peers.length > 0 && pipContent && (
        <div className={`pip ${drag ? 'dragging' : ''}`} style={{ transform: `translate(${spot.x}px, ${spot.y}px)` }}
          onPointerDown={onPipDown} onPointerMove={onPipMove} onPointerUp={onPipUp} onPointerCancel={onPipUp}
          role="button" aria-label={solo ? 'Swap videos' : 'Your video'}>
          {pipContent}
        </div>
      )}
      <div className="call-top"><span>{ended ? 'Call ended' : connected ? dur : peers.length ? 'Connecting' : ringing.length ? 'Calling' : 'Connecting'}</span></div>
      <div className="call-controls">
        <button className={`cbtn ${mic ? '' : 'off'}`} onClick={toggleMic}><Icon name={mic ? 'mic' : 'micOff'} /><small>{mic ? 'Mute' : 'Unmute'}</small></button>
        <button className={`cbtn ${cam ? '' : 'off'}`} onClick={toggleCam}><Icon name={cam ? 'video' : 'camOff'} /><small>Camera</small></button>
        <button className="cbtn" onClick={flip}><Icon name="flip" /><small>Flip</small></button>
        <button className="cbtn hang" onClick={hangup}><Icon name="phone" /><small>Leave</small></button>
      </div>
    </div>
    </>
  );
}
