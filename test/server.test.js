import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
const { createApp } = await import('../src/server.js').catch(() => ({}));

async function start(t, config = {}) {
  const app = createApp({ operatorToken: 'operator-test-capability', viewerToken: 'viewer-test-capability', ...config });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  const request = (path, { auth = false, origin = base, body, method = body ? 'POST' : 'GET' } = {}) => fetch(base + path, {
    method, headers: { ...(auth ? { Cookie: 'btcpp_operator=operator-test-capability' } : {}), Origin: origin, 'Content-Type': 'application/json' },
    ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  return { app, base, request };
}

test('capabilities, origins, body limits and audio access are enforced', async t => {
  const { request } = await start(t);
  assert.equal((await request('/api/rehearsal', { body: {} })).status, 401);
  assert.equal((await request('/api/rehearsal', { auth: true, origin: 'https://other.invalid', body: {} })).status, 403);
  assert.equal((await request('/api/login', { body: { token: 'viewer-test-capability' } })).status, 401);
  assert.equal((await request('/api/login', { body: { token: 'operator-test-capability' } })).status, 200);
  assert.equal((await request('/api/login', { body: 'x'.repeat(9000) })).status, 413);
  assert.equal((await request('/api/audio/1')).status, 401);
  assert.equal((await request('/api/events?token=incorrect')).status, 401);
  const config = await (await request('/api/config', { auth: true })).json();
  assert.equal(config.liveReady, false);
  assert.equal(config.termCount, 345);
});

test('a failed live session reports its reason over capture and retains it for the operator', async t => {
  const { base, request } = await start(t, { sttProvider: 'workers-ai', translationProvider: 'workers-ai', ttsProvider: 'workers-ai', runAI: async () => { throw Error('private upstream details'); } });
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/capture', { headers: { Cookie: 'btcpp_operator=operator-test-capability', Origin: base } });
  t.after(() => ws.terminate()); await once(ws, 'open');
  const controls = []; ws.on('message', data => controls.push(JSON.parse(data.toString())));
  const ready = once(ws, 'message'); ws.send(JSON.stringify({ type: 'start' })); await ready;
  const closed = once(ws, 'close');
  const frame = Buffer.alloc(3200); for (let i = 0; i < frame.length; i += 2) frame.writeInt16LE(6000, i);
  for (let i = 0; i < 50; i++) ws.send(frame);
  await closed;
  const issue = controls.find(event => event.type === 'issue');
  assert.match(issue?.message || '', /Recognition/);
  const state = await (await request('/api/config', { auth: true })).json();
  assert.equal(state.lastIssue?.message, issue.message);
  assert.equal(state.lastIssue?.sessionId, state.sessionId);
  assert.equal(JSON.stringify(state.lastIssue).includes('private upstream'), false);
  const listener = await (await request('/api/listener?token=viewer-test-capability')).json();
  assert.equal(listener.lastIssue, undefined);
});

test('attendee snapshots are read-only, session-scoped and empty off air', async t => {
  const { request, app } = await start(t, { rehearsalInterval: 10000 });
  assert.equal((await request('/api/listener')).status, 401);
  assert.equal((await request('/api/listener?token=incorrect')).status, 401);
  assert.equal((await request('/api/config?token=viewer-test-capability')).status, 401);
  const initial = await (await request('/api/listener?token=viewer-test-capability')).json();
  assert.equal(initial.phase, 'idle'); assert.deepEqual(initial.history, []);
  assert.equal(initial.viewerUrl, undefined); assert.equal(initial.providers, undefined);
  await request('/api/rehearsal', { auth: true, body: {} });
  for (let i = 0; i < 100 && !app.state().history[0]?.audioReady; i++) await new Promise(r => setTimeout(r, 10));
  const live = await (await request('/api/listener?token=viewer-test-capability')).json();
  assert.equal(live.history.length, 1); assert.equal(typeof live.sessionId, 'string');
  assert.notEqual(live.sessionId, initial.sessionId);
  await request('/api/stop', { auth: true, body: {} });
  const stopped = await (await request('/api/listener?token=viewer-test-capability')).json();
  assert.deepEqual(stopped.history, []);
  assert.equal((await request('/api/audio/1?token=viewer-test-capability')).status, 409);
  const events = await request('/api/events?token=viewer-test-capability'); const reader = events.body.getReader();
  const snapshot = JSON.parse(new TextDecoder().decode((await reader.read()).value).split('\n')[0].slice(6)); await reader.cancel();
  assert.deepEqual(snapshot.history, []);
  assert.equal((await (await request('/api/config', { auth: true })).json()).history.length, 1, 'Operator review remains available');
});

test('rehearsal delivers Korean captions and bounded playable audio through real SSE', async t => {
  const { request } = await start(t, { rehearsalInterval: 5 });
  const controller = new AbortController(); t.after(() => controller.abort());
  const events = await request('/api/events?token=viewer-test-capability');
  const reader = events.body.getReader(); t.after(() => reader.cancel());
  assert.equal((await request('/api/rehearsal', { auth: true, body: {} })).status, 202);
  let data = '';
  for (let i = 0; i < 20 && !data.includes('"type":"audio"'); i++) data += new TextDecoder().decode((await reader.read()).value);
  assert.match(data, /비트코인/);
  assert.match(data, /"mode":"rehearsal"/);
  const audio = await request('/api/audio/1?token=viewer-test-capability');
  assert.equal(audio.status, 200); assert.equal(audio.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await audio.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
});

test('live capture proxies PCM/hints to a fixture STT and returns translated speech', async t => {
  let receivedPcm = false, hints = [], suppliedAuth = '', ttsLanguage = '', prompt = '';
  const fake = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const input = JSON.parse(body);
    if (req.url === '/chat/completions') {
      prompt = input.messages[0].content;
      res.setHeader('Content-Type', 'application/json');
      setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { content: 'Payjoin은 프라이버시를 개선합니다.' } }] })), 20);
    } else { ttsLanguage = input.language; res.setHeader('Content-Type', 'audio/mpeg'); res.end(Buffer.from('fixture-audio')); }
  });
  const fakeWs = new WebSocketServer({ server: fake });
  fakeWs.on('connection', (socket, req) => {
    hints = new URL(req.url, 'http://fixture').searchParams.getAll('keyterm'); suppliedAuth = req.headers.authorization;
    socket.send(JSON.stringify({ type: 'transcript.created' }));
    socket.on('message', (data, binary) => {
      if (binary) {
        receivedPcm = data.length === 3200;
        socket.send(JSON.stringify({ type: 'transcript.partial', is_final: true, speech_final: true,
          text: 'Payjoin improves privacy.', start: 0, duration: 3 }));
      } else {
        socket.send(JSON.stringify({ type: 'transcript.partial', is_final: true, speech_final: true,
          text: 'The final sentence.', start: 3, duration: 2 }));
        socket.send(JSON.stringify({ type: 'transcript.done', duration: 5 })); socket.close();
      }
    });
  });
  fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
  t.after(() => { for (const client of fakeWs.clients) client.terminate(); fake.closeAllConnections(); fake.close(); });
  const port = fake.address().port;
  const { base, request, app } = await start(t, { xaiKey: 'fixture-not-a-real-key', base: `http://127.0.0.1:${port}`, sttUrl: `ws://127.0.0.1:${port}/stt` });
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/capture', { headers: { Cookie: 'btcpp_operator=operator-test-capability', Origin: base } });
  t.after(() => ws.terminate()); await once(ws, 'open');
  const ready = once(ws, 'message'); ws.send(JSON.stringify({ type: 'start', topic: 'privacy' }));
  assert.match((await ready)[0].toString(), /ready/); ws.send(Buffer.alloc(3200));
  for (let i = 0; i < 100 && !app.state().history[0]?.audioReady; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.state().history[0]?.korean, 'Payjoin은 프라이버시를 개선합니다.');
  assert.ok(receivedPcm); assert.equal(hints.length, 100); assert.ok(hints.includes('Payjoin'));
  assert.equal(suppliedAuth, 'Bearer fixture-not-a-real-key'); assert.equal(ttsLanguage, 'ko'); assert.match(prompt, /Payjoin/);
  const audio = await request('/api/audio/1?token=viewer-test-capability');
  assert.equal(await audio.text(), 'fixture-audio');
  ws.send(JSON.stringify({ type: 'stop' }));
  for (let i = 0; i < 100 && app.state().phase !== 'idle'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.state().history.length, 2, 'stop flushes the final captured sentence before returning idle');
});

