// Lets the Vercel app reach Ollama on this PC without opening Ollama to the whole internet.
// Only requests carrying `Authorization: Bearer <LLM_API_KEY>` get through to Ollama.
//   npm run gate                    (listens on 127.0.0.1:11435)
//   tailscale funnel --bg 11435     (gives you https://<pc>.<tailnet>.ts.net)
// Then on Vercel: LLM_BASE_URL=https://<pc>.<tailnet>.ts.net/v1 and the same LLM_API_KEY.
import '../server/src/env.js';
import http from 'node:http';
import crypto from 'node:crypto';

const KEY = process.env.LLM_API_KEY || '';
const OLLAMA = new URL(process.env.OLLAMA_URL || 'http://127.0.0.1:11434');
const PORT = Number(process.env.GATE_PORT || 11435);

if (KEY.length < 24) {
  console.error('Set LLM_API_KEY in .env to a long random secret first (24+ characters), e.g.');
  console.error(`LLM_API_KEY=${crypto.randomBytes(24).toString('hex')}`);
  process.exit(1);
}
const expected = Buffer.from(`Bearer ${KEY}`);
const allowed = (h = '') => { const got = Buffer.from(h); return got.length === expected.length && crypto.timingSafeEqual(got, expected); };

http.createServer((req, res) => {
  if (!allowed(req.headers.authorization)) { res.writeHead(401).end('unauthorized'); return; }
  if (!req.url.startsWith('/v1/')) { res.writeHead(404).end('not found'); return; }
  const up = http.request({
    hostname: OLLAMA.hostname, port: OLLAMA.port, path: req.url, method: req.method,
    headers: { 'content-type': req.headers['content-type'] || 'application/json' },
  }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Ollama is not running on this PC'); });
  req.pipe(up);
}).listen(PORT, '127.0.0.1', () => console.log(`Ollama gate on http://127.0.0.1:${PORT} -> ${OLLAMA.origin}`));
