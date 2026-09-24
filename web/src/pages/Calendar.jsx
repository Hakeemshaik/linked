import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, del } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Avatar, Sheet, Icon, Orb, Header, TYPE_LABEL } from '../components/ui.jsx';
import { addDays, dayKey, fromKey, fmtLongDay, fmtTime, fmtRange } from '../lib/dates.js';

const STATE = {
  free: { label: 'Free', color: 'var(--ok)' },
  partial: { label: 'Some plans', color: 'var(--gold)' },
  busy: { label: 'Busy', color: 'var(--danger)' },
  work: { label: 'At work', color: 'var(--blue)' },
};
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function dayState(uid, key, data) {
  const blocks = data.blocks.filter((b) => b.user_id === uid && b.date === key);
  const allDay = blocks.find((b) => !b.start_time);
  const start = fromKey(key, '00:00').getTime();
  const end = start + 86400000;
  const evs = data.events.filter((e) => e.user_id === uid && Date.parse(e.start_at) < end && Date.parse(e.end_at) > start);
  if (allDay && allDay.kind !== 'free') return { state: allDay.kind, blocks, evs };
  if (evs.some((e) => Date.parse(e.start_at) <= start + 8 * 3600000 && Date.parse(e.end_at) >= end - 2 * 3600000)) return { state: 'busy', blocks, evs };
  if (evs.length || blocks.some((b) => b.start_time && b.kind !== 'free')) return { state: 'partial', blocks, evs };
  return { state: 'free', blocks, evs };
}

const HOUR = 46; // px per hour in the day timeline
const T0 = 7, T1 = 24; // the timeline runs 07:00 to midnight
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const monday = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const minsOf = (iso, key) => (Date.parse(iso) - fromKey(key, '00:00').getTime()) / 60000;

