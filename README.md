# Linkup

A private messenger for you and your friends that plans for you. It installs from a link (no app store), feels like a native app (the screen stays put when the keyboard opens), and follows your phone's light or dark mode, or the look you pick.

**Tabs**
- **Chats**: DMs and groups with read ticks, typing and online / last seen. **Planner** is pinned at the top. Search, and filter by All, Unread, Favourites, Groups or your own lists. The bell shows new notifications.
- **Calendar**: the **Planner bar** at the top ("padel with Sipho on Saturday") finds real times when everyone's free and books one with a tap. **This week** shows what's next, how full the week is and the evening most friends are free. Pick friends under **Free with** to ring the days you're all free. **Month** view (swipe to change month) or **Week** view with a timeline of the day: tap a green free window to plan straight into it.
- **Calls**: quick-call your friends, see call history, missed calls in red, tap to call back.
- **Communities**: several groups under one roof, plus an **Announcements** chat everyone in it gets. Add people, start groups, join the ones you want.
- **You**: your profile, status and QR code, and every setting (below).

**Chat list**
- Swipe a chat left for **Archive** (a long swipe archives straight away, with Undo) and **More**; swipe right to mark it read or unread.
- Hold a chat to **pin** it (up to 3 stay on top), mute it (8 hours, a week, always), add it to **Favourites** or a list, archive, clear or delete it.
- Archived chats sit under **Archived** at the top of the list.

**Chatting**
- Messages appear the moment you tap send, with a clock until they're delivered. Without signal they stay marked **Not sent** and go out when you tap them or the phone is back online.
- **Photos**, **documents** (PDF, Word, Excel, slides, text, zip, up to 4 MB) and **voice messages**. Links in messages open in the browser.
- Hold a message (it never selects text) to react, **Reply**, **Edit** (your own, for 15 minutes; it shows "edited"), **Star**, **Copy**, or **Delete for everyone**. Swipe a message right to reply. Tap a quote to jump to the original, even if it's far back.
- The message box grows as you type. Enter sends (turn that off in You, Chats, then Enter makes a new line).
- Tap the **name at the top** for contact or group info: media, links and docs, starred messages, search in the chat, notifications (mute), chat theme, groups in common, add to favourites or a list, archive, clear chat, block, and delete chat or exit group. Group admins can rename the group, add a description and picture, and add or remove people.

**You tab**
- **Starred**, **Lists** (your own chat filters), **Broadcast messages** (one message to several friends, each in their own chat with you), **Linked devices** (see where you're signed in, log out others, link a new device with a QR code that works once for 10 minutes).
- **Account**: passkeys (sign in with Face ID, Touch ID or the screen lock), change password (signs out your other devices), add another account and switch between them, sign out, delete your account.
- **Privacy**: last seen and online (Everyone or Nobody), read receipts, blocked people. **Chats**: wallpaper, enter to send, keep chats archived, archive or clear all. **Appearance**: automatic, light or dark, five colours, message text size.
- **Notifications**: turn on for this phone, send a test, choose messages, groups, reactions and reminders, and whether previews show what was said. **Camera and microphone**: allow them before your first call, or the exact steps to switch them back on if they were blocked. **Storage**, **Help**.

**Notifications**
- A phone only gets notifications once they're turned on there. You, Notifications lists friends who have them off: **Nudge** one or all (a card in your chat with them, and their app asks the moment they next open it), or send a reminder link by WhatsApp or text. Contact info shows it too.
- In-app banners drop in under the top bar, so back and the header buttons always work. Flick one up or sideways to dismiss it.
- Opening Linkup clears its notifications off the lock screen, and the number on the app icon is only what's still unread (muted and archived chats don't count).
- Opening a chat clears that chat's alerts; the Calls tab clears missed calls; a plan's page clears its invites; opening the Notifications screen clears the rest. **Clear** empties it.
- Chat notifications are titled with the person (or group) and show their picture where the phone allows it.

**Getting your friends in**
- Sign up (you need the `REGISTRATION_CODE` you set). Then **Invite friends** (Chats, or You, Invite, or the QR code button): your QR code to scan with any camera, **Share invite link**, copy the link or your username, or add someone by their username.
- Your friend opens the link, creates an account (no code needed) and lands straight in a chat with you. You're friends automatically.

