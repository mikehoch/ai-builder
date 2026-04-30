/**
 * Local dev server — mirrors the Vercel production layout:
 *   GET  /api/roadmap   → query Notion DB, return cards as JSON
 *   PATCH /api/roadmap  → update Status of one row by ID
 *   GET  /              → serve ai-builder-dashboard.html
 *   GET  /*             → serve static files from project root
 *
 * Reads NOTION_TOKEN and NOTION_DATABASE_ID from .env.local
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');

/* ── Load .env.local ── */
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key && !key.startsWith('#')) process.env[key] = val;
    }
  });
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID  = process.env.NOTION_DATABASE_ID;
const PORT   = process.env.PORT || 3000;
const ROOT   = __dirname;

const VALID_STATUSES = new Set(['Suggested', 'To Build', 'In Progress', 'Done']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

/* ── Notion helpers (mirrors api/roadmap.js) ── */
function toCard(page) {
  const p = page.properties;
  return {
    id:          page.id,
    name:        p.Name?.title?.[0]?.plain_text        ?? '',
    status:      p.Status?.select?.name                ?? 'To Build',
    priority:    p.Priority?.select?.name              ?? null,
    description: p.Description?.rich_text?.[0]?.plain_text ?? '',
    submittedBy: p['Submitted by']?.rich_text?.[0]?.plain_text ?? null,
    submittedAt: p['Submitted at']?.date?.start        ?? null,
  };
}

async function getAllCards() {
  const pages = [];
  let cursor;
  do {
    const resp = await notion.databases.query({
      database_id: DB_ID, start_cursor: cursor, page_size: 100,
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return pages.map(toCard);
}

/* ── Request body reader ── */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/* ── JSON helpers ── */
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

/* ── Static file helper ── */
function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(filePath);
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

/* ── Server ── */
const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const pathname = url.split('?')[0];

  /* API routes */
  if (pathname === '/api/roadmap') {
    if (method === 'GET') {
      try   { json(res, 200, await getAllCards()); }
      catch (e) { console.error(e); json(res, 500, { error: e.message }); }
      return;
    }
    if (method === 'PATCH') {
      try {
        const body = JSON.parse(await readBody(req));
        const { id, status } = body;
        if (!id || !status)              { json(res, 400, { error: 'id and status required' }); return; }
        if (!VALID_STATUSES.has(status)) { json(res, 400, { error: 'invalid status' }); return; }
        await notion.pages.update({ page_id: id, properties: { Status: { select: { name: status } } } });
        json(res, 200, { ok: true });
      } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
      return;
    }
    res.writeHead(405); res.end();
    return;
  }

  /* Static files */
  if (pathname === '/') { serveFile(res, path.join(ROOT, 'ai-builder-dashboard.html')); return; }
  const filePath = path.join(ROOT, pathname.replace(/^\//, ''));
  /* Prevent path traversal */
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`\n  AI Builder Dashboard`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  API:    http://localhost:${PORT}/api/roadmap`);
  console.log(`  DB:     ${DB_ID}`);
  console.log(`\n  Ctrl+C to stop\n`);
});