/** "in 2 days", "in 3 hours", "now" */
export function until(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'now';
  const h = ms / 3600000;
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60000))} min`;
  if (h < 20) return `in ${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
  const days = Math.round((fromKey(dayKey(iso)).getTime() - fromKey(dayKey(new Date())).getTime()) / 86400000);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/* Planner, right in the Calendar: say what you want, get real times when everyone's free, book one with a tap. */
function PlannerBar({ friends, withIds, seed, onBooked }) {
  const { toast, navigate } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [booking, setBooking] = useState(-1);
  const inputRef = useRef(null);
  const ask = async (t = text) => {
    t = t.trim();
    if (!t || busy) return;
    setBusy(true); setRes(null);
    try { setRes({ ...(await post('/calendar/suggest', { text: t, with: withIds })), asked: t }); }
    catch (e) { toast({ title: 'Planner', body: e.message }); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (seed?.text) { setText(seed.text); ask(seed.text); } }, [seed]); // eslint-disable-line
  const book = async (o, i) => {
    setBooking(i);
    try {
      const it = res.intent;
      const ev = (await post('/events', { title: it.title, type: it.type, start_at: o.start_at, end_at: o.end_at, participant_ids: it.participant_ids, location: it.location, reminder_minutes: it.reminder_minutes })).event;
      navigator.vibrate?.(20);
      toast({ title: 'Booked', body: `${it.title} · ${o.label}, ${fmtTime(o.start_at)}${it.participant_ids.length ? '. Invites sent' : ''}`, url: `/event/${ev.id}`, icon: 'check' });
      setRes(null); setText('');
      onBooked?.(o.date);
    } catch (e) { toast({ title: 'Could not book it', body: e.message }); } finally { setBooking(-1); }
  };
  const f = friends.map((x) => x.display_name.split(' ')[0]);
  const chips = [f[0] ? `Dinner with ${f[0]} this week` : 'Dinner this week', 'Coffee tomorrow morning', f[1] ? `Call ${f[1]} tonight` : 'Call tonight', 'Something fun this weekend'];
  const byId = (id) => friends.find((x) => x.id === id);
  return (
    <section className={`planner-bar ${busy ? 'busy' : ''} ${res ? 'open' : ''}`}>
      <form className="pb-input" onSubmit={(e) => { e.preventDefault(); ask(); inputRef.current?.blur(); }}>
        <Orb size={30} state={busy ? 'thinking' : 'idle'} />
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Plan something with friends…" aria-label="Ask Planner to plan something" enterKeyHint="go" />
        {text.trim() && <button className="pb-go" aria-label="Find times" disabled={busy}><Icon name="send" size={18} /></button>}
      </form>
      {!res && !busy && (
        <div className="pb-chips">{chips.map((c) => <button key={c} type="button" className="suggest-chip" onClick={() => { setText(c); ask(c); }}>{c}</button>)}</div>
      )}
      {busy && (
        <div className="pb-thinking" aria-live="polite">
          <p className="pb-reply shimmer-text">Finding times that work for everyone…</p>
          {[0, 1, 2].map((i) => <span key={i} className="slot-card skel-slot" style={{ '--i': i }} />)}
        </div>
      )}
      {res && (
        <div className="pb-result">
          <p className="pb-reply">{res.reply}</p>
          {res.options.map((o, i) => (
            <div key={o.start_at} className="slot-card" style={{ '--i': i }}>
              <span className="slot-date"><small>{o.label.split(' ')[0]}</small><b>{o.label.split(' ')[1]}</b></span>
              <span className="grow">
                <b>{fmtTime(o.start_at)}–{fmtTime(o.end_at)}</b>
                <small className="slot-why">
                  <span className="avatars">{res.intent.participant_ids.slice(0, 3).map((id) => byId(id) && <Avatar key={id} user={byId(id)} size={18} />)}</span>
                  {o.why}
                </small>
              </span>
              <button className="btn small primary" disabled={booking >= 0} onClick={() => book(o, i)}>{booking === i ? <span className="btn-spin" /> : 'Book'}</button>
            </div>
          ))}
          <div className="pb-actions">
            <b className="pb-title ellipsis">{res.intent.title}</b>
            <button className="link" onClick={() => navigate(`/plans/new?${new URLSearchParams({ title: res.intent.title, type: res.intent.type, with: res.intent.participant_ids.join(','), ...(res.options[0] ? { date: res.options[0].date, start: res.options[0].start_time, end: res.options[0].end_time } : {}) })}`)}>Other time</button>
            <button className="link muted" onClick={() => { setRes(null); setText(''); }}>Clear</button>
          </div>
        </div>
      )}
    </section>
  );
}

/* This week at a glance, and the evening most of your friends are free. */
function WeekBrief({ brief, onPlan }) {
  const { navigate } = useApp();
  if (!brief) return <section className="brief-card"><span className="skel line" style={{ width: '60%' }} /><span className="skel line sm" style={{ width: '40%' }} /></section>;
  const n = brief.next;
  return (
    <section className="brief-card">
      <div className="brief-top">
        <b>This week</b>
        <span className="brief-stats"><span><b>{brief.plans}</b> plan{brief.plans === 1 ? '' : 's'}</span><span><b>{brief.free_evenings}</b> free evening{brief.free_evenings === 1 ? '' : 's'}</span></span>
      </div>
      {n ? (
        <button className={`brief-next t-${n.type}`} onClick={() => navigate(`/event/${n.id}`)}>
          <span className="brief-dot" />
          <span className="grow"><small>Next up · {until(n.start_at)}</small><b className="ellipsis">{n.title}</b><small>{fmtRange(n.start_at, n.end_at)}{n.location ? ` · ${n.location}` : ''}</small></span>
          <Icon name="right" size={18} className="muted" />
        </button>
      ) : <p className="brief-empty">Nothing booked yet.</p>}
      {brief.best && (
        <button className="brief-best" onClick={() => onPlan(`Something ${brief.best.label.toLowerCase()} with ${brief.best.people.map((p) => p.display_name.split(' ')[0]).slice(0, 3).join(' and ')}`)}>
          <span className="avatars">{brief.best.people.slice(0, 3).map((p) => <Avatar key={p.id} user={p} size={26} />)}</span>
          <span className="grow"><b>{brief.best.label}</b><small>{brief.best.count === 1 ? `${brief.best.people[0].display_name.split(' ')[0]} is free too` : `${brief.best.count} friends are free`}</small></span>
          <span className="brief-plan"><Icon name="spark" size={15} />Plan it</span>
        </button>
      )}
    </section>
  );
}

/* One day, hour by hour: your plans, your busy time, and when you're free with the friends you picked. */
function Timeline({ date, events, blocks, windows, withNames, onFree, onEvent }) {
  const isToday = date === dayKey(new Date());
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { if (!isToday) return undefined; const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, [isToday]);
  const y = (m) => ((Math.max(T0 * 60, Math.min(T1 * 60, m)) - T0 * 60) / 60) * HOUR;
  // Overlapping plans sit side by side.
  const placed = [];
  for (const e of events) {
    const a = minsOf(e.start_at, date), b = minsOf(e.end_at, date);
    let col = 0;
    while (placed.some((p) => p.col === col && p.a < b && p.b > a)) col++;
    placed.push({ e, a, b, col });
  }
  const cols = Math.max(1, ...placed.map((p) => p.col + 1));
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    <div className="timeline" style={{ height: (T1 - T0) * HOUR }}>
      {Array.from({ length: T1 - T0 }, (_, i) => <div key={i} className="tl-hour" style={{ top: i * HOUR }}><span>{String(T0 + i).padStart(2, '0')}:00</span></div>)}
      <div className="tl-lane">
        {(windows || []).map(([a, b]) => (
          <button key={a} className="tl-free" style={{ top: y(a), height: Math.max(20, y(b) - y(a)) }} onClick={() => onFree([a, b])}>
            <span><Icon name="friends" size={13} />Free{withNames ? ` with ${withNames}` : ''} · {hhmm(a)}–{hhmm(b)}</span><b>Plan</b>
          </button>
        ))}
        {blocks.map((b) => {
          const a = b.start_time ? toMin(b.start_time) : b.kind === 'work' ? 8 * 60 : T0 * 60;
          const e = b.start_time ? toMin(b.end_time) : b.kind === 'work' ? 17 * 60 : T1 * 60;
          return <div key={b.id} className={`tl-busy ${b.kind}`} style={{ top: y(a), height: Math.max(18, y(e) - y(a)) }}><span>{b.kind === 'work' ? 'Work' : 'Busy'}{b.note ? ` · ${b.note}` : ''}</span></div>;
        })}
        {placed.map(({ e, a, b, col }) => (
          <button key={e.id} className={`tl-event t-${e.type}`} onClick={() => onEvent(e)}
            style={{ top: y(a), height: Math.max(26, y(b) - y(a) - 2), left: `${(col / cols) * 100}%`, width: `calc(${100 / cols}% - 4px)` }}>
            <b className="ellipsis">{e.title}</b><small>{fmtTime(e.start_at)}–{fmtTime(e.end_at)}</small>
          </button>
        ))}
        {isToday && nowMin >= T0 * 60 && <div className="tl-now" style={{ top: y(nowMin) }}><i /></div>}
      </div>
    </div>
  );
}

