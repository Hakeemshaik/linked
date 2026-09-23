import { SERVER_DIR } from './env.js';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { app } from './app.js';
import { ready } from './db.js';
import { startScheduler } from './scheduler.js';
import { aiInfo } from './ai.js';
import { realtimeKind } from './realtime.js';

// Long-running server: the API, live events over SSE, the reminder timer and the built PWA on one port.
const PORT = Number(process.env.PORT || 8080);

const WEB = process.env.WEB_DIST || path.join(SERVER_DIR, '..', 'web', 'dist');
if (fs.existsSync(WEB)) {
  app.use(express.static(WEB, {
    setHeaders: (res, file) => {
      if (file.endsWith('sw.js') || file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(WEB, 'index.html')));
}

await ready();
if (!process.env.VERCEL) startScheduler(); // VERCEL set = emulating Vercel locally: reminders come from QStash/cron only

app.listen(PORT, () => {
  console.log(`Linkup running on http://localhost:${PORT}`);
  console.log(`Live events: ${realtimeKind} · AI: ${aiInfo.model} @ ${aiInfo.base}`);
});
