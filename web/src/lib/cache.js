// What you last saw, kept on the phone, so screens show instantly and then refresh.
// One store per signed-in person; cleared on sign out.
const KEY = 'linkup_cache_v1';
const MAX_CHATS = 15; // chats whose messages are kept
let mem = null;
let timer = null;

function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { mem = {}; }
  return mem;
}
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); }
    catch { mem.msgs = {}; try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* storage full or blocked */ } }
  }, 250);
}

/** Use the cache for this person (drops another account's). */
export function cacheFor(uid) {
  const m = load();
  if (uid && m.uid !== uid) { mem = { uid }; save(); }
}
export const cached = (key) => load()[key];
export function cache(key, value) { load()[key] = value; save(); }
export function clearCache() { mem = {}; try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** The last messages of a chat (without on-phone-only fields like local previews). */
export const cachedMessages = (cid) => load().msgs?.[cid] || null;
export function cacheMessages(cid, conv, msgs) {
  const m = load();
  m.msgs ||= {};
  const keep = msgs.filter((x) => !x.pending && !x.failed).slice(-40).map(({ local, file, req, progress, ...rest }) => rest);
  m.msgs[cid] = { conv, msgs: keep, at: Date.now() };
  const ids = Object.keys(m.msgs);
  if (ids.length > MAX_CHATS) ids.sort((a, b) => m.msgs[a].at - m.msgs[b].at).slice(0, ids.length - MAX_CHATS).forEach((k) => delete m.msgs[k]);
  save();
}
