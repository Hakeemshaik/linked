// The Calendar's smarts: when you and your friends are free together, a short brief of your week,
// and the Planner bar, which turns "padel with Sipho on Saturday" into real free times you can book.
// All times are worked out here from the calendars; the model only helps read what you typed.
import { q, getUsers, friendIds, publicUser } from '../db.js';
import { TZ, zonedToDate, dateKey, timeKey, nextDays } from '../time.js';
import { askJSON } from '../ai.js';

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const WORK = [8 * 60, 17 * 60];
const DAY = [8 * 60, 23 * 60];
export const PARTS = { morning: [7 * 60, 12 * 60], lunch: [11 * 60 + 30, 14 * 60 + 30], afternoon: [12 * 60, 17 * 60 + 30], evening: [17 * 60 + 30, 23 * 60], any: [9 * 60, 22 * 60 + 30] };
const DURATION = { hangout: 150, meeting: 60, call: 45, event: 180, trip: 600 };
const REMINDER = { trip: 1440, meeting: 30, call: 15, hangout: 60, event: 60 };
const TYPES = Object.keys(DURATION);
const addDays = (date, n) => dateKey(new Date(zonedToDate(date, '12:00').getTime() + n * 86400000));
const weekday = (date) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long' }).format(zonedToDate(date, '12:00'));
const dayLabel = (date) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(zonedToDate(date, '12:00'));

/** Busy minutes per person per day, for a range of days, in two queries. Map uid -> Map date -> [[a, b]] */
async function busyByUser(userIds, from, to) {
  const out = new Map(userIds.map((u) => [u, new Map()]));
  const add = (uid, date, a, b) => {
    if (b <= a) return;
    const m = out.get(uid);
    if (!m) return;
    if (!m.has(date)) m.set(date, []);
    m.get(date).push([Math.max(0, a), Math.min(1440, b)]);
  };
  const avail = await q(`SELECT user_id, date, kind, start_time, end_time FROM availability WHERE user_id = ANY(?) AND date BETWEEN ? AND ? AND kind IN ('busy', 'work')`, [userIds, from, to]);
  for (const r of avail) {
    if (r.start_time) add(r.user_id, r.date, toMin(r.start_time), toMin(r.end_time));
    else if (r.kind === 'work') add(r.user_id, r.date, WORK[0], WORK[1]); // "at work" all day means office hours
    else add(r.user_id, r.date, 0, 1440);
  }
  const startISO = zonedToDate(from, '00:00').toISOString();
  const endISO = zonedToDate(addDays(to, 1), '00:00').toISOString();
  const evs = await q(`SELECT m.user_id, e.start_at, e.end_at FROM events e JOIN event_members m ON m.event_id = e.id
    WHERE m.user_id = ANY(?) AND m.rsvp != 'declined' AND e.start_at < ? AND e.end_at > ?`, [userIds, endISO, startISO]);
  for (const e of evs) {
    const s = Date.parse(e.start_at), f = Date.parse(e.end_at);
    for (let d = dateKey(new Date(s)); d <= dateKey(new Date(f - 1)) && d <= to; d = addDays(d, 1)) {
      if (d < from) continue;
      const midnight = zonedToDate(d, '00:00').getTime();
      add(e.user_id, d, (s - midnight) / 60000, (f - midnight) / 60000);
    }
  }
  return out;
}

/** Free gaps between lo and hi minutes, given busy intervals; never in the past. */
function gaps(busy, lo, hi, date, minLen = 30) {
  const today = dateKey(new Date());
  if (date < today) return [];
  if (date === today) lo = Math.max(lo, Math.ceil((toMin(timeKey(new Date())) + 15) / 15) * 15);
  const merged = [...busy].sort((a, b) => a[0] - b[0]);
  const out = [];
  let t = lo;
  for (const [a, b] of merged) {
    if (b <= t) continue;
    if (a >= hi) break;
    if (a - t >= minLen) out.push([t, Math.min(a, hi)]);
    t = Math.max(t, b);
    if (t >= hi) break;
  }
  if (hi - t >= minLen) out.push([t, hi]);
  return out.map(([a, b]) => [Math.round(a), Math.round(b)]);
}
const busyOf = (map, ids, date) => ids.flatMap((u) => map.get(u)?.get(date) || []);

