# Linkup: project guide for Claude Code

Linkup is a private messenger for a small friend group that plans for you. It's an installable PWA (no app store).
Friends chat, see who's free, and video call. An AI called **Planner** turns chats into booked plans with reminders.
It's hosted on Vercel. Planner runs on the owner's local model (Ollama or LM Studio), which Vercel reaches through `scripts/ollama-gate.js` and a tunnel (Tailscale Funnel or ngrok).

## Hard rules
- Never put any employer or company name anywhere: code, copy, comments, metadata, README, commits.
- No emojis in UI copy. Icons are inline SVG in `web/src/components/ui.jsx` (`<Icon name=… />`): 24x24, stroke 1.8, round caps.
- Don't copy another app's branding (logo, signature colour, wallpaper). The layout is a familiar messenger layout, but the look is our own violet.
- All numbers and times are computed in code. The AI only suggests and never invents data. The server validates every AI plan (`normalizePlan` in `server/src/ai.js`).
- Keep it simple. Every screen should be obvious on first open. Prefer removing a control over adding one.

## Stack and layout
- `server/` is Node 22 and Express on Postgres, plus web-push (VAPID). The server is stateless: anything shared lives in the DB, so it runs as a Vercel function.
  - `app.js` is the Express app. `api/index.js` exports it as the Vercel function. `index.js` serves it with the built PWA for `npm start`.
  - `db.js`: `q`, `one` and `run` with `?` placeholders. `DATABASE_URL` (Neon) uses a pg pool; without it, embedded PGlite in `server/data/`. The schema is created on first request. Timestamps are ISO strings in TEXT columns.
  - `api.js` has every REST route: auth, invite links, friends, availability, events, conversations and messages (reactions, replies, delete), photo and voice uploads (`/media`), typing, plan confirm, invites, call signalling (`/calls/:room/*`, WebRTC mesh, max 6), presence heartbeats, notifications, `/ai/*`, `/cron/reminders`, `/health`.
  - Media: `POST /media?conversation_id=` takes the raw file (JPEG/PNG/WebP/GIF or MP4/WebM/OGG audio, 4 MB max) into the `media` table; `GET /media/:id` serves it with byte ranges (iPhones need them for audio). Ids are 128 random bits, so links can't be guessed. Messages of kind `image`/`voice` carry `data.media`, `data.url`, and `w`/`h`/`thumb` or `duration`/`wave`. Deleting the message deletes the file.
  - Calls: set-up messages are stored in `call_signals` as well as sent live, and `pages/Call.jsx` polls `/calls/:room/sync` while connecting, so a dropped live event can't stall a call. The later joiner (`call_peers.joined_at`) sends the offer. `/calls/ice` hands out STUN plus the TURN relay (Cloudflare, `TURN_API_URL` or a fixed `TURN_URL`) to signed-in people only.
  - `realtime.js`: `emitToUsers` sends over Pusher (a private channel per user). Without `PUSHER_*` it uses a local SSE stream. Payloads over 9KB are parked in the `relay` table. Presence comes from heartbeats (`users.visible`, `last_seen`), so "online" means on screen in the last 70s.
  - `ai.js` has two paths. `converse()` answers messages like a friend in the chat: a persona, the calendar and schedules in the system prompt, the last 18 messages as alternating user/assistant turns, streamed (`stream: true`) with `onText` so `api.js` can emit `ai:stream` events. A booking comes back as a `<plan>{json}</plan>` block at the end, which goes through `normalizePlan`. `visibleText` hides `<think>` reasoning and the plan block while streaming; `cleanReply` turns emoji into the app's `:codes:` and strips markdown. `runAI()` is the JSON-mode path for "Plan it" and the calendar's schedule request. Planner replies run after the response via `background()` (Vercel `waitUntil`).
  - Asking Planner: every message in the Planner chat; elsewhere `@Planner`/`@ai`, "Planner," / "Hey Planner", or a reply to a Planner message (`askedPlanner` in `api.js`). One answer at a time per chat (`claimAI`); a question asked meanwhile waits its turn, and quick messages in the Planner chat get one answer. In other chats the answer quotes the question.
  - `features/account.js` (sessions, link codes, passkeys, password, prefs, storage, delete), `features/chats.js` (per-member chat settings: mute, archive, pin, favourite, theme, marked unread, cleared/hidden; groups; info; search; stars; edits; blocks; lists; broadcasts) and `features/communities.js` are mounted at the end of `api.js` with shared helpers. `account.publicRoutes` (passkey sign-in, `/auth/link/:code`) are mounted before `requireAuth`.
  - Sessions: every JWT carries a `sid` row in `sessions` (device name, last active, revoked). `verifyToken` checks it in the same query as the user. Tokens without a `sid` still work and are swapped by `POST /auth/refresh`. Passkeys use `@simplewebauthn/server` and only work on the address the app is served from.
  - Preferences live in `users.prefs` (JSON, defaults in `PREF_DEFAULTS` in `db.js`, validated by `PREF_RULES` in `account.js`). The server honours them: last seen "nobody" (`presenceOf`), read receipts, which pushes to send, previews, keep chats archived. Look prefs (theme, accent, text size, wallpaper) are applied on the client by `lib/look.js`.
  - Blocking stops DMs and calls both ways (`blockedBetween`). Clearing a chat sets `conversation_members.cleared_at`; every message query filters by it. Deleting a DM hides it until a new message arrives.
  - SQL placeholders: `?` anywhere in a query string becomes a parameter, so never write a literal `?` in SQL (use `ILIKE '%http://%'`, not a regex with `?`).
  - `notify.js` is the one call that stores a notification, emits it live, and sends Web Push with the full content (skipped when the app is on screen).
  - `scheduler.js` sends reminders through `runReminders()`, which is idempotent. Callers: QStash at each reminder time, the daily Vercel Cron, heartbeats, and a 30s timer under `npm start`.
  - Secrets (VAPID keys, JWT secret) come from env, or are generated once and stored in the `kv` table.
