import { get, post, getToken, API_BASE } from './api.js';

/**
 * Live events from the server. Same shape as a socket: on(event, fn), off(event, fn).
 * On Vercel they come over Pusher (a private channel per user); with npm start, over an SSE stream.
 * Everything the app sends (typing, call signalling, presence) goes through the normal API.
 */
export function connectRealtime(rt, userId) {
  const listeners = new Map();
  const fire = (event, payload) => listeners.get(event)?.forEach((fn) => fn(payload));
  // Big payloads (e.g. call offers) are parked on the server and fetched here.
  const deliver = async (event, payload) => {
    if (payload?._relay) {
      try { payload = (await get(`/realtime/relay/${payload._relay}`)).payload; } catch { return; }
    }
    fire(event, payload);
  };

  let close = () => {};
  if (rt?.driver === 'pusher') {
    let stopped = false;
    import('pusher-js').then(({ default: Pusher }) => {
      if (stopped) return;
      const p = new Pusher(rt.key, {
        cluster: rt.cluster,
        ...(rt.wsHost ? { wsHost: rt.wsHost, wsPort: rt.wsPort, wssPort: rt.wsPort, forceTLS: rt.forceTLS, enabledTransports: ['ws', 'wss'], disableStats: true } : {}),
        channelAuthorization: {
          customHandler: ({ socketId, channelName }, cb) =>
            post('/realtime/auth', { socket_id: socketId, channel_name: channelName }).then((r) => cb(null, r), (e) => cb(e, null)),
        },
      });
      const ch = p.subscribe(`private-user-${userId}`);
      ch.bind('pusher:subscription_succeeded', () => fire('connect'));
      ch.bind_global((event, data) => { if (!event.startsWith('pusher')) deliver(event, data); });
      close = () => p.disconnect();
    });
    close = () => { stopped = true; };
  } else if (rt?.driver === 'sse') {
    const es = new EventSource(`${API_BASE}/api/realtime/stream?token=${encodeURIComponent(getToken() || '')}`);
    es.onopen = () => fire('connect');
    es.onmessage = (e) => { try { const { event, payload } = JSON.parse(e.data); deliver(event, payload); } catch { /* ignore */ } };
    close = () => es.close();
  }

  return {
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    off(event, fn) { listeners.get(event)?.delete(fn); },
    /** Deliver an event locally, as if the server had sent it. */
    emitLocal: fire,
    disconnect: () => close(),
  };
}
