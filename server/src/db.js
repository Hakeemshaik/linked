import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SERVER_DIR } from './env.js';

// Postgres everywhere. DATABASE_URL (Neon on Vercel) -> pg pool. Unset -> embedded PGlite in DATA_DIR,
// so `npm start` and Docker need no database server.
const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const DATA_DIR = process.env.DATA_DIR || path.join(SERVER_DIR, 'data');
export const dbKind = URL ? 'postgres' : 'local';

const NOW = `(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`;
const SCHEMA_VERSION = '1';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  status_text TEXT NOT NULL DEFAULT '',
  last_seen TEXT,
  visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));
CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE(from_id, to_id)
);
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_avail_user_date ON availability(user_id, date);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'hangout',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  conversation_id TEXT,
  call_room TEXT,
  reminder_minutes INTEGER NOT NULL DEFAULT 60,
  remind_at TEXT,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  reminder_queued TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_events_remind ON events(reminder_sent, remind_at);
CREATE TABLE IF NOT EXISTS event_members (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rsvp TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY(event_id, user_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  name TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  is_ai INTEGER NOT NULL DEFAULT 0,
  ai_busy_until TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT,
  PRIMARY KEY(conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL DEFAULT '',
  data TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  room_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_invites_room ON invites(room_id);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '/',
  data TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS call_peers (
  peer_id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_peers_room ON call_peers(room);
CREATE TABLE IF NOT EXISTS relay (
  id TEXT PRIMARY KEY,
  user_ids TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

let driverP = null;
function driver() {
  if (driverP) return driverP;
  driverP = (async () => {
    // Vercel has no writable disk for the embedded database, so a missing DATABASE_URL is a setup error.
    if (!URL && process.env.VERCEL) throw setupError('No database yet. In Vercel, open Storage, add Neon, connect it to this project, then redeploy.');
    let d;
    if (URL) {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({ connectionString: URL, max: Number(process.env.DB_POOL_MAX || 5), idleTimeoutMillis: 10000 });
      pool.on('error', (e) => console.warn('[db] idle client error', e.message));
      // On Vercel, close idle connections before the function instance is suspended.
      try { (await import('@vercel/functions')).attachDatabasePool?.(pool); } catch { /* not on Vercel */ }
      d = {
        query: async (text, params) => { const r = await pool.query(text, params); return { rows: r.rows, count: r.rowCount ?? 0 }; },
        exec: (sql) => pool.query(sql),
      };
    } else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const { PGlite } = await import('@electric-sql/pglite'); // left out of the Vercel bundle (vercel.json excludeFiles)
      const lite = new PGlite(path.join(DATA_DIR, 'pgdata'));
      await lite.waitReady;
      d = {
        query: async (text, params) => { const r = await lite.query(text, params); return { rows: r.rows, count: r.affectedRows ?? 0 }; },
        exec: (sql) => lite.exec(sql),
      };
    }
    await migrate(d);
    return d;
  })();
  driverP.catch(() => { driverP = null; }); // retry on the next request instead of caching a failure
  return driverP;
}

async function migrate(d) {
  try {
    const { rows } = await d.query(`SELECT value FROM kv WHERE key = 'schema'`, []);
    if (rows[0]?.value === SCHEMA_VERSION) return;
  } catch { /* first run: no kv table yet */ }
  // One round trip, serialised across cold starts so two instances never race on CREATE.
  await d.exec(`BEGIN; SELECT pg_advisory_xact_lock(727274); ${SCHEMA}
    INSERT INTO kv (key, value) VALUES ('schema', '${SCHEMA_VERSION}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value; COMMIT;`);
}

/** An error whose message is safe and useful to show in the app (setup problems). */
export const setupError = (message) => Object.assign(new Error(message), { expose: true });

// Write SQL with ? placeholders; they become $1, $2, ... for Postgres.
const numbered = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

export async function q(sql, params = []) { return (await (await driver()).query(numbered(sql), params)).rows; }
export async function one(sql, params = []) { return (await q(sql, params))[0]; }
export async function run(sql, params = []) { return (await (await driver()).query(numbered(sql), params)).count; }
export const ready = () => driver();

/** A value stored once in the DB (generated secrets). Safe when many instances start at the same time. */
export async function kvGetOrCreate(key, make) {
  const hit = await one('SELECT value FROM kv WHERE key = ?', [key]);
  if (hit) return hit.value;
  await run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [key, make()]);
  return (await one('SELECT value FROM kv WHERE key = ?', [key])).value;
}

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export const publicUser = (u) =>
  u && {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    color: u.color,
    status: u.status,
    status_text: u.status_text,
    last_seen: u.last_seen,
  };

export const getUser = (uid) => (uid ? one('SELECT * FROM users WHERE id = ?', [uid]) : Promise.resolve(undefined));
/** Users for these ids, in the same order. */
export async function getUsers(ids) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return [];
  const rows = await q('SELECT * FROM users WHERE id = ANY(?)', [uniq]);
  return rows.sort((x, y) => uniq.indexOf(x.id) - uniq.indexOf(y.id));
}
export const findUser = (username) => one('SELECT * FROM users WHERE lower(username) = lower(?)', [username || '']);

export const friendIds = async (uid) => (await q('SELECT friend_id FROM friends WHERE user_id = ?', [uid])).map((r) => r.friend_id);
export const areFriends = async (a, b) => !!(await one('SELECT 1 AS x FROM friends WHERE user_id = ? AND friend_id = ?', [a, b]));
export const isMember = async (convId, uid) =>
  !!(await one('SELECT 1 AS x FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [convId, uid]));
export const memberIds = async (convId) =>
  (await q('SELECT user_id FROM conversation_members WHERE conversation_id = ?', [convId])).map((r) => r.user_id);

export const parseRow = (row, field = 'data') => {
  if (!row) return row;
  if (row[field]) {
    try { row[field] = JSON.parse(row[field]); } catch { /* keep string */ }
  }
  return row;
};
