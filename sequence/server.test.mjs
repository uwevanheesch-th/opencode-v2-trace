import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Launch a real server and produce actual append-only HTML trace rows.
test('live SSE streams an existing recent request and a newly appended response, does not serve arbitrary paths', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sequence-trace-test-'));
  const port = 51000 + Math.floor(Math.random() * 6000);
  const child = spawn(process.execPath, [path.join(here, 'server.mjs')], { env: { ...process.env, OPENCODE_TRACE_DIR: dir, SEQUENCE_PORT: String(port) }, stdio: 'pipe' });
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { const res = await fetch(`${base}/status`); if (res.ok) { ready = true; break; } } catch {}
      await sleep(80);
    }
    assert.equal(ready, true, 'server booted');
    const forbidden = await fetch(`${base}/../../package.json`);
    assert.equal(forbidden.status, 404);
    const stream = await fetch(`${base}/events`);
    assert.equal(stream.status, 200);
    const f = path.join(dir, 'session.html');
    await writeFile(f, '<html></html>\n<!--\n{"_kind":"request","_id":1,"_session":"ses-test","instructions":"SYSTEM"}\n');
    await sleep(1200);
    await appendFile(f, '{"_kind":"response","_id":1,"_session":"ses-test","output":"OK"}\n');
    const reader = stream.body.getReader(); const decoder = new TextDecoder();
    let data = ''; const end = Date.now() + 5500;
    while (Date.now() < end && !data.includes('"_kind":"response"')) {
      const next = await Promise.race([reader.read(), sleep(1200).then(() => null)]);
      if (next?.value) data += decoder.decode(next.value);
    }
    assert.ok(data.includes('"_kind":"request"'), 'request streamed');
    assert.ok(data.includes('"_kind":"response"'), 'appended response streamed');
    assert.ok(data.includes('ses-test'), 'actual session id streamed');
    await reader.cancel();
  } finally {
    child.kill('SIGTERM');
    await rm(dir, { recursive: true, force: true });
  }
});