- `web/` is React, Vite and react-router, with plain CSS in `web/src/styles.css`. Tokens are at the top. Dark mode is `:root[data-theme='dark']` plus `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`: any new dark-only rule needs both. Accents are `:root[data-accent=…]`, text size `data-text`, wallpaper `data-wallpaper`.
  - Tabs: Chats (`/`), Calendar, Calls, Communities, You (`/you` and `/you/*`: profile, account, devices, privacy, blocked, chats, appearance, notifications, permissions, storage, help, lists, broadcasts, starred). `/settings` redirects to `/you`. Chat info is `/chat/:id/info` (plus `/media` and `/starred`); archived chats are `/archived`; a community is `/community/:id`; `/link/:code` signs a device in.
  - The app shell never scrolls: `body` is fixed, `.app` is `var(--vvh)` tall (the visual viewport, set by `lib/viewport.js`, which also adds `kb-open` while the keyboard is up) and each screen scrolls inside `.page`. Screens other than Chats and the chat are lazy-loaded (`screens` in `main.jsx`) and warmed when the phone is idle. `lib/cache.js` keeps the last profile, friends, chat list and 40 messages per chat so screens open instantly.
  - Settings-style screens use `Cell`, `ToggleCell`, `Choice`, `Confirm` and `FriendPicker` from `components/ui.jsx`. `components/InviteSheet.jsx` has the invite sheet and the `QR` component (qrcode-generator).
  - Notifications on the phone: `lib/push.js` `closeNotifications()` runs whenever the app comes on screen, and the icon badge is set from unread chats (not muted or archived) plus unread alerts; pushes carry the server's `badge` count (`badgeFor` in `notify.js`). Screens mark their alerts read with `markAlerts({ kinds } | { url })`.
  - Planner is a pinned chat (`conversations.is_ai = 1`). `openPlanner(draft)` in `lib/store.jsx` opens it with text ready to send.
  - `lib/realtime.js` connects to Pusher or the SSE stream and exposes `on` and `off`. Everything the client sends goes through the REST API.
  - `public/sw.js` is the service worker: it shows the push content (message pushes from one chat stack), handles action buttons, and caches the offline shell. Its cache name is stamped per build.
  - Updates: `vite.config.js` stamps a version into the app and writes `/version.json`. `lib/update.js` + `components/UpdatePrompt.jsx` show "New version ready" and hand over to the waiting service worker. Updates never activate under an open screen.
  - Island: `.island` is the dark pill at the top centre used for alerts (`Toasts`), the update prompt and the ongoing-call pill. The active call is rendered outside the routes in `main.jsx`, so leaving `/call/:room` minimises it instead of hanging up.
  - Art: profile pictures, emoji (`:id:` in text, see `components/RichText.jsx`), stickers and GIFs live in `public/art/` and are listed in `lib/art.js`. Both are generated by `scripts/art/make.mjs` from `scripts/art/kit.mjs` (the shared character kit) and `sets.mjs`, which also draws the animated scenes in `public/art/scenes/` (CSS animation inside the SVG; used by `<Empty art=…>` and the welcome screen). Never hand-edit the outputs. Messages of kind `sticker`/`gif` carry `data.ref`; `users.avatar` holds a profile picture id.
  - Sound: `lib/sound.js` synthesises the ringtone and ringback. Audio unlocks on the first tap.
  - Chat (`pages/ChatRoom.jsx`): messages show before the server answers. The POST carries a `client_id`, which the server echoes so the stand-in bubble is swapped for the real one; failed sends stay as "Not sent" and retry on tap or when back online. Holding a message opens `MessageMenu` (reactions, Reply, Copy, Delete for everyone); swiping right replies. Reactions live in the `reactions` table (app emoji only, one per person). A reply stores a copy of the quoted message in `data.reply`. Deleting sets `kind = 'deleted'`.
  - Photos and voice: `lib/media.js` shrinks photos (1600px JPEG + a 24px blurred stand-in) and uploads with progress; `components/Photos.jsx` has the send preview and the full-screen viewer; `components/Voice.jsx` has the recorder (MediaRecorder, AAC/MP4 when the browser can, levels from an AnalyserNode), the voice bubble and the recording bar. Uploads happen inside the same optimistic send as text.
  - Calls: the other person's video has `autoPictureInPicture`, there's a PiP button, and `navigator.mediaSession` shows the call with mute and hang-up on the lock screen. A true Dynamic Island Live Activity needs a native app.
  - Notifications: `components/PushPrompt.jsx` asks when the app opens (snoozed for 3 days on "Not now"; on iPhone in Safari it shows the Home Screen steps instead). `components/SetupCard.jsx` is the "Get set up" card on Chats.
