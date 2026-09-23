import { waitUntil } from '@vercel/functions';

/**
 * Work that should finish after the response is sent (Planner replies, pushes).
 * On Vercel this keeps the function alive until it's done; on a normal server it just runs.
 */
export function background(promise) {
  const p = Promise.resolve(promise).catch((e) => console.warn('[background]', e.message));
  try { waitUntil(p); } catch { /* not on Vercel */ }
  return p;
}
