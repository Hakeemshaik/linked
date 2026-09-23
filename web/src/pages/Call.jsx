import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { post } from '../lib/api.js';
import { Avatar, Icon } from '../components/ui.jsx';

function Video({ stream, muted, mirror, hidden }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={`${mirror ? 'mirror' : ''} ${hidden ? 'hidden' : ''}`} />;
}

export default function Call() {
  const { room } = useParams();
  const { rt, config, me, navigate } = useApp();
  const [local, setLocal] = useState(null);
  const [peers, setPeers] = useState([]); // [{ peerId, user, stream, mic, cam, state }]
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [facing, setFacing] = useState('user');
  const [error, setError] = useState('');
  const [started] = useState(Date.now());
  const [, tick] = useState(0);
  const pcs = useRef(new Map());
  const localRef = useRef(null);
  const selfRef = useRef(null); // this browser's peer id in the call

  const upsert = (peerId, patch) => setPeers((list) => {
    const i = list.findIndex((p) => p.peerId === peerId);
    if (i === -1) return [...list, { peerId, mic: true, cam: true, ...patch }];
    const copy = [...list]; copy[i] = { ...copy[i], ...patch }; return copy;
  });

  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!rt || !config) return;
    let cancelled = false;
    const iceServers = config.iceServers;
    const api = (what, body = {}, opts) => post(`/calls/${room}/${what}`, { from: selfRef.current, ...body }, opts);

    const signal = (to, data) => api('signal', { to, data }).catch(() => {});
    // ICE candidates come in bursts; send each burst as one message.
    const outbox = new Map();
    const sendCandidate = (to, candidate) => {
      if (!outbox.has(to)) { outbox.set(to, []); setTimeout(() => { const c = outbox.get(to); outbox.delete(to); signal(to, { candidates: c }); }, 150); }
      outbox.get(to).push(candidate);
    };

    const makePeer = (peerId, user, initiator) => {
      if (pcs.current.has(peerId)) return pcs.current.get(peerId);
      const pc = new RTCPeerConnection({ iceServers });
      const entry = { pc, pending: [], user, initiator };
      pcs.current.set(peerId, entry);
      localRef.current?.getTracks().forEach((t) => pc.addTrack(t, localRef.current));
      pc.onicecandidate = (e) => e.candidate && sendCandidate(peerId, e.candidate);
      pc.ontrack = (e) => upsert(peerId, { stream: e.streams[0] });
      pc.onconnectionstatechange = async () => {
        upsert(peerId, { state: pc.connectionState });
        if (pc.connectionState === 'failed' && entry.initiator) {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          signal(peerId, { sdp: pc.localDescription });
        }
      };
      upsert(peerId, { user, state: 'connecting' });
      if (initiator) {
        (async () => {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          signal(peerId, { sdp: pc.localDescription });
        })().catch(console.warn);
      }
      return entry;
    };

    const drop = (peerId) => {
      pcs.current.get(peerId)?.pc.close();
      pcs.current.delete(peerId);
      setPeers((l) => l.filter((p) => p.peerId !== peerId));
    };

    const mine = (p) => p.room === room && selfRef.current && p.peerId !== selfRef.current;
    const onSignal = async ({ room: r, from, to, data }) => {
      if (r !== room || to !== selfRef.current) return;
      const entry = pcs.current.get(from) || makePeer(from, null, false);
      const { pc } = entry;
      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
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
    const onJoined = (p) => mine(p) && makePeer(p.peerId, p.user, false);
    const onLeft = (p) => mine(p) && drop(p.peerId);
    const onMedia = (p) => mine(p) && upsert(p.peerId, { mic: p.mic, cam: p.cam });

    let ping;
    const leave = () => { if (selfRef.current) api('leave', {}, { keepalive: true }).catch(() => {}); selfRef.current = null; };
    (async () => {
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
      rt.on('call:signal', onSignal);
      rt.on('call:peer-joined', onJoined);
      rt.on('call:peer-left', onLeft);
      rt.on('call:media', onMedia);
      try {
        const res = await post(`/calls/${room}/join`);
        if (cancelled) { selfRef.current = res.self; leave(); return; }
        selfRef.current = res.self;
        res.peers.forEach((p) => makePeer(p.peerId, p.user, true));
        ping = setInterval(() => api('ping').catch(() => {}), 15000);
      } catch (e) { setError(e.message); }
    })();
    window.addEventListener('pagehide', leave);

    return () => {
      cancelled = true;
      clearInterval(ping);
      window.removeEventListener('pagehide', leave);
      leave();
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
  }, [rt, config, room]);

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
  const hangup = () => navigate(window.history.length > 1 ? -1 : '/');

  const secs = Math.floor((Date.now() - started) / 1000);
  const dur = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const connected = peers.some((p) => p.state === 'connected');

  return (
    <div className="call">
      <div className={`call-grid n${Math.min(peers.length, 4)}`}>
        {peers.length === 0 && (
          <div className="call-waiting">
            <Avatar user={me} size={96} />
            <p>{error || 'Ringing… waiting for others to join'}</p>
          </div>
        )}
        {peers.map((p) => (
          <div key={p.peerId} className="tile">
            {p.stream && <Video stream={p.stream} hidden={p.cam === false} />}
            {(!p.stream || p.cam === false) && <div className="tile-avatar"><Avatar user={p.user} size={80} /></div>}
            <span className="tile-name">{p.user?.display_name || 'Friend'}{p.mic === false ? ' · muted' : ''}{p.state && p.state !== 'connected' ? ` · ${p.state}` : ''}</span>
          </div>
        ))}
      </div>
      {local && <div className="self-view"><Video stream={local} muted mirror={facing === 'user'} />{!cam && <div className="self-off">Camera off</div>}</div>}
      <div className="call-top"><span>{connected ? dur : 'Connecting'}</span></div>
      <div className="call-controls">
        <button className={`cbtn ${mic ? '' : 'off'}`} onClick={toggleMic}><Icon name={mic ? 'mic' : 'micOff'} /><small>{mic ? 'Mute' : 'Unmute'}</small></button>
        <button className={`cbtn ${cam ? '' : 'off'}`} onClick={toggleCam}><Icon name={cam ? 'video' : 'camOff'} /><small>Camera</small></button>
        <button className="cbtn" onClick={flip}><Icon name="flip" /><small>Flip</small></button>
        <button className="cbtn hang" onClick={hangup}><Icon name="phone" /><small>Leave</small></button>
      </div>
    </div>
  );
}
