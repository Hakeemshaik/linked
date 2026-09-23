# Linkup

A private messenger for you and your friends that plans for you. It installs from a link (no app store) and follows your phone's light or dark mode.

**Tabs**
- **Chats**: DMs and groups with read ticks, typing and online / last seen. **Planner** is pinned at the top. Search and filter by All, Unread or Groups.
- **Calendar**: month view with your plans. Tap a day to see who's free, mark yourself busy or at work, or ask Planner to plan that day.
- **Calls**: quick-call your friends, see call history, missed calls in red, tap to call back.
- Your avatar (top left of Chats) opens **Settings**: your status (Available, Busy, At work, Away, Invisible, plus a short line), friends, all plans, notifications, sign out.

**Getting your friends in**
- Sign up (you need the `REGISTRATION_CODE` you set). In Chats, tap **Share invite link**, or go to Settings, Friends, **Invite link**.
- Your friend opens the link, creates an account (no code needed) and lands straight in a chat with you. You're friends automatically.

**Planning inside chats**
- In any group, tap the orb in the message bar (or **+**, then **Plan it**). Planner reads the chat and posts a plan card. Anyone can tap **Book it**.
- In the **Planner** chat, just say "gym with Sipho friday after work". It picks a time you're both free and sets a reminder (15 min before calls, 30 before meetings, 1 hour before hangouts, 1 day before trips).
- Type **@ai** in any chat to ask Planner something there.
- **+** in a chat also has New plan, Video call and Chill invite.

Stack: React + Vite PWA with a service worker for Web Push, and a Node 22 + Express API. On Vercel the API runs as a function on Postgres (Neon), with live events over Pusher and reminders over QStash. Run locally, the same code uses an embedded database and a built-in live stream, so `npm start` needs nothing else. Web Push uses VAPID, so it needs no Firebase or Apple developer account.

---

## 1. Put it on Vercel

Everything runs on Vercel except the Planner model, which stays on your PC (step 5). You need free accounts at Vercel, Pusher and Upstash. Neon is added from inside Vercel.

1. **Import the repo.** In Vercel, choose **Add New, Project** and import this GitHub repo. Leave **Root Directory** on the repo root, not `web`: the API lives in `api/`. Leave **Framework Preset** on Other, and turn off any Build, Install or Output overrides, because the defaults (`npm install`, `npm run build`) plus `vercel.json` do everything. Don't deploy yet.
2. **Database.** Open the project's **Storage** tab, create a **Neon** Postgres database in **Frankfurt (eu-central-1)**, and connect it to the project. That adds `DATABASE_URL`. The functions run in Frankfurt too (`regions` in `vercel.json`), so they sit next to the database. The tables are created on first request.
3. **Live chat.** At pusher.com, create a **Channels** app in the **eu** cluster. From **App Keys**, add these environment variables in Vercel: `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET` and `PUSHER_CLUSTER=eu`.
4. **Reminders.** At console.upstash.com, open **QStash** and add `QSTASH_TOKEN` in Vercel. Add `QSTASH_URL` too if the console shows one. Each reminder is queued for its exact time, and a daily cron queues the next day's.
5. **Planner on your PC.** Vercel can't run the model, so Planner calls Ollama on your PC through a small gate that only lets your app in:
   ```powershell
   ollama pull qwen2.5:7b          # on a 16GB PC, llama3.2:3b is the fast fallback
   cd linked
   npm --prefix server install
   copy .env.example .env          # set LLM_API_KEY to a long random secret (npm run gate prints one if it's missing)
   npm run gate                    # listens on 127.0.0.1:11435
   tailscale funnel --bg 11435     # -> https://<your-pc>.<tailnet>.ts.net
   ```
   In Vercel, add `LLM_BASE_URL=https://<your-pc>.<tailnet>.ts.net/v1`, `LLM_MODEL=qwen2.5:7b` and the same `LLM_API_KEY`. When the PC is off, everything still works except Planner, which says it's offline.
