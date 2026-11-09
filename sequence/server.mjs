/** Live-only OpenCode UML sequence viewer. Node 22+, no npm install needed. */
import { createServer } from 'node:http';
import { readFile, readdir, stat, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { parseTraceHtml } from './model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.SEQUENCE_PORT || 4177);
const traceDir = process.env.OPENCODE_TRACE_DIR || path.join(os.homedir(), 'opencode-trace');
const maxFileBytes = 64 * 1024 * 1024;
const recentMs = 120000; // Do not mistake old, archived traces for an active session.
const clients = new Set();
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

function send(sub, value) {
  if (!sub.res.destroyed) sub.res.write(`data: ${JSON.stringify(value)}\n\n`);
}
async function latestTrace() {
  let files;
  try { files = await readdir(traceDir); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const matches = await Promise.all(files.filter(n => n.endsWith('.html')).map(async name => {
    const file = path.join(traceDir, name);
    const st = await stat(file).catch(() => null);
    return st?.isFile() ? { file, name, size: st.size, mtime: st.mtimeMs } : null;
  }));
  return matches.filter(Boolean).sort((a, b) => b.mtime - a.mtime)[0] ?? null;
}

function parseNewLines(sub, text) {
  const full = sub.tail + text;
  const lines = full.split(/\r?\n/);
  sub.tail = lines.pop() ?? '';
  const entries = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const lineNo = sub.lineNo++;
    try {
      const row = JSON.parse(l);
      if (row && typeof row === 'object' && typeof row._kind === 'string') {
        entries.push({ lineNo, row });
        if (row._session) sub.sessionId = row._session;
      }
    } catch {
      send(sub, { type: 'warning', message: 'Eine unlesbare Trace-Zeile wurde übersprungen.' });
    }
  }
  return entries;
}
async function readAppended(sub, st) {
  if (st.size <= sub.offset) return;
  if (st.size > maxFileBytes) {
    if (!sub.tooLarge) send(sub, { type: 'warning', message: 'Trace über 64 MB. Bitte OPENCODE_TRACE_MAX_MB begrenzen bzw. eine neue Session beginnen.' });
    sub.tooLarge = true;
    return;
  }
  const fd = await open(st.file, 'r');
  let chunk;
  try {
    const size = st.size - sub.offset;
    chunk = Buffer.alloc(size);
    const { bytesRead } = await fd.read(chunk, 0, size, sub.offset);
    chunk = chunk.subarray(0, bytesRead);
  } finally { await fd.close(); }
  sub.offset += chunk.length;
  if (!chunk.length) return;
  const entries = parseNewLines(sub, sub.decoder.write(chunk));
  // UTF-8 split across reads: uncommon, but FileReader/Buffer conversion can replace a split codepoint.
  // Full original JSON remains accessible in the stored trace; the live viewer never modifies it.
  for (let i = 0; i < entries.length; i += 20) {
    send(sub, { type: 'rows', source: sub.name, sessionId: sub.sessionId, entries: entries.slice(i, i + 20) });
  }
}
async function attach(sub, info) {
  if (info.size > maxFileBytes) {
    send(sub, { type: 'warning', message: 'Aktueller Trace überschreitet die Viewer-Grenze von 64 MB.' });
    return;
  }
  const content = await readFile(info.file);
  const full = content.toString('utf8');
  const marker = '\n<!--\n';
  const start = full.lastIndexOf(marker);
  if (start < 0) return; // File preamble is still being created.
  const body = full.slice(start + marker.length);
  const endOfLastLine = body.lastIndexOf('\n');
  const { rows, ready } = parseTraceHtml(full.slice(0, start + marker.length) + (endOfLastLine >= 0 ? body.slice(0, endOfLastLine + 1) : ''));
  if (!ready) return;
  sub.file = info.file;
  sub.name = info.name;
  sub.offset = content.length;
  sub.tail = endOfLastLine >= 0 ? body.slice(endOfLastLine + 1) : body;
  sub.decoder = new StringDecoder('utf8');
  sub.lineNo = rows.length;
  sub.sessionId = rows.find(r => typeof r._session === 'string')?._session || null;
  sub.tooLarge = false;
  send(sub, { type: 'source', source: info.name, sessionId: sub.sessionId, modifiedAt: info.mtime });
  // Initial live attachment shows the recent in-progress conversation (never bundled examples).
  for (let i = 0; i < rows.length; i += 20) {
    send(sub, { type: 'rows', source: info.name, sessionId: sub.sessionId, entries: rows.slice(i, i + 20).map((row, x) => ({ lineNo: i + x, row })) });
  }
}
let polling = false;
async function poll() {
  if (polling || !clients.size) return;
  polling = true;
  try {
    const latest = await latestTrace();
    for (const sub of [...clients]) {
      if (sub.res.destroyed) { clients.delete(sub); continue; }
      try {
        if (!latest) {
          if (!sub.file && !sub.waiting) send(sub, { type: 'waiting', message: 'Noch kein OpenCode-Trace gefunden.' });
          sub.waiting = true;
          continue;
        }
        if (!sub.file && Date.now() - latest.mtime > recentMs) {
          if (!sub.waiting) send(sub, { type: 'waiting', message: 'Nur ältere Traces gefunden. Bitte eine neue OpenCode-Aufgabe starten.' });
          sub.waiting = true;
          continue;
        }
        if (latest.file !== sub.file && (Date.now() - latest.mtime <= recentMs) && (!sub.file || latest.mtime > sub.lastSelectedMtime)) {
          await attach(sub, latest);
          sub.lastSelectedMtime = latest.mtime;
          sub.waiting = false;
        } else if (sub.file) {
          const currentStat = await stat(sub.file).catch(() => null);
          if (!currentStat) { sub.file = null; continue; }
          if (currentStat.size < sub.offset) { sub.file = null; continue; }
          await readAppended(sub, { ...latest, file: sub.file, size: currentStat.size });
          sub.lastSelectedMtime = Math.max(sub.lastSelectedMtime || 0, currentStat.mtimeMs);
        }
      } catch (e) { send(sub, { type: 'warning', message: `Trace nicht lesbar: ${e.message}` }); }
    }
  } finally { polling = false; }
}
const interval = setInterval(() => { void poll().catch(e => console.error('Live-Poll:', e.message)); }, 750);
interval.unref();

const server = createServer(async (req, res) => {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (!allowedHosts.includes(req.headers.host)) { res.writeHead(403); res.end('Host nicht erlaubt'); return; }
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { res.writeHead(403); res.end(); return; }
    if (origin.protocol !== 'http:' || !allowedHosts.includes(origin.host)) { res.writeHead(403); res.end('Origin nicht erlaubt'); return; }
  }
  const url = new URL(req.url ?? '/', `http://${host}:${port}`);
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': Live stream opened\n\n');
    const sub = { res, file: null, name: null, sessionId: null, offset: 0, tail: '', decoder: new StringDecoder('utf8'), lineNo: 0, lastSelectedMtime: 0, waiting: false, tooLarge: false };
    clients.add(sub);
    req.on('close', () => clients.delete(sub));
    void poll().catch(e => send(sub, { type: 'warning', message: e.message }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/status') {
    const trace = await latestTrace();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ directory: traceDir, latest: trace ? { name: trace.name, modifiedAt: new Date(trace.mtime).toISOString(), fresh: Date.now() - trace.mtime <= recentMs } : null }));
    return;
  }
  const staticPaths = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/model.mjs': 'model.mjs' };
  if (req.method === 'GET' && Object.hasOwn(staticPaths, url.pathname)) {
    try {
      const filename = path.join(here, staticPaths[url.pathname]);
      const data = await readFile(filename);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filename)], 'Cache-Control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Nicht gefunden'); }
    return;
  }
  res.writeHead(404); res.end('Nicht gefunden');
});
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  server.listen(port, host, () => {
    console.log(`\nOpenCode Sequence Trace: http://${host}:${port}`);
    console.log(`Beobachte: ${traceDir}/*.html`);
    console.log('Nur Live-Ansicht. Clear leert die Darstellung, nicht die Datei. Strg+C beendet.\n');
  });
  server.on('error', e => { console.error(e.message); process.exitCode = 1; });
}
export { server, latestTrace, traceDir };
