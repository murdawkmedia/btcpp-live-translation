import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { createRehearsalProvider } from '../src/rehearsal.js';

test('Worker uses real outbound ElevenLabs-style WS and shares fixture translated audio', { timeout: 60000 }, async t => {
  let secretHeader, hints, translations = 0, speech = 0, pcm = 0;
  const http = createServer(async (req, res) => {
    let body = ''; for await (const p of req) body += p;
    const input = JSON.parse(body);
    if (req.url === '/chat/completions') {
      translations++; assert.match(input.messages[0].content, /Korean/);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'FROST는 비트코인 키를 보호합니다.' } }] }));
    } else { speech++; res.setHeader('content-type', 'audio/wav'); res.end((await createRehearsalProvider().speak('')).data); }
  });
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (ws, req) => {
    secretHeader = req.headers['xi-api-key']; hints = new URL(req.url, 'http://fixture').searchParams.getAll('keyterms');
    ws.send(JSON.stringify({ message_type: 'session_started' }));
    ws.on('message', raw => {
      const input = JSON.parse(raw); assert.equal(input.message_type, 'input_audio_chunk');
      if (input.commit) return ws.close();
      pcm += Buffer.from(input.audio_base_64, 'base64').length;
      ws.send(JSON.stringify({ message_type: 'committed_transcript', text: 'FROST protects Bitcoin keys.' }));
    });
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  t.after(() => { for (const c of wss.clients) c.terminate(); wss.close(); http.closeAllConnections(); http.close(); });
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const origin = `http://127.0.0.1:${port}`, fixture = `http://127.0.0.1:${http.address().port}`;
  await mkdir('.runtime', { recursive: true });
  const config = { name: 'translation-worker-fixture', main: new URL('../cloudflare/worker.js', import.meta.url).pathname,
    compatibility_date: '2026-10-19', compatibility_flags: ['nodejs_compat'],
    assets: { directory: new URL('../public', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, html_handling: 'none' },
    durable_objects: { bindings: [{ name: 'STAGE', class_name: 'StageSession' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['StageSession'] }],
    vars: { PROFILE: 'cloud', STT_PROVIDER: 'elevenlabs', TRANSLATION_PROVIDER: 'xai', TTS_PROVIDER: 'xai',
      ELEVENLABS_API_KEY: 'eleven-fixture-only', XAI_API_KEY: 'xai-fixture-only', XAI_BASE_URL: fixture,
      STT_URL: fixture.replace('http:', 'ws:') + '/stt', OPERATOR_TOKEN: 'operator-fixture-only', VIEWER_TOKEN: 'viewer-fixture-only' } };
  await writeFile('.runtime/worker-live-fixture.json', JSON.stringify(config));
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', '.runtime/worker-live-fixture.json', '--port', String(port), '--persist-to', '.runtime/live-fixture-state'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-5000); });
  t.after(async () => { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(`Worker exited: ${logs}`);
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(ready, logs);
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'operator-fixture-only' }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/capture', { headers: { Origin: origin, Cookie: cookie } });
  t.after(() => ws.terminate()); await once(ws, 'open');
  const message = once(ws, 'message'); ws.send(JSON.stringify({ type: 'start', topic: 'cryptography' }));
  assert.match((await message)[0].toString(), /ready/); ws.send(Buffer.alloc(3200));
  let status;
  for (let i = 0; i < 100; i++) {
    status = await (await fetch(origin + '/api/config', { headers: { Cookie: cookie } })).json();
    if (status.history?.[0]?.audioReady) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.equal(status.history[0]?.translated, 'FROST는 비트코인 키를 보호합니다.');
  const [a, b] = await Promise.all([fetch(origin + '/api/audio/1?token=viewer-fixture-only'), fetch(origin + '/api/audio/1?token=viewer-fixture-only')]);
  assert.equal(Buffer.from(await a.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
  assert.equal(Buffer.from(await b.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
  assert.equal(secretHeader, 'eleven-fixture-only'); assert.equal(hints.length, 50);
  assert.equal(pcm, 3200); assert.equal(translations, 1); assert.equal(speech, 1);
  ws.send(JSON.stringify({ type: 'stop' }));
});