/** Friends among these ids (anyone else is dropped). */
async function friendsOnly(uid, ids) {
  const mine = new Set(await friendIds(uid));
  return [...new Set(ids)].filter((x) => mine.has(x));
}

// ---------- understanding "padel with Sipho on Saturday evening" ----------
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TYPE_WORDS = [['call', /\b(call|video|facetime|ring)\b/i], ['meeting', /\b(meeting|meet up to discuss|interview|work|sync|standup)\b/i],
  ['trip', /\b(trip|getaway|weekend away|holiday|road ?trip|camping|vacation)\b/i], ['event', /\b(party|concert|birthday|festival|event|show|match|game)\b/i]];

/** A best guess without the model: who, which days, what time of day, how long. Also fills gaps the model left. */
export function readRequest(text, friends, today = dateKey(new Date())) {
  const t = ` ${text.toLowerCase()} `;
  const who = friends.filter((f) => {
    const first = f.display_name.split(' ')[0].toLowerCase();
    return new RegExp(`[^a-z]${first.replace(/[^a-z]/g, '')}[^a-z]`).test(t) || t.includes(`@${f.username.toLowerCase()}`) || new RegExp(`[^a-z]${f.username.toLowerCase()}[^a-z]`).test(t);
  }).map((f) => f.id);
  const dow = (d) => zonedToDate(d, '12:00').getUTCDay();
  let dates = [];
  const nextWeekday = (i, skipWeek = false) => { for (let k = 0; k < 14; k++) { const d = addDays(today, k); if (dow(d) === i && (!skipWeek || k >= 7 - dow(today) + 1 || k >= 7)) return d; } return null; };
  if (/\b(today|tonight|this evening|now)\b/.test(t)) dates.push(today);
  if (/\btomorrow\b/.test(t)) dates.push(addDays(today, 1));
  WEEKDAYS.forEach((w, i) => { if (new RegExp(`\\b${w}s?\\b|\\b${w.slice(0, 3)}\\b`).test(t)) dates.push(nextWeekday(i, new RegExp(`next ${w}`).test(t))); });
  if (/\bweekend\b/.test(t)) { const sat = nextWeekday(6, /next weekend/.test(t)); dates.push(sat, addDays(sat, 1)); }
  if (/\bnext week\b/.test(t)) { const mon = nextWeekday(1, true); for (let k = 0; k < 7; k++) dates.push(addDays(mon, k)); }
  if (/\bthis week\b/.test(t)) { for (let k = 0; k < 7 - ((dow(today) + 6) % 7); k++) dates.push(addDays(today, k)); }
  dates = [...new Set(dates.filter(Boolean))];
  const part = /\b(morning|breakfast|brunch|sunrise)\b/.test(t) ? 'morning' : /\blunch\b/.test(t) ? 'lunch' : /\bafternoon\b/.test(t) ? 'afternoon'
    : /\b(evening|tonight|dinner|after work|drinks|braai|supper|night)\b/.test(t) ? 'evening' : 'any';
  const type = (TYPE_WORDS.find(([, re]) => re.test(t)) || ['hangout'])[0];
  let duration = null;
  const h = t.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/); const mn = t.match(/(\d+)\s*(minutes?|mins?|m)\b/);
  if (h) duration = Math.round(parseFloat(h[1]) * 60); else if (mn) duration = parseInt(mn[1], 10);
  let at = null;
  const tm = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) || t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || t.match(/\b(\d{1,2}):(\d{2})\b()/);
  if (tm) {
    let hh = parseInt(tm[1], 10); const mm = parseInt(tm[2] || '0', 10);
    if (tm[3] === 'pm' && hh < 12) hh += 12;
    if (tm[3] === 'am' && hh === 12) hh = 0;
    if (!tm[3] && hh >= 1 && hh <= 7) hh += 12; // "at 7" means the evening
    if (hh < 24 && mm < 60) at = toHHMM(hh * 60 + mm);
  }
  const names = friends.filter((f) => who.includes(f.id)).map((f) => f.display_name.split(' ')[0]);
  let title = text.replace(/@\w+/g, '')
    .replace(/\b(plan|book|schedule|set up|organi[sz]e|arrange|let'?s|can we|could we|please|i want to|we should|with|and|me|on|at|this|next|for|a|an|the|some)\b/gi, ' ')
    .replace(/\b(today|tonight|tomorrow|weekend|week|morning|afternoon|evening|night|after work|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)s?\b/gi, ' ')
    .replace(/\b\d+(\.\d+)?\s*(hours?|hrs?|h|minutes?|mins?)\b/gi, ' ').replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, ' ');
  for (const n of names) title = title.replace(new RegExp(`\\b${n}\\b`, 'gi'), ' ');
  title = title.replace(/[^\p{L}\p{N}' -]/gu, ' ').replace(/\s+/g, ' ').trim();
  title = title ? title[0].toUpperCase() + title.slice(1) : ({ call: 'Call', meeting: 'Meeting', trip: 'Trip', event: 'Event' }[type] || 'Hangout');
  if (names.length && !/\bwith\b/i.test(title)) title = `${title} with ${names.join(' and ')}`;
  return { title: title.slice(0, 80), type, participant_ids: who, dates, part, duration, at };
}

const INTENT_PROMPT = `INTENT. You read one request from a calendar app and return ONLY a JSON object:
{"title":"short event title, e.g. Padel with Sipho","type":"hangout|meeting|call|trip|event","participants":["username",...],
"dates":["YYYY-MM-DD",...],"part_of_day":"morning|lunch|afternoon|evening|any","time":"HH:MM or null","duration_minutes":number or null,
"location":"place or empty","reply":"one short friendly line saying what you'll look for"}
Use only usernames from the friend list. Resolve relative days with the calendar given; list every date that fits (for "this weekend" both days), or [] if none was said. Never use a past date.`;

async function understand(text, me, friends) {
  const base = readRequest(text, friends);
  const days = nextDays(21);
  let ai = null;
  try {
    ai = await askJSON(INTENT_PROMPT, `Now: ${dayLabel(dateKey(new Date()))} ${timeKey(new Date())} (${TZ}).
Calendar: ${days.map((d) => `${d.date}=${d.label}`).join('; ')}
Me: ${me.display_name} (username ${me.username}). Friends: ${friends.map((f) => `${f.display_name} (username ${f.username})`).join(', ') || 'none'}.
Request: "${text}"`);
  } catch { /* the model is off: the best guess above still works */ }
  if (!ai || typeof ai !== 'object' || !('title' in ai || 'dates' in ai)) return { ...base, reply: null, ai: false };
  const today = dateKey(new Date());
  const byName = (x) => friends.find((f) => [f.username.toLowerCase(), f.display_name.toLowerCase(), f.display_name.split(' ')[0].toLowerCase()].includes(String(x).toLowerCase().replace(/^@/, '')));
  const ids = (Array.isArray(ai.participants) ? ai.participants : []).map(byName).filter(Boolean).map((f) => f.id);
  const dates = (Array.isArray(ai.dates) ? ai.dates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today && d <= addDays(today, 60));
  const dur = Number(ai.duration_minutes);
  const who = friends.filter((f) => [...new Set([...ids, ...base.participant_ids])].includes(f.id)).map((f) => f.display_name.split(' ')[0]);
  let title = String(ai.title || '').trim().slice(0, 80) || base.title;
  if (who.length && !/\bwith\b/i.test(title) && !who.some((n) => title.includes(n))) title = `${title} with ${who.join(' and ')}`;
  // What the words clearly say ("evening", "at 7") wins over a vaguer reading.
  const part = ai.part_of_day && ai.part_of_day !== 'any' && PARTS[ai.part_of_day] ? ai.part_of_day : base.part;
  return {
    title,
    type: TYPES.includes(ai.type) ? ai.type : base.type,
    participant_ids: [...new Set([...ids, ...base.participant_ids])],
    dates: dates.length ? dates : base.dates,
    part,
    at: /^\d{1,2}:\d{2}$/.test(ai.time || '') ? ai.time.padStart(5, '0') : base.at,
    duration: Number.isFinite(dur) && dur >= 15 && dur <= 1440 ? Math.round(dur) : base.duration,
    location: String(ai.location || '').slice(0, 120),
    reply: typeof ai.reply === 'string' ? ai.reply.slice(0, 200) : null,
    ai: true,
  };
}

/** Up to three concrete times when everyone is free, on different days where possible. */
function pickTimes(intent, map, ids, names, range) {
  const dur = intent.duration || DURATION[intent.type];
  const [lo, hi] = intent.type === 'trip' ? [8 * 60, 20 * 60] : PARTS[intent.part] || PARTS.any;
  const out = [];
  for (const date of range) {
    if (out.length >= 3) break;
    const busy = busyOf(map, ids, date);
    let slot = null;
    if (intent.type === 'trip') {
      if (!busy.some(([a, b]) => a < 20 * 60 && b > 8 * 60)) slot = [8 * 60, 18 * 60];
    } else if (intent.at) {
      const s = toMin(intent.at);
      const free = gaps(busy, s, s + dur, date, dur);
      if (free.length && free[0][0] === s) slot = [s, s + dur];
    } else {
      // The first gap long enough, starting on the hour or half hour.
      for (const [a, b] of gaps(busy, lo, hi, date, dur)) {
        const start = Math.ceil(a / 30) * 30;
        if (start + dur <= b) { slot = [start, start + dur]; break; }
      }
    }
    if (!slot) continue;
    const end = Math.min(slot[1], 23 * 60 + 59);
    out.push({
      date, start_time: toHHMM(slot[0]), end_time: toHHMM(end),
      start_at: zonedToDate(date, toHHMM(slot[0])).toISOString(), end_at: zonedToDate(date, toHHMM(end)).toISOString(),
      label: dayLabel(date),
      why: names.length ? `You and ${names.join(' and ')} are free` : 'You are free',
    });
  }
  return out;
}

export function routes(api, { wrap, bad }) {
  // When you (and these friends) are free, day by day.
  api.get('/calendar/free', wrap(async (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : dateKey(new Date());
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') && req.query.to >= from ? req.query.to : addDays(from, 41);
    if (to > addDays(from, 62)) return bad(res, 'Too many days');
    const withIds = await friendsOnly(req.user.id, String(req.query.with || '').split(',').filter(Boolean));
    const ids = [req.user.id, ...withIds];
    const map = await busyByUser(ids, from, to);
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const windows = gaps(busyOf(map, ids, d), DAY[0], DAY[1], d, 60);
      // Exact times too, so a phone set to another time zone still lines them up with its plans.
      days.push({ date: d, windows, times: windows.map(([a, b]) => [zonedToDate(d, toHHMM(a)).toISOString(), zonedToDate(d, toHHMM(Math.min(b, 1439))).toISOString()]) });
    }
    res.json({ with: withIds, days });
  }));

  // This week at a glance: what's next, how full it is, and the best evening to get people together.
  api.get('/calendar/brief', wrap(async (req, res) => {
    const today = dateKey(new Date());
    const to = addDays(today, 6);
    const [next] = await q(`SELECT e.* FROM events e JOIN event_members m ON m.event_id = e.id
      WHERE m.user_id = ? AND m.rsvp != 'declined' AND e.end_at >= ? ORDER BY e.start_at LIMIT 1`, [req.user.id, new Date().toISOString()]);
    const plans = (await q(`SELECT COUNT(*)::int AS n FROM events e JOIN event_members m ON m.event_id = e.id
      WHERE m.user_id = ? AND m.rsvp != 'declined' AND e.start_at >= ? AND e.start_at < ?`,
    [req.user.id, new Date().toISOString(), zonedToDate(addDays(today, 7), '00:00').toISOString()]))[0]?.n || 0;
    const friends = await getUsers(await friendIds(req.user.id));
    const map = await busyByUser([req.user.id, ...friends.map((f) => f.id)], today, to);
    let best = null;
    let freeEvenings = 0;
    for (let d = today; d <= to; d = addDays(d, 1)) {
      const mine = gaps(busyOf(map, [req.user.id], d), ...PARTS.evening, d, 120);
      if (!mine.length) continue;
      freeEvenings++;
      const free = friends.filter((f) => gaps(busyOf(map, [req.user.id, f.id], d), ...PARTS.evening, d, 120).length);
      if (free.length && (!best || free.length > best.free.length)) best = { date: d, label: d === today ? 'Tonight' : `${weekday(d)} evening`, free };
    }
    res.json({
      next: next ? { id: next.id, title: next.title, type: next.type, start_at: next.start_at, end_at: next.end_at, location: next.location } : null,
      plans, free_evenings: freeEvenings,
      best: best ? { date: best.date, label: best.label, count: best.free.length, people: best.free.slice(0, 5).map(publicUser) } : null,
    });
  }));

  // The Planner bar: understand the request, then find real free times for everyone in it.
  api.post('/calendar/suggest', wrap(async (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 300);
    if (!text) return bad(res, 'Say what you want to plan');
    const friends = await getUsers(await friendIds(req.user.id));
    const intent = await understand(text, req.user, friends);
    const extra = await friendsOnly(req.user.id, Array.isArray(req.body?.with) ? req.body.with : []);
    intent.participant_ids = [...new Set([...intent.participant_ids, ...extra])].filter((x) => friends.some((f) => f.id === x));
    const ids = [req.user.id, ...intent.participant_ids];
    const today = dateKey(new Date());
    const asked = intent.dates.length ? intent.dates : Array.from({ length: 14 }, (_, i) => addDays(today, i));
    const last = [...asked].sort().pop();
    const map = await busyByUser(ids, today, addDays(last > today ? last : today, 14));
    const names = friends.filter((f) => intent.participant_ids.includes(f.id)).map((f) => f.display_name.split(' ')[0]);
    let options = pickTimes(intent, map, ids, names, asked);
    let note = null;
    // Nobody's free on the days asked: offer the next days that work.
    if (!options.length && intent.dates.length) {
      const later = Array.from({ length: 14 }, (_, i) => addDays(last, i + 1));
      options = pickTimes(intent, map, ids, names, later);
      note = options.length ? `Not everyone is free ${intent.dates.length === 1 ? `on ${weekday(intent.dates[0])}` : 'then'}, so here are the next times that work.` : null;
    }
    if (!options.length && intent.at) { // the exact time doesn't work: try the same part of day
      options = pickTimes({ ...intent, at: null }, map, ids, names, asked);
      if (options.length) note = `${intent.at} doesn't work for everyone. These do.`;
    }
    const what = intent.title[0].toLowerCase() + intent.title.slice(1);
    const reply = note || intent.reply || (options.length ? `Here's when ${names.length ? `you and ${names.join(' and ')} are` : "you're"} free for ${what}.` : "I couldn't find a time that works in the next two weeks.");
    res.json({
      intent: { title: intent.title, type: intent.type, participant_ids: intent.participant_ids, location: intent.location || '', duration: intent.duration || DURATION[intent.type], reminder_minutes: REMINDER[intent.type] },
      options, reply, used_ai: intent.ai,
    });
  }));
}
