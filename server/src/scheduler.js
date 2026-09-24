import { q, run, prefsOf } from './db.js';
import { notify } from './notify.js';
import { formatWhen } from './time.js';
import { internalSecret } from './auth.js';
import { background } from './background.js';

// Reminders are sent by `runReminders`, which is safe to call any number of times.
// Who calls it:
//  - npm start / Docker: a 30s timer (startScheduler)
//  - Vercel: a QStash message queued for each reminder's exact time, a daily Vercel Cron sweep
//    (which also queues the next day's reminders), and, at most once a minute, any heartbeat from an open app.

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const QSTASH_URL = (process.env.QSTASH_URL || 'https://qstash.upstash.io').replace(/\/$/, '');
const QUEUE_AHEAD_MS = 26 * 3600000; // the daily sweep queues everything due before the next sweep
export const remindersKind = QSTASH_TOKEN ? 'qstash' : process.env.VERCEL ? 'cron-only' : 'timer';

export const remindAt = (startISO, minutes) => new Date(Date.parse(startISO) - minutes * 60000).toISOString();

function humanLead(mins) {
  if (mins >= 1440 && mins % 1440 === 0) return mins === 1440 ? 'tomorrow' : `in ${mins / 1440} days`;
  if (mins >= 60 && mins % 60 === 0) return mins === 60 ? 'in 1 hour' : `in ${mins / 60} hours`;
  return `in ${mins} min`;
}

export async function runReminders() {
  const nowMs = Date.now();
  const due = await q(
    `SELECT * FROM events WHERE reminder_sent = 0 AND remind_at <= ? AND start_at > ?`,
    [new Date(nowMs).toISOString(), new Date(nowMs - 5 * 60000).toISOString()]
  );
  let sent = 0;
  for (const e of due) {
    // Claim it first so two overlapping runs never send the same reminder twice.
    if (!(await run('UPDATE events SET reminder_sent = 1 WHERE id = ? AND reminder_sent = 0', [e.id]))) continue;
    const startMs = Date.parse(e.start_at);
    // Everyone going (or not answered yet), except anyone who turned reminders off.
    const members = (await q(`SELECT m.user_id, u.prefs FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = ? AND m.rsvp != 'declined'`, [e.id]))
      .filter((r) => prefsOf(r).notify_reminders).map((r) => r.user_id);
    const minsLeft = Math.max(0, Math.round((startMs - nowMs) / 60000));
    const lead = minsLeft <= 1 ? 'now' : humanLead(Math.abs(minsLeft - e.reminder_minutes) <= 1 ? e.reminder_minutes : minsLeft);
    const actions = e.type === 'call' && e.call_room
      ? [{ action: 'join', title: 'Join call', url: `/call/${e.call_room}` }]
      : [{ action: 'open', title: 'View plan', url: `/event/${e.id}` }];
    await notify(members, {
      kind: 'reminder',
      title: `Reminder: ${e.title} ${lead === 'now' ? 'is starting' : lead}`,
      body: [formatWhen(e.start_at, e.end_at), e.location, e.notes].filter(Boolean).join(' · ').slice(0, 240),
      url: `/event/${e.id}`,
      tag: `reminder-${e.id}`,
      actions,
      alwaysPush: true,
    });
    sent++;
  }
  return sent;
}

/** Public base URL of this deployment, for QStash to call back. */
export function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return req ? `${req.protocol}://${req.get('host')}` : null;
}

/** Ask QStash to call /api/cron/reminders at the reminder time. No-op without QStash. */
async function queueOne(e, base) {
  const at = Math.ceil(Date.parse(e.remind_at) / 1000) + 1; // whole seconds: round up so it never lands before the reminder is due
  const res = await fetch(`${QSTASH_URL}/v2/publish/${base}/api/cron/reminders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      'Upstash-Not-Before': String(at),
      'Upstash-Retries': '3',
      'Upstash-Forward-Authorization': `Bearer ${await internalSecret()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_id: e.id }),
  });
  if (!res.ok) throw new Error(`QStash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  await run('UPDATE events SET reminder_queued = ? WHERE id = ?', [e.remind_at, e.id]);
}

/** After an event is created or moved: send now if already due, or queue it if it's due before the next daily sweep. */
export async function scheduleReminder(e, req) {
  if (!e?.remind_at || e.reminder_sent) return;
  const ms = Date.parse(e.remind_at);
  if (ms <= Date.now()) return void background(runReminders());
  if (!QSTASH_TOKEN || ms > Date.now() + QUEUE_AHEAD_MS) return;
  const base = baseUrl(req);
  if (base) await queueOne(e, base).catch((x) => console.warn('[reminders]', x.message));
}

/** Daily sweep: queue the reminders due before the next sweep that aren't queued yet. */
export async function queueUpcoming(req) {
  if (!QSTASH_TOKEN) return 0;
  const base = baseUrl(req);
  if (!base) return 0;
  const rows = await q(
    `SELECT * FROM events WHERE reminder_sent = 0 AND remind_at > ? AND remind_at <= ? AND (reminder_queued IS NULL OR reminder_queued != remind_at)`,
    [new Date().toISOString(), new Date(Date.now() + QUEUE_AHEAD_MS).toISOString()]
  );
  for (const e of rows) await queueOne(e, base).catch((x) => console.warn('[reminders]', x.message));
  return rows.length;
}

// Opportunistic check from live traffic, at most once a minute per instance.
let lastRun = 0;
export function maybeRunReminders() {
  if (Date.now() - lastRun < 60000) return;
  lastRun = Date.now();
  background(runReminders().catch((e) => console.warn('[reminders]', e.message)));
}

export function startScheduler() {
  setInterval(() => runReminders().catch((e) => console.warn('[scheduler]', e.message)), 30000);
  setTimeout(() => runReminders().catch(() => {}), 3000);
}