export default function Calendar() {
  const { me, friends, navigate, toast, openPlanner } = useApp();
  const today = dayKey(new Date());
  const [view, setView] = useState(() => { try { return localStorage.getItem('linkup_cal_view') || 'month'; } catch { return 'month'; } });
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [week, setWeek] = useState(() => monday(new Date()));
  const [dir, setDir] = useState('');
  const [sel, setSel] = useState(today);
  const [data, setData] = useState({ users: [], blocks: [], events: [] });
  const [withIds, setWithIds] = useState([]);
  const [free, setFree] = useState(new Map());
  const [brief, setBrief] = useState(null);
  const [seed, setSeed] = useState(null);
  const [quick, setQuick] = useState(null); // plan in a free window: { date, start, end, title }
  const [blockOpen, setBlockOpen] = useState(false);
  const [block, setBlock] = useState({ kind: 'busy', start_time: '09:00', end_time: '17:00', note: '' });
  useEffect(() => { try { localStorage.setItem('linkup_cal_view', view); } catch { /* ignore */ } }, [view]);

  const grid = useMemo(() => {
    const first = new Date(cursor);
    const offset = (first.getDay() + 6) % 7;
    const start = addDays(first, -offset);
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => addDays(start, i));
  }, [cursor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const range = view === 'week' ? weekDays : grid;
  const from = dayKey(range[0]);
  const to = dayKey(range[range.length - 1]);

  const load = () => get(`/availability?from=${from}&to=${to}`).then(setData).catch(() => {});
  const loadFree = () => {
    if (!withIds.length) { setFree(new Map()); return; }
    get(`/calendar/free?with=${withIds.join(',')}&from=${from}&to=${to}`)
      .then((r) => setFree(new Map(r.days.map((d) => [d.date, (d.times || []).map(([a, b]) => [Math.round(minsOf(a, d.date)), Math.round(minsOf(b, d.date))])]))))
      .catch(() => {});
  };
  const loadBrief = () => get('/calendar/brief').then(setBrief).catch(() => {});
  useEffect(() => { load(); }, [from, to]); // eslint-disable-line
  useEffect(() => { loadFree(); }, [from, to, withIds.join(',')]); // eslint-disable-line
  useEffect(() => { loadBrief(); }, []);
  const refresh = () => { load(); loadFree(); loadBrief(); };
  useSocket('availability:changed', refresh);
  useSocket('events:changed', refresh);

  const users = [...data.users].sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
  const myEvents = (key) => {
    const s = fromKey(key, '00:00').getTime(); const e = s + 86400000;
    const seen = new Set();
    return data.events
      .filter((ev) => ev.visible && ev.user_id === me?.id && Date.parse(ev.start_at) < e && Date.parse(ev.end_at) > s)
      .filter((ev) => (seen.has(ev.id) ? false : seen.add(ev.id)))
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  };
  const blocksOn = (key) => data.blocks.filter((b) => b.user_id === me?.id && b.date === key && b.kind !== 'free');

  const selDate = fromKey(sel);
  const selRows = users.map((u) => ({ u, ...dayState(u.id, sel, data) }));
  const selEvents = myEvents(sel);
  const myBlocks = data.blocks.filter((b) => b.user_id === me?.id && b.date === sel);
  const myAllDay = myBlocks.find((b) => !b.start_time)?.kind || 'free';
  const freeFriends = selRows.filter((r) => !r.u.me && r.state === 'free').length;
  const busyFriends = selRows.filter((r) => !r.u.me && r.state !== 'free').length;
  const withNames = friends.friends.filter((f) => withIds.includes(f.id)).map((f) => f.display_name.split(' ')[0]).join(', ');
  const together = (key) => (free.get(key) || []).reduce((m, [a, b]) => Math.max(m, b - a), 0);

  const setDay = async (kind) => {
    if (kind === 'free') await del(`/availability?date=${sel}`);
    else await post('/availability', { date: sel, kind });
    refresh();
  };
  const addBlock = async () => {
    try { await post('/availability', { date: sel, ...block }); setBlockOpen(false); refresh(); }
    catch (e) { toast({ title: 'Could not save', body: e.message }); }
  };
  const month = (n) => { setDir(n > 0 ? 'next' : 'prev'); setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1)); };
  // Same weekday in the new week.
  const shiftWeek = (n) => { setDir(n > 0 ? 'next' : 'prev'); const w = addDays(week, 7 * n); setWeek(w); setSel(dayKey(addDays(w, (fromKey(sel).getDay() + 6) % 7))); };
  const dayWord = sel === today ? 'today' : selDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

  // Swipe the month (or week) sideways to change it.
  const swipe = useRef(null);
  const onDown = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    const s0 = swipe.current; swipe.current = null;
    if (!s0) return;
    const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (view === 'week' ? shiftWeek : month)(dx < 0 ? 1 : -1);
  };
  const goToday = () => { const d = new Date(); setDir(''); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setWeek(monday(d)); setSel(today); };
  const away = sel !== today || (view === 'month' ? cursor.getMonth() !== new Date().getMonth() || cursor.getFullYear() !== new Date().getFullYear() : dayKey(week) !== dayKey(monday(new Date())));
  const pick = (key) => { setSel(key); const d = fromKey(key); if (view === 'week' && dayKey(monday(d)) !== dayKey(week)) setWeek(monday(d)); };
  const toggleWith = (id) => setWithIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const planFree = (date, [a, b]) => setQuick({ date, start: hhmm(a), end: hhmm(Math.min(b, a + 150)), title: withNames ? `Hangout with ${withNames}` : '' });
  const bookQuick = async () => {
    try {
      const ev = (await post('/events', { title: quick.title.trim() || 'Hangout', type: 'hangout', start_at: fromKey(quick.date, quick.start).toISOString(), end_at: fromKey(quick.date, quick.end).toISOString(), participant_ids: withIds, reminder_minutes: 60 })).event;
      setQuick(null);
      toast({ title: 'Booked', body: withIds.length ? 'Invites sent' : 'On your calendar', url: `/event/${ev.id}`, icon: 'check' });
      refresh();
    } catch (e) { toast({ title: 'Could not book it', body: e.message }); }
  };
  const weekLabel = `${weekDays[0].getDate()} ${weekDays[0].toLocaleDateString('en-GB', { month: 'short' })} – ${weekDays[6].getDate()} ${weekDays[6].toLocaleDateString('en-GB', { month: 'short' })}`;

  return (
    <>
      <Header title="Calendar" right={<>
        {away && <button className="today-pill" onClick={goToday}>Today</button>}
        <button className="icon-plain accent" onClick={() => navigate(`/plans/new?date=${sel}`)} aria-label="New plan"><Icon name="plus" size={26} /></button>
      </>} />

      <PlannerBar friends={friends.friends} withIds={withIds} seed={seed} onBooked={(d) => { pick(d); refresh(); }} />
      <WeekBrief brief={brief} onPlan={(t) => setSeed({ text: t, n: Date.now() })} />

      {friends.friends.length > 0 && (
        <div className="free-with" role="group" aria-label="Free with">
          <span className="fw-label">Free with</span>
          {friends.friends.map((f) => (
            <button key={f.id} className={`fw-chip ${withIds.includes(f.id) ? 'on' : ''}`} onClick={() => toggleWith(f.id)} aria-pressed={withIds.includes(f.id)}>
              <Avatar user={f} size={28} /><span>{f.display_name.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="seg round view-seg">
        {[['month', 'Month'], ['week', 'Week']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => { setDir(''); setView(k); if (k === 'week') setWeek(monday(fromKey(sel))); }}>{l}</button>)}
      </div>

      {view === 'month' ? (
        <section className="cal-card" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { swipe.current = null; }}>
          <div className="cal-head">
            <b key={cursor.getTime()} className={`cal-month ${dir}`}>{cursor.toLocaleDateString('en-GB', { month: 'long' })} <span>{cursor.getFullYear()}</span></b>
            <button className="round-btn" onClick={() => month(-1)} aria-label="Previous month"><Icon name="left" size={20} /></button>
            <button className="round-btn" onClick={() => month(1)} aria-label="Next month"><Icon name="right" size={20} /></button>
          </div>
          <div className="cal-dow">{DOW.map((d, i) => <span key={i} className={i > 4 ? 'wknd' : ''}>{d}</span>)}</div>
          <div className={`cal-grid ${dir}`} key={from}>
            {grid.map((d) => {
              const key = dayKey(d);
              const evs = myEvents(key);
              const mineBusy = data.blocks.some((b) => b.user_id === me?.id && b.date === key && b.kind !== 'free');
              const allFree = !withIds.length && users.length > 1 && key >= today && users.every((u) => dayState(u.id, key, data).state === 'free');
              const tog = withIds.length && key >= today ? together(key) : 0;
              const cls = ['cal-day', d.getMonth() !== cursor.getMonth() && 'out', key < today && 'past', key === today && 'today', key === sel && 'sel', evs.length && 'has',
                withIds.length && key >= today && (tog >= 120 ? 'together' : 'apart')].filter(Boolean).join(' ');
              return (
                <button key={key} className={cls} onClick={() => setSel(key)}
                  aria-label={`${fmtLongDay(d)}${evs.length ? `, ${evs.length} plans` : ''}${allFree ? ', everyone free' : ''}${tog >= 120 ? ', free together' : ''}`} aria-pressed={key === sel}>
                  <span className="n">{d.getDate()}</span>
                  <span className="dots">
                    {evs.slice(0, 3).map((e) => <i key={e.id} className={`dot t-${e.type}`} />)}
                    {!evs.length && mineBusy && <i className="dot mine-busy" />}
                    {!evs.length && !mineBusy && allFree && <i className="dot all-free" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="legend">
            <span><i className="dot t-hangout" />Plans</span>
            <span><i className="dot mine-busy" />You're busy</span>
            {withIds.length ? <span><i className="ring-key" />Free with {withNames}</span> : <span><i className="dot all-free" />Everyone free</span>}
          </div>
        </section>
      ) : (
        <section className="cal-card week-card" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { swipe.current = null; }}>
          <div className="cal-head">
            <b key={from} className={`cal-month ${dir}`}>{weekLabel}</b>
            <button className="round-btn" onClick={() => shiftWeek(-1)} aria-label="Previous week"><Icon name="left" size={20} /></button>
            <button className="round-btn" onClick={() => shiftWeek(1)} aria-label="Next week"><Icon name="right" size={20} /></button>
          </div>
          <div className={`week-strip ${dir}`} key={from}>
            {weekDays.map((d, i) => {
              const key = dayKey(d);
              const evs = myEvents(key);
              const tog = withIds.length && key >= today ? together(key) : 0;
              return (
                <button key={key} className={['wk-day', key === sel && 'sel', key === today && 'today', key < today && 'past', tog >= 120 && 'together'].filter(Boolean).join(' ')} onClick={() => setSel(key)} aria-pressed={key === sel}>
                  <small className={i > 4 ? 'wknd' : ''}>{DOW[i]}</small><b>{d.getDate()}</b>
                  <span className="dots">{evs.slice(0, 3).map((e) => <i key={e.id} className={`dot t-${e.type}`} />)}</span>
                </button>
              );
            })}
          </div>
          <div className="tl-head">
            <b>{sel === today ? 'Today' : fmtLongDay(selDate)}</b>
            <small className="muted">{selEvents.length ? `${selEvents.length} plan${selEvents.length > 1 ? 's' : ''}` : 'Nothing planned'}{withIds.length ? ` · ${(free.get(sel) || []).length ? `free with ${withNames}` : `not free with ${withNames}`}` : ''}</small>
          </div>
          <Timeline key={sel} date={sel} events={selEvents} blocks={blocksOn(sel)} windows={withIds.length ? free.get(sel) : null} withNames={withNames}
            onFree={(w) => planFree(sel, w)} onEvent={(e) => navigate(`/event/${e.id}`)} />
          {!withIds.length && <p className="note center">Pick friends under "Free with" to see when you're all free.</p>}
        </section>
      )}

      {view === 'month' && (
        <section className="day-card" key={sel}>
          <div className="day-head">
            <span className="day-badge"><small>{selDate.toLocaleDateString('en-GB', { weekday: 'short' })}</small><b>{selDate.getDate()}</b></span>
            <span className="grow">
              <b>{sel === today ? 'Today' : selDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</b>
              <small className="muted">{[selEvents.length ? `${selEvents.length} plan${selEvents.length > 1 ? 's' : ''}` : 'Nothing planned', users.length > 1 && !withIds.length && `${freeFriends} free${busyFriends ? `, ${busyFriends} busy` : ''}`].filter(Boolean).join(' · ')}</small>
            </span>
            <button className="round-btn accent-btn" onClick={() => navigate(`/plans/new?date=${sel}`)} aria-label="Add a plan on this day"><Icon name="plus" size={20} /></button>
          </div>

          {withIds.length > 0 && sel >= today && (
            (free.get(sel) || []).length ? (
              <div className="together-row">
                {(free.get(sel) || []).slice(0, 3).map(([a, b]) => (
                  <button key={a} className="together-chip" onClick={() => planFree(sel, [a, b])}><Icon name="friends" size={14} />{hhmm(a)}–{hhmm(b)}</button>
                ))}
                <small className="muted">free with {withNames}</small>
              </div>
            ) : <p className="note-inline">You and {withNames} aren't free together this day.</p>
          )}

          {selEvents.map((e) => (
            <button key={e.id} className={`event-card t-${e.type}`} onClick={() => navigate(`/event/${e.id}`)}>
              <span className="event-time"><b>{fmtTime(e.start_at)}</b><small>{fmtTime(e.end_at)}</small></span>
              <span className="grow"><b className="ellipsis">{e.title}</b><small>{TYPE_LABEL[e.type]}{e.location ? ` · ${e.location}` : ''}{e.rsvp && e.rsvp !== 'going' ? ` · you said ${e.rsvp}` : ''}</small></span>
              <Icon name="right" size={18} className="muted" />
            </button>
          ))}

          <button className="planner-card" onClick={() => setSeed({ text: `Plan something ${sel === today ? 'today' : `on ${fmtLongDay(selDate)}`}${withNames ? ` with ${withNames}` : ''}`, n: Date.now() })}>
            <Orb size={40} />
            <span className="grow">
              <b>{selEvents.length ? 'Add something else' : 'Make a plan'}</b>
              <small>{freeFriends ? `${freeFriends} friend${freeFriends > 1 ? 's are' : ' is'} free ${dayWord}. Planner finds the time.` : `Planner finds a time ${dayWord}.`}</small>
            </span>
            <Icon name="spark" size={18} className="accent" />
          </button>
        </section>
      )}

      {users.length > 1 && (
        <section>
          <h2 className="list-label">Who's free {dayWord}</h2>
          <div className="who-row">
            {selRows.filter((r) => !r.u.me).sort((a, b) => (a.state === 'free' ? -1 : 0) - (b.state === 'free' ? -1 : 0)).map(({ u, state, blocks, evs = [] }) => {
              const detail = [...blocks.filter((b) => b.start_time && b.kind !== 'free').map((b) => `${b.kind === 'work' ? 'work' : 'busy'} ${b.start_time}–${b.end_time}`),
                ...evs.map((e) => `busy ${fmtTime(e.start_at)}–${fmtTime(e.end_at)}`)].slice(0, 1).join(', ');
              return (
                <button key={u.id} className={`who-cell ${withIds.includes(u.id) ? 'picked' : ''}`} style={{ '--s': STATE[state].color }} onClick={() => toggleWith(u.id)} aria-pressed={withIds.includes(u.id)}>
                  <span className="ring"><Avatar user={u} size={48} /></span>
                  <b>{u.display_name.split(' ')[0]}</b>
                  <small>{state === 'partial' && detail ? detail : STATE[state].label}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="list-label">You on {sel === today ? 'this day' : selDate.toLocaleDateString('en-GB', { weekday: 'long' })}</h2>
        <div className="seg round">
          {[['free', 'Free'], ['busy', 'Busy'], ['work', 'At work']].map(([k, l]) => (
            <button key={k} className={myAllDay === k ? 'on' : ''} onClick={() => setDay(k)}>{l}</button>
          ))}
        </div>
        {myBlocks.filter((b) => b.start_time).length > 0 && (
          <div className="group-list mt">
            {myBlocks.filter((b) => b.start_time).map((b) => (
              <div key={b.id} className="row-item">
                <span className="time-col mono">{b.start_time}<small>{b.end_time}</small></span>
                <span className="bar" style={{ background: b.kind === 'work' ? 'var(--blue)' : 'var(--danger)' }} />
                <span className="grow"><b>{b.kind === 'work' ? 'Work' : 'Busy'}</b>{b.note && <small>{b.note}</small>}</span>
                <button className="icon-btn sm" onClick={async () => { await del(`/availability/${b.id}`); refresh(); }} aria-label="Remove"><Icon name="x" size={18} /></button>
              </div>
            ))}
          </div>
        )}
        <button className="btn block soft-btn" onClick={() => setBlockOpen(true)}><Icon name="clock" size={18} />Block out a few hours</button>
      </section>

      <Sheet open={!!quick} onClose={() => setQuick(null)} title="Plan in this free time">
        {quick && (
          <div className="form">
            <input autoFocus placeholder="What are you doing?" value={quick.title} onChange={(e) => setQuick({ ...quick, title: e.target.value })} maxLength={120} />
            <div className="grid2">
              <label>From<input type="time" value={quick.start} onChange={(e) => setQuick({ ...quick, start: e.target.value })} /></label>
              <label>Until<input type="time" value={quick.end} onChange={(e) => setQuick({ ...quick, end: e.target.value })} /></label>
            </div>
            <p className="muted small">{fmtLongDay(fromKey(quick.date))}{withNames ? ` · invites ${withNames}` : ''} · reminder an hour before</p>
            <button className="btn primary block big-btn" disabled={!quick.start || !quick.end || quick.end <= quick.start} onClick={bookQuick}>Book it</button>
          </div>
        )}
      </Sheet>

      <Sheet open={blockOpen} onClose={() => setBlockOpen(false)} title="Block out time">
        <div className="form">
          <p className="muted small">Friends see you as busy then. Planner won't book over it.</p>
          <div className="seg">
            {[['busy', 'Busy'], ['work', 'Work']].map(([k, l]) => <button key={k} className={block.kind === k ? 'on' : ''} onClick={() => setBlock({ ...block, kind: k })}>{l}</button>)}
          </div>
          <div className="grid2">
            <label>From<input type="time" value={block.start_time} onChange={(e) => setBlock({ ...block, start_time: e.target.value })} /></label>
            <label>Until<input type="time" value={block.end_time} onChange={(e) => setBlock({ ...block, end_time: e.target.value })} /></label>
          </div>
          <input placeholder="Note, only you see it (optional)" value={block.note} onChange={(e) => setBlock({ ...block, note: e.target.value })} />
          <button className="btn primary block" onClick={addBlock}>Save</button>
        </div>
      </Sheet>
    </>
  );
}
