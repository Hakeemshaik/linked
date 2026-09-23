import './env.js';
import express from 'express';
import { api } from './api.js';

// The API as an Express app. index.js serves it with the built PWA (npm start / Docker);
// api/index.js hands it to Vercel as a function.
export const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// CORS, so the app can be hosted separately from this API.
// CORS_ORIGIN = comma-separated list of allowed sites; empty allows any (fine: auth is a bearer token, not cookies).
const ALLOWED = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const originOk = (o) => !o || !ALLOWED.length || ALLOWED.includes(o);
app.use('/api', (req, res, next) => {
  const o = req.headers.origin;
  if (o && originOk(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(o && !originOk(o) ? 403 : 204);
  next();
});
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', (err, req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'Something went wrong' });
});