test('listener credentials cannot upload audio over WebSocket', async t => {
  const { base } = await start(t, { xaiKey: 'fixture-not-a-real-key' });
  const status = await new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/capture', { headers: { Cookie: 'btcpp_operator=viewer-test-capability', Origin: base } });
    ws.once('unexpected-response', (_, response) => { response.resume(); resolve(response.statusCode); ws.terminate(); });
    ws.once('error', error => { if (!String(error.message).includes('closed before')) reject(error); });
  });
  assert.equal(status, 401);
});

test('local mode uses only configured loopback services and retires audio after stop', async t => {
  let recognition = 0, translation = 0, speech = 0, multipart = '';
  const fixture = createServer(async (req, res) => {
    let body = Buffer.alloc(0); for await (const chunk of req) body = Buffer.concat([body, chunk]);
    assert.equal(req.headers.authorization, undefined);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/inference') { recognition++; multipart = body.toString(); res.end(JSON.stringify({ text: 'FROST protects Bitcoin keys.' })); }
    else if (req.url === '/chat/completions') { translation++; res.end(JSON.stringify({ choices: [{ message: { content: 'FROST protège les clés Bitcoin.' } }] })); }
    else { speech++; assert.equal(JSON.parse(body).language, 'fr'); res.setHeader('content-type', 'audio/mpeg'); res.end('fixture-local-audio'); }
  });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  t.after(() => { fixture.closeAllConnections(); fixture.close(); });
  const endpoint = `http://127.0.0.1:${fixture.address().port}`;
  const { base, request, app } = await start(t, { sttProvider: 'local', localSttUrl: `${endpoint}/inference`,
    translationProvider: 'local', translationBase: endpoint, translationModel: 'fixture-model',
    ttsProvider: 'local', localTtsUrl: `${endpoint}/speech`, localTtsModel: 'fixture-voice', localTtsVoice: 'fixture' });
  assert.equal((await request('/api/settings', { auth: true, body: { targetLanguage: 'fr' } })).status, 200);
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/capture', { headers: { Cookie: 'btcpp_operator=operator-test-capability', Origin: base } });
  t.after(() => ws.terminate()); await once(ws, 'open');
  const ready = once(ws, 'message'); ws.send(JSON.stringify({ type: 'start', topic: 'cryptography' })); await ready;
  const tone = Buffer.alloc(3200); for (let i = 0; i < tone.length; i += 2) tone.writeInt16LE(1000, i);
  ws.send(tone); ws.send(tone); ws.send(tone); ws.send(JSON.stringify({ type: 'stop' }));
  for (let i = 0; i < 100 && !app.state().history[0]?.audioReady; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.state().history[0]?.translated, 'FROST protège les clés Bitcoin.');
  assert.match(multipart, /RIFF/); assert.match(multipart, /FROST/);
  const [a, b] = await Promise.all([request('/api/audio/1?token=viewer-test-capability'), request('/api/audio/1?token=viewer-test-capability')]);
  assert.equal(a.status, 409); assert.equal(b.status, 409);
  assert.deepEqual([recognition, translation, speech], [1, 1, 1]);
});
