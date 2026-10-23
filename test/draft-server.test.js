import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { createApp } from '../src/server.js';

test('real recognizer partials become recoverable translated drafts before commit or response completion', async t => {
  const pending = new Set(); let requests = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) {}
    requests++; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"비트코인"}}]}\n\n'); pending.add(res);
    res.on('close', () => pending.delete(res));
  });
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ message_type: 'session_started' }));
    ws.once('message', () => ws.send(JSON.stringify({ message_type: 'partial_transcript', text: 'Bitcoin payment' })));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { for (const res of pending) res.end(); for (const ws of wss.clients) ws.terminate(); wss.close(); upstream.closeAllConnections(); upstream.close(); });
  const fixture = `http://127.0.0.1:${upstream.address().port}`;
  const app = createApp({ operatorToken: 'draft-operator-fixture', viewerToken: 'draft-viewer-fixture', sttProvider: 'elevenlabs', elevenKey: 'draft-private-key-fixture',
    sttUrl: fixture.replace('http:', 'ws:') + '/stt', translationProvider: 'xai', xaiKey: 'draft-private-key-fixture', base: fixture, ttsProvider: 'none' });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/capture', { headers: { Origin: base, Cookie: 'btcpp_operator=draft-operator-fixture' } });
  t.after(() => ws.terminate()); await once(ws, 'open'); const ready = once(ws, 'message'); ws.send(JSON.stringify({ type: 'start' })); await ready;
  ws.send(Buffer.alloc(3200));
  let snapshot;
  for (let i = 0; i < 100; i++) {
    snapshot = await (await fetch(base + '/api/listener?token=draft-viewer-fixture')).json();
    if (snapshot.draft?.translated) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(snapshot.draft?.english, 'Bitcoin payment'); assert.equal(snapshot.draft?.translated, '비트코인');
  assert.equal(snapshot.history.length, 0); assert.equal(requests, 1); assert.ok(pending.size > 0);
  assert.equal(JSON.stringify(snapshot).includes('draft-private-key-fixture'), false);
  await fetch(base + '/api/stop', { method: 'POST', headers: { Origin: base, Cookie: 'btcpp_operator=draft-operator-fixture', 'Content-Type': 'application/json' }, body: '{}' });
  snapshot = await (await fetch(base + '/api/listener?token=draft-viewer-fixture')).json();
  assert.equal(snapshot.draft, null); assert.deepEqual(snapshot.history, []);
});