6. **Sign-up code.** Add `REGISTRATION_CODE` in Vercel. People need it to sign up without an invite link.
7. **Deploy.** Vercel deploys production from the repo's default branch, so merge this code into it, or set **Settings, Environments, Production, Branch** to the branch you want live. Reminders call back to the production address, so production has to be live. Then open `https://<your-app>.vercel.app/api/health`. It should show `postgres: ok`, `realtime: pusher` and `qstash + daily sweep`.

The first visit creates the push keys and the login secret and stores them in the database. Don't delete the `kv` table: if the push keys change, everyone has to turn notifications on again.

On a CPU-only PC, expect Planner to take 10–40s per reply. The chat shows a typing bubble while it waits. A Vercel function stops after 5 minutes, so Planner gives up after 280s there.

## 2. Or run it all on your PC

```powershell
cd linked
copy .env.example .env      # set REGISTRATION_CODE and LLM_MODEL
npm run setup               # installs everything and builds the app
npm start                   # http://localhost:8080
```

Or use Docker: `docker compose up -d --build`. Ollama then has to listen on all interfaces: set the Windows env var `OLLAMA_HOST=0.0.0.0` and restart Ollama. Compose already points the app at `host.docker.internal:11434`.

Phones need HTTPS, so share it with `tailscale funnel --bg 8080`. The PC has to stay on. Data lives in `server/data/` (or the `linkup-data` Docker volume). Back that folder up.

## 3. Install on phones

**iPhone (iOS 16.4+)**: open the link in **Safari**, tap Share, then **Add to Home Screen**. Open Linkup from the home screen, sign up, then go to **Settings, Notifications** and tap **Turn on**. On iPhone, push only works from the home-screen app, not from a Safari tab.

**Android**: open the link in **Chrome**, tap **Install app** (or ⋮, then Add to Home screen). Then go to **Settings, Notifications** and tap **Turn on**.

Tap **Send test** there to confirm, then lock the phone and check the notification shows up.

Easiest: share your invite link (Chats, Share invite link). Friends who open it sign up without a code and are connected to you straight away. People can also sign up with the `REGISTRATION_CODE` and add each other by username in **Settings, Friends**.

## 4. Video calls on mobile data

Calls connect peer-to-peer. That works on most Wi-Fi, but some mobile networks block direct connections, and then the call gets stuck on "connecting". To fix that, add a TURN relay in the environment variables (`TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`). You can use a hosted TURN service, or self-host `coturn` on a VPS with UDP 3478 open.

---

## Project layout

```
api/index.js    the Vercel function: hands every /api request to the Express app
server/src/
  app.js        Express app: CORS, the /api router, errors
  index.js      npm start: app + built PWA + reminder timer on one port
  api.js        REST API: auth, friends, availability, events, chat, invites, calls signalling, presence, notifications
  db.js         Postgres: Neon via DATABASE_URL, or embedded PGlite in server/data/
  realtime.js   live events: Pusher, or an SSE stream when running locally; presence from heartbeats
  ai.js         Planner: builds context (calendar, schedules, chat) -> LLM -> plan JSON
  notify.js     one call = stored alert + live event + Web Push with full content
  push.js       VAPID / web-push, drops dead subscriptions
  scheduler.js  reminders: QStash + daily cron on Vercel, a 30s timer locally
scripts/ollama-gate.js  lets the Vercel app reach Ollama on your PC with a secret
web/
  public/sw.js  service worker: shows push content, action buttons, offline shell
  src/pages/    Chats, ChatRoom, Calendar, Calls, Settings, Friends, Plans, Event, Alerts, Call, Invite
```

Test that two people can sign up and chat: start a fresh server (`DATA_DIR=/tmp/linkup-test REGISTRATION_CODE=test npm start`), then run `REGISTRATION_CODE=test npm run test:e2e`. To use an already-installed Chromium instead of the Playwright download, set `CHROMIUM_PATH=/path/to/chrome`. Point `APP_URL` at a deployment to run the same test there.

Dev mode: run `npm run dev:server` and `npm run dev:web` in two terminals. Vite on :5173 proxies `/api` to :8080.