- Auth uses JWTs stored in localStorage (`lib/accounts.js` keeps the other accounts on the phone for switching). Invite links are `/join/<code>`: one permanent code per person (`users.invite_code`), always on the production address. Old signed links still work. Signing up or in from one makes both people friends and opens a DM. It also bypasses `REGISTRATION_CODE`.

## Hosting
- Vercel (main): the Root Directory is the repo root. `vercel.json` builds `web/`, routes `/api/*` to `api/index.js` (`iad1`, next to the Neon database in us-east-1; 300s max) and runs a daily cron.
  - Needs `DATABASE_URL` (Neon), `PUSHER_*`, `QSTASH_TOKEN`, `LLM_*` and `REGISTRATION_CODE`, plus a TURN relay for calls on mobile data (`CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`). `/api/health` shows what's connected.
- All-in-one: run `npm start` on a machine behind HTTPS (Tailscale Funnel). It needs no other services.

## Commands
- `npm run setup` installs everything and builds the web app. A plain `npm install` also installs `web/` and `server/` (postinstall), which is what Vercel runs.
- `npm start` serves the API and the built PWA on :8080.
- Dev: run `npm run dev:server` and `npm run dev:web` together (Vite on :5173 proxies `/api`).
- End-to-end check (needs a fresh DB):
  1. Start the server: `DATA_DIR=/tmp/linkup-test REGISTRATION_CODE=test npm start`
  2. Run the test: `REGISTRATION_CODE=test npm run test:e2e`
  3. What it covers: two people sign up (one through the other's invite link), chat live, see typing and read ticks, and sign out and back in.
- To test Planner without Ollama, point `LLM_BASE_URL` at any OpenAI-compatible mock that returns `{"reply": "...", "plan": {...}}` JSON.

## Conventions
- Components are small and live in `web/src/pages/*` and `web/src/components/*`. Reuse `Header`, `Sheet`, `Avatar`, `Orb`, `Icon`, `.group-list` and `.row-item`.
- Motion lives in the "Motion" block at the bottom of `styles.css`. Use `--spring` and `--ease-out`. Every animation must also work under `prefers-reduced-motion`.
- Realtime: the server calls `await emitToUsers(ids, event, payload)`, and clients subscribe with `useSocket(event, fn)`. Client-to-server messages are REST calls, never socket emits.
- Serverless: don't keep state in module variables across requests. Await work before responding, or wrap it in `background()`.
- Calls ring for 45s (`RING_MS` in `api.js`). The caller's screen ends on decline, on no answer, or when everyone else hangs up. Leaving before anyone answers marks the invites missed and stops the ring.
- Any new user-facing event should go through `notify()` so it gets an in-app toast, an Alerts entry and a push.
- Before you say something works, run the e2e test and take screenshots at 390x844 in light and dark.
- A wrong password is 403, not 401: the client signs out on any 401 from an authenticated route.
