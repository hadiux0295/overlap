// Web server: static UI, saved examples, live runs streamed as NDJSON, and the MCP endpoint.
// Binds to localhost only; the public reaches it through a tunnel.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './env.mjs';
import { run } from './pipeline.mjs';
import { admit, release, clientIp, status, publicResult, clean } from './guard.mjs';
import { createMcp } from './mcp.mjs';
import { WRITER_MODEL, FAST_MODEL } from './llm.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const EX = process.env.EXAMPLES_DIR || path.join(ROOT, 'examples');
const PORT = Number(process.env.PORT || 8743), HOST = process.env.HOST || '127.0.0.1';
const TYPES = ['brand', 'place', 'person', 'podcast'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://images.qloo.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
};

const examples = () => {
  try { return JSON.parse(fs.readFileSync(path.join(EX, 'index.json'), 'utf8')); } catch { return []; }
};


function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, ...SECURITY, 'Cache-Control': 'no-store, no-transform' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req, max = 4096) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > max) throw new Error('too large'); }
  return JSON.parse(body || '{}');
}

const mcp = createMcp();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/mcp') return await mcp(req, res);
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, ...status(), models: { plan: WRITER_MODEL, research: FAST_MODEL } });
    if (req.method === 'GET' && url.pathname === '/api/examples') return send(res, 200, examples());
    const ex = url.pathname.match(/^\/api\/example\/([a-z0-9-]{1,60})$/);
    if (req.method === 'GET' && ex) {
      const f = path.join(EX, `${ex[1]}.json`);
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f)) : send(res, 404, { error: 'no such example' });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      let b;
      try { b = await readJson(req); } catch { return send(res, 400, { error: 'bad request' }); }
      const brief = {
        name: clean(b.name, 80), type: TYPES.includes(b.type) ? b.type : 'brand', city: clean(b.city, 60) || undefined,
        text: clean(b.brief, 400) || undefined, refs: (Array.isArray(b.refs) ? b.refs : []).map((x) => clean(x, 60)).filter(Boolean).slice(0, 2),
      };
      if (!brief.name) return send(res, 400, { error: 'Enter a business, venue or creator name.' });
      const no = admit(clientIp(req));
      if (no) return send(res, no.status, { error: no.reason });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', ...SECURITY, 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
      const line = (o) => res.write(JSON.stringify(o) + '\n');
      try {
        const r = await run(brief, { emit: (e) => line({ event: e }) });
        line({ result: publicResult(r) });
      } catch (e) {
        console.error('run failed:', e.message);
        line({ result: { ok: false, error: 'The agent hit an error on our side. Try again, or open an example.' } });
      } finally { release(); res.end(); }
      return;
    }
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const f = path.join(PUB, path.normalize(rel));
      if (f.startsWith(PUB + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', ...SECURITY, 'Cache-Control': 'public, max-age=300, no-transform' });
        return fs.createReadStream(f).pipe(res);
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('server error:', e.message);
    if (!res.headersSent) send(res, 500, { error: 'server error' }); else res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`audience agent on http://${HOST}:${PORT}`));