**Planner**
- If the computer running Planner is off, it says exactly that (for example "the tunnel to the model is offline"). Add a backup model with `LLM_FALLBACK_BASE_URL`, `LLM_FALLBACK_MODEL` and `LLM_FALLBACK_API_KEY` (any OpenAI-compatible API) and it answers from there instead.
- Ask it anything in the **Planner** chat: ideas, facts, advice, a message to write, a joke, how to do something in the app. It remembers the conversation, answers in the language you write in, and its answer appears as it's being written.
- It knows your upcoming plans, your friends' status and who's free. Say "gym with Sipho friday after work" and it books it: it picks a time you're both free and sets a reminder (15 min before calls, 30 before meetings, 1 hour before hangouts, 1 day before trips).
- "@Planner catch me up" in a busy chat reads far back and sums up what you missed.
- In any other chat, ask it in front of everyone: start a message with **@Planner** (or "Planner," / "Hey Planner"), or type your question and tap the orb. Reply to one of its messages to keep talking to it, or hold any message and tap **Ask Planner**. Its answer quotes the question.
- With nothing typed, the orb (or **+**, then **Plan it**) reads the chat and posts a plan card. Anyone can tap **Book it**.

**Make it yours**
- A friendly logo, 20 profile pictures (pick yours when you sign up), group and community pictures, and the app's own emoji, stickers and GIFs.
- Changing the theme or colour spreads out smoothly from where you tapped. Chat themes show a live preview.
- All the art is generated by `node scripts/art/make.mjs` (set `CHROMIUM_PATH` to use an installed Chromium). The logo is `web/public/brand/logo.svg`; the icons in `web/public/icons/` are rendered from it.

**Calls**
- A call rings for 45 seconds. While it rings, the notification is sent again every 6 seconds, so a locked phone keeps alerting.
- Leaving the call screen keeps the call going as a small pill at the top, with a live timer. Leaving the app keeps it going too: where the phone supports it the other person's video floats in picture-in-picture (there's also a button for it), and the lock screen's media controls show who you're with, with mute and hang up.
- In a video call, tap your small video to swap it with theirs, and drag it to any corner.
- A call that can't connect (or loses its connection) says so, "Couldn't connect. Network error", and goes back to the app by itself.
- Calls on mobile data need a relay: see section 4.
- What a home-screen web app can't do: put a call on the iPhone's Dynamic Island as a Live Activity or use the real call screen (those need a native iOS app), switch on the camera or microphone by itself (the phone always asks first), or play a custom ringtone while the phone is locked.

**Updates**
- After you deploy, open apps show **New version ready** with an **Update** button. Tapping it reloads into the new version. You, Help shows the version you're on.

Stack: React + Vite PWA with a service worker for Web Push, and a Node 22 + Express API. On Vercel the API runs as a function on Postgres (Neon), with live events over Pusher and reminders over QStash. Run locally, the same code uses an embedded database and a built-in live stream, so `npm start` needs nothing else. Web Push uses VAPID, so it needs no Firebase or Apple developer account.

---

## 1. Put it on Vercel

Everything runs on Vercel except the Planner model, which stays on your PC (step 5). You need free accounts at Vercel, Pusher and Upstash. Neon is added from inside Vercel.

1. **Import the repo.** In Vercel, choose **Add New, Project** and import this GitHub repo. Leave **Root Directory** on the repo root, not `web`: the API lives in `api/`. Leave **Framework Preset** on Other, and turn off any Build, Install or Output overrides, because the defaults (`npm install`, `npm run build`) plus `vercel.json` do everything. Don't deploy yet.
2. **Database.** Open the project's **Storage** tab, create a **Neon** Postgres database in **US East (us-east-1)**, the default, and connect it to the project. That adds `DATABASE_URL`. The functions run in Washington, D.C. (`"regions": ["iad1"]` in `vercel.json`), next to the database. If you pick another database region, change `regions` to match it (for example Frankfurt `eu-central-1` needs `fra1`); otherwise every query crosses an ocean. The tables are created on first request.
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

   **LM Studio or ngrok instead:** LM Studio listens on port 1234, so also set `OLLAMA_URL=http://127.0.0.1:1234` in `.env` before `npm run gate`. With ngrok, run `ngrok http 11435` and use its `https://…ngrok-free.dev/v1` address. Always tunnel the gate (port 11435), never the model's own port: otherwise anyone who finds the address can use your model. `LLM_MODEL` must be the model name LM Studio shows (for example `qwen2.5-7b-instruct`).
6. **Sign-up code.** Add `REGISTRATION_CODE` in Vercel. People need it to sign up without an invite link.
7. **Deploy.** Vercel deploys production from the repo's default branch, so merge this code into it, or set **Settings, Environments, Production, Branch** to the branch you want live. Reminders call back to the production address, so production has to be live. Then open `https://<your-app>.vercel.app/api/health`. It should show `postgres: ok`, `realtime: pusher` and `qstash + daily sweep`.
8. **Calls on mobile data.** Add a TURN relay (section 4). Without one, calls only connect when both phones allow direct connections.

