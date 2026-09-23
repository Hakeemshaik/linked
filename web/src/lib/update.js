import { useEffect, useState } from 'react';

/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

async function latestVersion() {
  const r = await fetch('/version.json', { cache: 'no-store' });
  return r.ok ? (await r.json()).version : null;
}

/**
 * Knows when a newer version is live. Checks on open, whenever the app comes back on screen,
 * and every 30 minutes. apply() switches to it and reloads.
 */
export function useUpdate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const v = await latestVersion();
        if (!stop && v && v !== APP_VERSION) setReady(true);
        const reg = await navigator.serviceWorker?.getRegistration();
        reg?.update().catch(() => {});
        // Already on the latest page but its service worker is still waiting: hand over quietly.
        if (v === APP_VERSION && reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      } catch { /* offline */ }
    };
    check();
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(check, 30 * 60000);
    return () => { stop = true; document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
  }, []);

  const apply = async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
      const next = reg?.waiting || reg?.installing;
      if (next) {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        next.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => location.reload(), 2500); // in case the handover event never comes
        return;
      }
    } catch { /* fall through */ }
    location.reload();
  };
  return { ready, apply };
}
