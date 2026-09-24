import { q, memberIds, getUser, getUsers } from './db.js';
import { TZ, nextDays, zonedToDate, dateKey, timeKey } from './time.js';

const BASE = (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, '');
const MODEL = process.env.LLM_MODEL || 'llama3.2:3b';
const KEY = process.env.LLM_API_KEY || 'ollama';
// On Vercel the function itself stops at 300s, so give up on the model a little before that.
const TIMEOUT = Math.min(Number(process.env.LLM_TIMEOUT_MS || 180000), process.env.VERCEL ? 280000 : Infinity);
let jsonMode = process.env.LLM_JSON_MODE !== 'false';

export const aiInfo = { base: BASE, model: MODEL, key: KEY };
// On Vercel, a localhost model URL can only mean LLM_BASE_URL was never set.
export const aiMisconfigured = !!process.env.VERCEL && /^https?:\/\/(localhost|127\.|0\.0\.0\.0)/.test(BASE);
// Sent on every call: ngrok's free tunnels show a warning page unless asked not to.
export const aiHeaders = { Authorization: `Bearer ${KEY}`, 'ngrok-skip-browser-warning': '1' };

/**
 * One call to the model. json: ask for a JSON object (plan extraction). stream + onText: get the reply
 * as it's written, for servers that stream (LM Studio, Ollama); others just answer at the end.
 */