The first visit creates the push keys and the login secret and stores them in the database. Don't delete the `kv` table: if the push keys change, everyone has to turn notifications on again.

Photos and voice messages are stored in the database too (a photo is usually 100-300 KB, a minute of voice about 250 KB). Neon's free plan holds 0.5 GB, which is a few thousand photos. `/api/health` shows how much is used.

Planner's answers appear word by word when the model server streams (LM Studio and Ollama both do, through the gate or ngrok).

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

**iPhone (iOS 16.4+)**: open the link in **Safari**, tap Share, then **Add to Home Screen**. Open Linkup from the home screen and sign up. On iPhone, push only works from the home-screen app, not from a Safari tab (in Safari, the app shows these steps instead).

**Android**: open the link in **Chrome**, tap **Install app** (or ⋮, then Add to Home screen).

When the app opens, it asks to turn on notifications: tap **Turn on notifications**, then **Allow**. If you tap **Not now**, it asks again in a few days, and you can always do it in **You, Notifications**. The **Get set up** card on Chats shows what's left (profile picture, notifications, inviting a friend).

Tap **Send a test** in You, Notifications to confirm, then lock the phone and check the notification shows up.

Easiest: share your invite link or QR code (You, Invite). Friends who open it sign up without a code and are connected to you straight away. People can also sign up with the `REGISTRATION_CODE` and add each other by username (You, Invite, Add by username).

## 4. Video calls on mobile data

Calls go straight from phone to phone. On most Wi-Fi that just works, but many mobile networks block direct connections, and then a call sits on "Connecting…". A TURN relay fixes that by passing the call through a server when a direct connection fails. Until one is set, `/api/health` shows `calls: direct only`.

**Cloudflare (free tier):**
1. In the Cloudflare dashboard, open **Realtime**, then **TURN Server**, and create a TURN key.
2. In Vercel, add `CLOUDFLARE_TURN_KEY_ID` (the key's ID) and `CLOUDFLARE_TURN_API_TOKEN` (its API token).
3. Redeploy, then open `/api/health`: it should show `calls: relay: cloudflare`.

The server asks Cloudflare for short-lived relay logins and only gives them to signed-in people when a call starts, so the token never reaches a phone.

**Other options:** a provider with a URL that returns ICE servers as JSON (for example Metered): set `TURN_API_URL`. Or a fixed TURN server, such as your own `coturn` on a VPS with UDP 3478 open: set `TURN_URL`, `TURN_USERNAME` and `TURN_PASSWORD`.

Calls also survive a dropped live event: set-up messages are kept on the server and the call screen fetches any it missed, so a call can't hang on "is joining".

---

## Project layout

```
api/index.js    the Vercel function: hands every /api request to the Express app
server/src/
  app.js        Express app: CORS, the /api router, errors
  index.js      npm start: app + built PWA + reminder timer on one port
  api.js        REST API: auth, friends, availability, events, chat, invites, calls signalling, presence, notifications
  features/     account.js (devices, link codes, passkeys, password, preferences, delete),
                chats.js (per-chat settings, clear/hide, groups, info, search, stars, edits, blocks, lists, broadcasts),
                communities.js, nudges.js (turn-on-notifications nudges),
                calendar.js (free-together windows, weekly brief, the Planner bar's suggestions)
  db.js         Postgres: Neon via DATABASE_URL, or embedded PGlite in server/data/
  realtime.js   live events: Pusher, or an SSE stream when running locally; presence from heartbeats
  ai.js         Planner: builds context (calendar, schedules, chat) -> LLM -> plan JSON
  notify.js     one call = stored alert + live event + Web Push with full content
  push.js       VAPID / web-push, drops dead subscriptions
  scheduler.js  reminders: QStash + daily cron on Vercel, a 30s timer locally
scripts/ollama-gate.js  lets the Vercel app reach Ollama on your PC with a secret
web/
  public/sw.js  service worker: shows push content, action buttons, offline shell
  public/brand/ the logo (icons are rendered from it)
  src/pages/    Chats, ChatRoom, ChatInfo, Calendar, Calls, Communities, You (+ YouSettings, YouAccount, YouCollections),
                Friends, Plans, Event, Alerts, Call, Invite
```

Test that two people can sign up and chat: start a fresh server (`DATA_DIR=/tmp/linkup-test REGISTRATION_CODE=test npm start`), then run `REGISTRATION_CODE=test npm run test:e2e`. To use an already-installed Chromium instead of the Playwright download, set `CHROMIUM_PATH=/path/to/chrome`. Point `APP_URL` at a deployment to run the same test there.

Dev mode: run `npm run dev:server` and `npm run dev:web` in two terminals. Vite on :5173 proxies `/api` to :8080.
