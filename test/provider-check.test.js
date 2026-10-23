import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
const { checkProvider } = await import('../src/provider-check.js').catch(() => ({}));

test('provider checks return metadata only and do not leak upstream bodies or keys', async t => {
  assert.equal(typeof checkProvider, 'function'); let mode = 'ok', calls = 0;
  const server = createServer((req, res) => { calls++; req.resume();
    if (mode === 'error') { res.writeHead(401); res.end('private-upstream-secret'); }
    else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '비트코인.' } }] })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const config = { translationProvider: 'openrouter', openrouterKey: 'private-upstream-secret', translationModel: 'fixture', translationBase: `http://127.0.0.1:${server.address().port}` };
  const ok = await checkProvider(config, 'translation'); assert.equal(ok.ok, true); assert.equal(ok.stage, 'translation'); assert.equal(JSON.stringify(ok).includes('비트코인'), false);
  mode = 'error'; const rejected = await checkProvider(config, 'translation'); assert.equal(rejected.ok, false); assert.equal(JSON.stringify(rejected).includes('private-upstream-secret'), false);
  assert.equal(calls, 2); assert.equal((await checkProvider(config, 'unknown')).ok, false);
});

test('streaming recognition check closes the real socket after handshake without audio', async t => {
  let bytes = 0, closed = false;
  const server = createServer(), wss = new WebSocketServer({ server });
  wss.on('connection', ws => { ws.send(JSON.stringify({ message_type: 'session_started' })); ws.on('message', () => bytes++); ws.on('close', () => { closed = true; }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); });
  const result = await checkProvider({ sttProvider: 'elevenlabs', elevenKey: 'fixture-key', sttUrl: `ws://127.0.0.1:${server.address().port}` }, 'recognition', { openSocket: url => Promise.resolve(new WebSocket(url)) });
  assert.equal(result.ok, true); assert.match(result.message, /no audio/i);
  for (let i = 0; i < 50 && !closed; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(closed, true); assert.equal(bytes, 0);
});

test('a stalled native inference check times out without keeping settings busy forever', { timeout: 1000 }, async () => {
  const result = await checkProvider({ sttProvider: 'workers-ai', runAI: () => new Promise(() => {}) }, 'recognition', { timeoutMs: 20 });
  assert.equal(result.ok, false); assert.ok(result.elapsedMs < 500);
});


const voiceCheckConfig = { ttsProvider: 'elevenlabs', elevenKey: 'fixture-not-a-real-key', elevenVoice: 'fixture-voice', targetLanguage: 'ko' };

test('voice check reports a safe HTTP status and voice guidance without returning provider details', async t => {
  const privateDetail = 'private-upstream-fixture-body-and-credentials';
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ detail: privateDetail }), { status: 404 }));
  const result = await checkProvider(voiceCheckConfig, 'speech');
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 404);
  assert.match(result.message, /voice ID/i);
  assert.equal(JSON.stringify(result).includes(privateDetail), false);
  assert.equal(JSON.stringify(result).includes(voiceCheckConfig.elevenKey), false);
});

test('provider check never echoes arbitrary upstream exception text', async t => {
  const privateDetail = 'Provider HTTP 404; private-upstream-fixture';
  t.mock.method(globalThis, 'fetch', async () => { throw Error(privateDetail); });
  const result = await checkProvider(voiceCheckConfig, 'speech');
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, undefined);
  assert.equal(JSON.stringify(result).includes(privateDetail), false);
});

test('speech checks measure first audio bytes and can test xAI without saving a provider switch', async t => {
 const { speechCheckConfig } = await import('../src/provider-check.js');
 assert.equal(typeof speechCheckConfig, 'function');
 const original = { ttsProvider: 'elevenlabs', elevenKey: 'fixture-eleven', elevenVoice: 'fixture-voice', xaiKey: 'fixture-xai', targetLanguage: 'ko' };
 const selected = speechCheckConfig(original, { stage: 'speech', speechProvider: 'xai', voice: 'rex' });
 assert.equal(original.ttsProvider, 'elevenlabs'); assert.equal(selected.ttsProvider, 'xai'); assert.equal(selected.voice, 'rex');
 assert.throws(() => speechCheckConfig(original, { stage: 'translation', speechProvider: 'xai' }));
 t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1,2,3]), { headers: { 'Content-Type': 'audio/mpeg' } }));
 const result = await checkProvider(selected, 'speech'); assert.equal(result.ok, true); assert.equal(typeof result.firstAudioMs, 'number');
});