async function chat(messages, { json = false, stream = false, temperature = 0.2, onText } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  const useJson = () => json && jsonMode;
  const send = () => fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    signal: ctrl.signal,
    headers: { 'Content-Type': 'application/json', ...aiHeaders },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature,
      stream,
      ...(useJson() ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  try {
    let res = await send();
    // Some servers (LM Studio) reject JSON mode. The prompt already asks for JSON, so retry without it.
    if (res.status === 400 && useJson()) {
      const text = await res.text();
      if (/response_format|json/i.test(text)) { jsonMode = false; res = await send(); }
      else throw Object.assign(new Error(`HTTP 400: ${text.slice(0, 160)}`), { kind: 'http' });
    }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`), { kind: 'http' });
    if (!stream || !/event-stream/.test(res.headers.get('content-type') || '')) {
      const j = await res.json();
      return j.choices?.[0]?.message?.content || '';
    }
    // Server-sent events: "data: {choices:[{delta:{content}}]}" lines, then "data: [DONE]".
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const c = JSON.parse(data).choices?.[0];
          const piece = c?.delta?.content ?? c?.message?.content ?? '';
          if (piece) { text += piece; onText?.(text); }
        } catch { /* a keep-alive or partial line */ }
      }
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}

/** Why Planner couldn't answer, in words the chat can show. */
export function aiErrorText(e) {
  if (aiMisconfigured && e?.kind !== 'http') return 'LLM_BASE_URL is not set on the server';
  if (e?.name === 'AbortError') return 'the model took too long';
  if (e?.kind === 'http') return `the model server said ${e.message}`;
  return 'cannot reach the model server';
}

function extractJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return null;
}

async function scheduleContext(users, days) {
  const from = days[0].date;
  const to = days[days.length - 1].date;
  const lines = [];
  for (const u of users) {
    const uid = u.id;
    const blocks = (await q('SELECT * FROM availability WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_time NULLS FIRST', [uid, from, to]))
      .map((a) => `${a.date} ${a.kind}${a.start_time ? ` ${a.start_time}-${a.end_time}` : ' all day'}`);
    const evs = (await q(
      `SELECT e.* FROM events e JOIN event_members m ON m.event_id = e.id
       WHERE m.user_id = ? AND m.rsvp != 'declined' AND e.end_at >= ? ORDER BY e.start_at LIMIT 15`,
      [uid, new Date().toISOString()]
    )).map((e) => `${dateKey(e.start_at)} ${timeKey(e.start_at)} event "${e.title}"`);
    const all = [...blocks, ...evs];
    lines.push(`- ${u.display_name} (@${u.username}): ${all.length ? all.join('; ') : 'nothing blocked, free every day'}`);
  }
  return lines.join('\n');
}

async function transcript(convId, limit = 40) {
  const rows = (await q('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?', [convId, limit])).reverse();
  const names = new Map((await getUsers(rows.map((m) => m.sender_id).filter(Boolean))).map((u) => [u.id, u.display_name]));
  return rows
    .map((m) => {
      if (m.kind === 'plan') return `Planner: [proposed a plan card]`;
      const who = m.sender_id ? names.get(m.sender_id) || 'Someone' : 'Planner';
      return `${who}: ${m.body}`;
    })
    .join('\n');
}

const SYSTEM = `You are "Planner", the AI inside a friends' planning app. Friends chat, and you help them
turn conversations into real plans (trips, hangouts, meetings, video calls, events) on their shared calendar.
You ALWAYS answer with a single JSON object and nothing else:
{
  "reply": "short, casual message (max 2 sentences)",
  "plan": null OR {
    "title": "short event title",
    "type": "trip" | "hangout" | "meeting" | "call" | "event",
    "date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD or null (only for multi-day trips)",
    "start_time": "HH:MM 24h, or null if no time was said (the app then picks the first free slot)",
    "end_time": "HH:MM 24h or null",
    "location": "place or empty string",
    "notes": "key details agreed (who brings what, budget, etc.) or empty string",
    "participants": ["username", ...],
    "reminder_minutes": number of minutes before the start to remind everyone (15, 30, 60, 120 or 1440)
  }
}
Rules:
- Resolve relative dates ("this Saturday", "tomorrow", "next weekend") using the calendar provided. Never invent a past date.
- Pick times when the people involved are free according to their schedules. "After work" means 17:30 or later.
- Pick a sensible reminder: calls 15, hangouts 60, meetings 30, trips 1440 (a day before), unless they asked for one.
- participants are usernames from the member list.
- If people ask when others are free, answer from the schedules provided.`;

export async function runAI(convId, { mode = 'reply', requesterId, instruction = '', memberIdsOverride, personal = false } = {}) {
  const ids = memberIdsOverride || (await memberIds(convId));
  const byId = new Map((await getUsers(ids)).map((u) => [u.id, u]));
  const members = ids.map((x) => byId.get(x)).filter(Boolean);
  const days = nextDays(21);
  const nowStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date());
  const requester = byId.get(requesterId) || (await getUser(requesterId));

  const context = `Now: ${nowStr} (${TZ}).
Calendar (next 21 days):
${days.map((d) => `${d.date} = ${d.label}`).join('\n')}

${mode === 'schedule' || personal ? `The user is ${requester?.display_name} (username: ${requester?.username}). Their friends:` : 'Members of this chat:'}
${members.map((m) => `- ${m.display_name} (username: ${m.username})`).join('\n')}

Schedules (busy / work blocks and events already booked):
${await scheduleContext(members, days)}
${convId ? `\nChat so far:\n${(await transcript(convId)) || '(empty)'}` : ''}`;

  const who = requester?.display_name || 'A member';
  const ask = {
    plan: `${who} tapped "Plan it". Extract the plan being discussed in the chat above and return it in "plan". Put a one-line summary in "reply". If there is truly nothing to plan, set "plan": null and say what's missing.`,
    schedule: `${who} wants you to put this on the calendar: "${instruction}". Always return a "plan". Include ${requester?.username} in participants plus only the friends they mentioned. Choose the date and time, and a reminder. In "reply", say in one line when you booked it and why that slot works.`,
    reply: personal
      ? `${who} (in their private chat with you) says: "${instruction}". Answer in "reply". If they want something booked, planned or reminded, fill "plan": include ${requester?.username} plus only the friends they mention, pick a time when those people are free, and a reminder.`
      : `${who} asked you: "${instruction}". Answer in "reply". If they are asking you to set up / book / plan something, also fill "plan".`,
  }[mode];

  const raw = await chat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${context}\n\n${ask}` },
  ], { json: true });
  const parsed = extractJSON(raw);
  if (!parsed) return { reply: raw.trim().slice(0, 1000) || "I couldn't work that out, try again?", plan: null };
  const solo = mode === 'schedule' || personal;
  const defaultIds = solo ? [requesterId] : null;
  return {
    reply: String(parsed.reply || '').slice(0, 1000),
    plan: parsed.plan ? await normalizePlan(parsed.plan, members, { defaultIds, requesterId: solo ? requesterId : null, from: searchFromHint(instruction) }) : null,
  };
}

// ---------------- conversation: Planner as a friend in the chat ----------------

// So Planner can answer "how do I...?" about the app itself, correctly.
const APP_GUIDE = `How Linkup works (use this when people ask about the app):
- Chats: swipe a chat left to archive it (More has the rest), swipe right to mark it read or unread. Hold a chat to pin it (up to 3), mute it, add it to Favourites or a list, clear it or delete it. Archived chats sit at the top of the list.
- In a chat: hold a message to react, reply, edit it (your own, for 15 minutes), star it, copy it or delete it for everyone. Swipe a message right to reply. The + button sends photos, documents, a plan, a video call or a chill invite. The mic records a voice message.
- Tap the name at the top of a chat for contact or group info: media, links and docs, starred messages, search in the chat, mute, chat theme, groups in common, favourites, block, clear chat, delete or exit.
- Tabs: Chats, Calendar (see who's free, block out time, add plans), Calls, Communities (several groups under one roof, plus an Announcements chat for everyone), and You (profile and settings).
- You tab: Starred, Lists (your own chat filters), Broadcast messages (one message sent to each person separately), Linked devices (sign in on another device with a QR code), Account (passkeys, password, add or switch accounts, delete account), Privacy (last seen, read receipts, blocked people), Chats (wallpaper, enter to send, archive or clear all), Appearance (light or dark, colour, text size), Notifications, Camera and microphone, Storage and Help.
- Inviting friends: You, then Invite (or the QR code button): share a link, show the QR code, or share your username.
- On iPhone, add Linkup to the Home Screen (Share, then Add to Home Screen) to get notifications. Leaving the app during a call keeps the call going.
- You (Planner) can be asked anything in any chat with @Planner, or in your own Planner chat.`;

const PERSONA = `You are Planner, the assistant inside Linkup, a messenger for a small group of friends (time zone ${TZ}).
You're warm, relaxed and quick, like the clever friend in the group chat. Talk naturally, in plain words.
Keep it short: usually one to three sentences. Go longer only when someone asks for detail, steps or a list.
You can talk about anything and answer any question: ideas, recommendations, facts, advice, maths, writing, jokes.
You also help the friends plan, using their calendars below, and you know how the Linkup app works (see the guide).

Rules:
- Reply in the language the person wrote to you in.
- Think before you answer, then give only the answer. Check dates and weekdays against the calendar below; never use a date that has passed.
- For maths, work it out step by step in your head and give the result; for facts, only state what you're confident about.
- For who is free and what's booked, only use the schedules and events listed below. Never invent plans, times or people.
- If you're not sure of a fact, say so briefly instead of guessing.
- Plain text only: no markdown, headings or tables. A short list with "- " is fine when it helps.
- No emoji characters. If it fits, you may use one of the app's own emoji codes: :love: :lol: :hype: :cheers: :party: :omw: :braai: :free: :meh: :sleepy:
- Refer to people by first name. Don't start with "As an AI".
- When someone clearly asks you to book, plan, schedule or remind them of something, say in one line what you're setting up, then put this at the very end:
<plan>{"title":"short title","type":"trip|hangout|meeting|call|event","date":"YYYY-MM-DD","end_date":null,"start_time":"HH:MM or null","end_time":"HH:MM or null","location":"","notes":"","participants":["username"],"reminder_minutes":60}</plan>
  Only add it when they ask for something to be booked or reminded. Never mention it or show JSON otherwise.
  Resolve dates from the calendar, pick times when those people are free ("after work" means 17:30 or later), and a reminder (calls 15, hangouts 60, meetings 30, trips 1440).
  Example: "book padel with Sipho on Saturday at 10" becomes one line like "Done, padel with Sipho on Saturday at 10:00." then
  <plan>{"title":"Padel with Sipho","type":"hangout","date":"<that Saturday's date>","end_date":null,"start_time":"10:00","end_time":"11:30","location":"","notes":"","participants":["<your username>","<sipho's username>"],"reminder_minutes":60}</plan>

${APP_GUIDE}`;

/** Who's in the conversation and what their next three weeks look like. */
async function contextFor(members, requester, personal) {
  const days = nextDays(21);
  const nowStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date());
  return `Now: ${nowStr} (${TZ}).
Calendar (next 21 days):
${days.map((d) => `${d.date} = ${d.label}`).join('\n')}

${personal ? `You're talking with ${requester?.display_name} (username: ${requester?.username}) in their private chat with you. Their friends:` : 'People in this chat:'}
${members.map((m) => `- ${m.display_name} (username: ${m.username})${statusLine(m)}`).join('\n')}

Schedules (busy / work blocks and events already booked):
${await scheduleContext(members, days)}

${requester ? `${requester.display_name.split(' ')[0]}'s upcoming plans:\n${await upcomingFor(requester.id)}` : ''}`;
}

const STATUS_WORD = { available: 'available', busy: 'busy', work: 'at work', away: 'away' };
const statusLine = (u) => {
  const bits = [u.status && u.status !== 'invisible' ? STATUS_WORD[u.status] : null, u.status_text ? `"${String(u.status_text).slice(0, 60)}"` : null].filter(Boolean);
  return bits.length ? ` · status: ${bits.join(', ')}` : '';
};

/** Plans someone is going to in the next weeks: what, when, where, with whom. */
async function upcomingFor(uid) {
  const rows = await q(`SELECT e.* FROM events e JOIN event_members m ON m.event_id = e.id
    WHERE m.user_id = ? AND m.rsvp != 'declined' AND e.end_at >= ? ORDER BY e.start_at LIMIT 10`, [uid, new Date().toISOString()]);
  if (!rows.length) return '- nothing booked';
  const out = [];
  for (const e of rows) {
    const who = (await q(`SELECT u.display_name FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = ? AND m.user_id != ? AND m.rsvp != 'declined'`, [e.id, uid]))
      .map((r) => r.display_name.split(' ')[0]);
    out.push(`- ${dateKey(e.start_at)} ${timeKey(e.start_at)}-${timeKey(e.end_at)} "${e.title}"${e.location ? ` at ${e.location}` : ''}${who.length ? ` with ${who.join(', ')}` : ''}`);
  }
  return out.join('\n');
}

const MEDIA_TEXT = { image: '[a photo]', voice: '[a voice message]', sticker: '[a sticker]', gif: '[a GIF]', file: '[a document]' };
const CATCH_UP = /\b(catch (me|us) up|summari[sz]e|summary|what did i miss|what happened|recap|tl;?dr)\b/i;

/** The recent chat as turns the model remembers: people are "user", Planner is "assistant". */
async function historyTurns(convId, { personal, skipId, limit = 18 }) {
  const rows = (await q('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?', [convId, limit + 1]))
    .filter((m) => m.id !== skipId).slice(0, limit).reverse();
  const names = new Map((await getUsers(rows.map((m) => m.sender_id).filter(Boolean))).map((u) => [u.id, u.display_name.split(' ')[0]]));
  const turns = [];
  for (const m of rows) {
    if (m.kind === 'system' || m.kind === 'deleted') continue;
    let data = {};
    try { data = m.data ? JSON.parse(m.data) : {}; } catch { /* ignore */ }
    if (!m.sender_id) {
      const p = data.plan;
      turns.push({ role: 'assistant', content: m.kind === 'plan' ? `[I suggested a plan: ${p?.title || m.body}${p?.start_at ? `, ${dateKey(p.start_at)} ${timeKey(p.start_at)}` : ''}${data.status === 'created' ? ', now booked' : ''}]` : m.body });
      continue;
    }
    const text = [MEDIA_TEXT[m.kind], m.body && !MEDIA_TEXT[m.kind] ? m.body : m.kind === 'image' || m.kind === 'file' ? m.body : ''].filter(Boolean).join(' ').slice(0, 600);
    turns.push({ role: 'user', content: personal ? text : `${names.get(m.sender_id) || 'Someone'}: ${text}` });
  }
  return turns;
}

/** Many chat templates need user/assistant turns to alternate, starting with the user. */
function alternate(turns) {
  const out = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += `\n${t.content}`;
    else out.push({ ...t });
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

// Hide reasoning ("<think>") and the plan block while the reply streams in.
export function visibleText(t = '') {
  let v = t.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
  const cut = v.search(/<plan\b/i);
  if (cut >= 0) v = v.slice(0, cut);
  const lt = v.lastIndexOf('<');
  const tail = lt >= 0 ? v.slice(lt).toLowerCase() : '';
  if (tail && !tail.includes('>') && ['<plan', '<think'].some((tag) => tag.startsWith(tail))) v = v.slice(0, lt); // a tag still arriving
  if (v.trimStart().startsWith('{')) return ''; // the model went JSON; wait for the end
  return v.trim();
}

const TO_CODE = [[/[\u{1F49C}❤\u{1F496}\u{1F497}\u{1F60D}\u{1F970}]️?/gu, ':love:'], [/[\u{1F602}\u{1F923}\u{1F606}]/gu, ':lol:'], [/\u{1F525}/gu, ':hype:'],
  [/[\u{1F37B}\u{1F942}\u{1F37A}]/gu, ':cheers:'], [/[\u{1F389}\u{1F973}\u{1F38A}]/gu, ':party:'], [/[\u{1F634}\u{1F4A4}]/gu, ':sleepy:'], [/\u{1F612}/gu, ':meh:'], [/\u{1F3C3}/gu, ':omw:'], [/[✅✔]️?/gu, ':free:']];
const APP_CODES = new Set(['love', 'lol', 'hype', 'omw', 'braai', 'cheers', 'free', 'meh', 'sleepy', 'party']);
/** The app draws its own emoji, so common ones become its codes and the rest are dropped; markdown goes too. */
export function cleanReply(t = '') {
  let v = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  for (const [re, code] of TO_CODE) v = v.replace(re, code);
  v = v.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/:([a-z]+):/g, (m, id) => (APP_CODES.has(id) ? m : ''));
  v = v.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[*•]\s+/gm, '- ');
  return v.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2500);
}

/** The reply text and the plan block (if any), from what the model wrote. */
export function parseReply(raw = '') {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const m = t.match(/<plan>\s*([\s\S]*?)\s*(<\/plan>|$)/i);
  if (m) return { reply: t.slice(0, m.index).trim(), plan: extractJSON(m[1]) };
  if (t.startsWith('{') || t.startsWith('```')) {
    const j = extractJSON(t);
    if (j && typeof j === 'object' && ('reply' in j || 'plan' in j)) return { reply: String(j.reply || ''), plan: j.plan || null };
  }
  return { reply: t, plan: null };
}

/**
 * Planner answers a message in the chat, remembering the conversation. onText(visible) is called as the
 * reply is written. trigger = the message it's answering (and trigger.quoted, what that message replied to).
 */
export async function converse(convId, { requesterId, instruction = '', trigger = null, memberIdsOverride, personal = false, onText } = {}) {
  const ids = memberIdsOverride || (await memberIds(convId));
  const byId = new Map((await getUsers(ids)).map((u) => [u.id, u]));
  const members = ids.map((x) => byId.get(x)).filter(Boolean);
  const requester = byId.get(requesterId) || (await getUser(requesterId));
  const first = (requester?.display_name || 'Someone').split(' ')[0];
  // "Catch me up" reads much further back, and asks for a short summary.
  const catchUp = CATCH_UP.test(instruction);
  const history = await historyTurns(convId, { personal, skipId: trigger?.id, limit: catchUp ? 80 : 18 });
  const quoted = trigger?.quoted ? ` (replying to ${trigger.quoted.sender_name || 'someone'}: "${String(trigger.quoted.body || MEDIA_TEXT[trigger.quoted.kind] || '').slice(0, 300)}")` : '';
  let ask = personal ? `${instruction}${quoted}` : `${first} asks you${quoted}: ${instruction}`;
  if (catchUp) ask += '\n(Catch them up on the chat above: the main points, what was decided, and anything waiting on them, as a few short "- " lines.)';
  const messages = [
    { role: 'system', content: `${PERSONA}\n\n${await contextFor(members, requester, personal)}` },
    ...alternate([...history, { role: 'user', content: ask || '(no text)' }]),
  ];
  let last = '';
  let raw;
  try {
    raw = await chat(messages, {
      stream: true, temperature: 0.7,
      onText: (t) => { const v = visibleText(t); if (v && v !== last) { last = v; onText?.(cleanReply(v)); } },
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    raw = await chat(messages, { temperature: 0.5 }); // a hiccup mid-stream: ask once more, in one go
  }
  // An empty answer (some small models do this) gets one more try.
  if (!visibleText(raw) && !/<plan>/i.test(raw)) raw = await chat(messages, { temperature: 0.4 }).catch(() => raw);
  const { reply, plan } = parseReply(raw);
  const solo = personal;
  return {
    reply: cleanReply(reply),
    plan: plan && typeof plan === 'object' ? await normalizePlan(plan, members, { defaultIds: solo ? [requesterId] : null, requesterId: solo ? requesterId : null, from: searchFromHint(instruction) }) : null,
  };
}

const TYPES = ['trip', 'hangout', 'meeting', 'call', 'event'];
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
const pad = (t) => t.padStart(5, '0');
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DEFAULT_TIMES = { trip: ['08:00', '18:00'], meeting: ['10:00', '11:00'], call: ['19:00', '20:00'], hangout: ['18:00', '21:00'], event: ['18:00', '21:00'] };
const WORK = [8 * 60, 17 * 60];
const DEFAULT_REMINDER = { trip: 1440, meeting: 30, call: 15, hangout: 60, event: 60 };

/** Busy intervals (minutes from local midnight) for a set of users on a date. */
async function busyIntervals(userIds, date) {
  const dayStart = zonedToDate(date, '00:00').getTime();
  const out = [];
  for (const uid of userIds) {
    for (const b of await q(`SELECT * FROM availability WHERE user_id = ? AND date = ? AND kind IN ('busy','work')`, [uid, date])) {
      // An all-day "work" block means office hours; evenings stay open. All-day "busy" blocks the whole day.
      out.push(b.start_time ? [toMin(b.start_time), toMin(b.end_time)] : b.kind === 'work' ? [WORK[0], WORK[1]] : [0, 1440]);
    }
    const evs = await q(
      `SELECT e.start_at, e.end_at FROM events e JOIN event_members m ON m.event_id = e.id
       WHERE m.user_id = ? AND m.rsvp != 'declined' AND e.start_at < ? AND e.end_at > ?`,
      [uid, new Date(dayStart + 86400000).toISOString(), new Date(dayStart).toISOString()]
    );
    for (const e of evs) {
      out.push([Math.max(0, (Date.parse(e.start_at) - dayStart) / 60000), Math.min(1440, (Date.parse(e.end_at) - dayStart) / 60000)]);
    }
  }
  return out;
}

/** First slot on `date` where everyone is free, searching from `from` in 30-min steps. */
export async function findFreeSlot(userIds, date, durationMin, from = '09:00', until = '22:00') {
  const busy = await busyIntervals(userIds, date);
  let start = toMin(from);
  const nowMin = date === dateKey(new Date()) ? toMin(timeKey(new Date())) + 30 : 0;
  start = Math.max(start, Math.ceil(nowMin / 30) * 30);
  for (let t = start; t + durationMin <= toMin(until); t += 30) {
    if (!busy.some(([a, b]) => t < b && t + durationMin > a)) return toHHMM(t);
  }
  return null;
}

/** Earliest sensible start for the free-slot search, from words in the request. */
export function searchFromHint(text = '') {
  const t = text.toLowerCase();
  if (/after work|evening|tonight|after 5|after five/.test(t)) return '17:30';
  if (/lunch/.test(t)) return '12:00';
  if (/afternoon/.test(t)) return '13:00';
  if (/morning|breakfast|early/.test(t)) return '07:00';
  return null;
}

export async function normalizePlan(p, members, { defaultIds = null, requesterId = null, from: hintFrom = null } = {}) {
  const type = TYPES.includes(p.type) ? p.type : 'hangout';
  const today = dateKey(new Date());
  const date = isDate(p.date) && p.date >= today ? p.date : null;
  const endDate = isDate(p.end_date) && date && p.end_date > date ? p.end_date : null;

  const wanted = Array.isArray(p.participants) ? p.participants.map((x) => String(x).toLowerCase().replace(/^@/, '')) : [];
  let participants = members.filter((m) => wanted.includes(m.username.toLowerCase()) || wanted.includes(m.display_name.toLowerCase()));
  if (requesterId && !participants.some((m) => m.id === requesterId)) participants.unshift(members.find((m) => m.id === requesterId));
  participants = participants.filter(Boolean);
  if (!participants.length) participants = defaultIds ? members.filter((m) => defaultIds.includes(m.id)) : members;
  const pids = participants.map((m) => m.id);

  const [dStart, dEnd] = DEFAULT_TIMES[type];
  const duration = isTime(p.start_time) && isTime(p.end_time) && toMin(p.end_time) > toMin(p.start_time)
    ? toMin(p.end_time) - toMin(p.start_time) : toMin(dEnd) - toMin(dStart);
  let start = isTime(p.start_time) ? pad(p.start_time) : null;
  let autoPicked = false;
  if (!start && date && !endDate) {
    const from = hintFrom || (type === 'meeting' ? '09:00' : type === 'call' ? '17:00' : '10:00');
    start = (await findFreeSlot(pids, date, duration, from)) || (await findFreeSlot(pids, date, Math.min(duration, 60), from));
    autoPicked = !!start;
  }
  start = start || dStart;
  let end = isTime(p.end_time) && toMin(p.end_time) > toMin(start) ? pad(p.end_time) : toHHMM(Math.min(toMin(start) + duration, 23 * 60 + 59));
  if (endDate && isTime(p.end_time)) end = pad(p.end_time);
  else if (endDate) end = dEnd;

  const rm = Number(p.reminder_minutes);
  const reminder = Number.isFinite(rm) && rm >= 5 && rm <= 10080 ? Math.round(rm) : DEFAULT_REMINDER[type];

  const plan = {
    title: String(p.title || 'Plan').slice(0, 120),
    type,
    date,
    end_date: endDate,
    start_time: start,
    end_time: end,
    location: String(p.location || '').slice(0, 200),
    notes: String(p.notes || '').slice(0, 1000),
    participant_ids: pids,
    reminder_minutes: reminder,
    auto_time: autoPicked,
    missing: date ? [] : ['date'],
  };
  if (date) {
    plan.start_at = zonedToDate(date, start).toISOString();
    plan.end_at = zonedToDate(endDate || date, end).toISOString();
    plan.conflicts = await conflictsFor(pids, date, endDate || date, plan.start_at, plan.end_at);
  }
  return plan;
}

/** Who is busy during the plan window (blocks or other events). */
export async function conflictsFor(userIds, from, to, startISO, endISO) {
  const out = [];
  const s = startISO ? Date.parse(startISO) : null;
  const e = endISO ? Date.parse(endISO) : null;
  for (const uid of userIds) {
    const details = [];
    for (const r of await q(`SELECT * FROM availability WHERE user_id = ? AND date BETWEEN ? AND ? AND kind IN ('busy','work')`, [uid, from, to])) {
      const win = r.start_time ? [r.start_time, r.end_time] : r.kind === 'work' ? [toHHMM(WORK[0]), toHHMM(WORK[1])] : null;
      if (s && win) {
        const bs = zonedToDate(r.date, win[0]).getTime();
        const be = zonedToDate(r.date, win[1]).getTime();
        if (!(s < be && e > bs)) continue;
      }
      details.push(`${r.kind === 'work' ? 'working' : 'busy'}${win ? ` ${win[0]}-${win[1]}` : ' all day'}`);
    }
    if (s) {
      for (const ev of await q(
        `SELECT e.title, e.start_at, e.end_at FROM events e JOIN event_members m ON m.event_id = e.id
         WHERE m.user_id = ? AND m.rsvp != 'declined' AND e.start_at < ? AND e.end_at > ?`,
        [uid, new Date(e).toISOString(), new Date(s).toISOString()]
      )) details.push(`"${ev.title}" at ${timeKey(ev.start_at)}`);
    }
    if (details.length) out.push({ user_id: uid, name: (await getUser(uid))?.display_name, detail: details.join(', ') });
  }
  return out;
}
