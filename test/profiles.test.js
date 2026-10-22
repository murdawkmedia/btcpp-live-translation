import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
const settings = await import('../src/config.js').catch(() => ({}));
const adapters = await import('../src/providers.js');
const { wav } = await import('../src/buffered-stt.js');

test('Workers AI speech accepts Korean and Japanese through the model language codes', async () => {
  for (const [targetLanguage, expected] of [['ko', 'kr'], ['ja', 'jp'], ['fr', 'fr']]) {
    const provider = adapters.createLiveProvider({ ttsProvider: 'workers-ai', targetLanguage,
      runAI: async (model, input) => {
        assert.equal(model, '@cf/myshell-ai/melotts');
        assert.equal(input.lang, expected);
        return { audio: Buffer.from('fixture-speech').toString('base64') };
      } });
    assert.ok((await provider.speak('Fixture text.')).data.length);
  }
});

test('Workers AI speech serves generated WAV bytes with their actual media type', async () => {
  const data = wav(Buffer.alloc(6400));
  const provider = adapters.createLiveProvider({ ttsProvider: 'workers-ai', targetLanguage: 'fr',
    runAI: async () => new Response(data, { headers: { 'Content-Type': 'audio/mpeg' } }) });
  const audio = await provider.speak('Fixture text.');
  assert.equal(audio.mime, 'audio/wav');
  assert.deepEqual(audio.data, data);
});

test('the portable runner defaults to local services without using present cloud keys', () => {
  assert.equal(typeof settings.configFromEnv, 'function');
  const c = settings.configFromEnv({ ELEVENLABS_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture' });
  assert.equal(c.sttProvider, 'local');
  assert.equal(c.translationProvider, 'local');
  assert.equal(c.ttsProvider, 'local');
  assert.equal(c.targetLanguage, 'ko');
  assert.match(c.localSttUrl, /^http:\/\/127\.0\.0\.1:/);
});

test('OpenRouter translation carries the chosen target and Bitcoin glossary, not the ElevenLabs key', async t => {
  let received;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const p of req) body += p;
    received = { key: req.headers.authorization, body: JSON.parse(body), url: req.url };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'Payjoin améliore la confidentialité.' } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const provider = adapters.createLiveProvider({ translationProvider: 'openrouter', targetLanguage: 'fr',
    openrouterKey: 'router-fixture', elevenKey: 'separate-fixture',
    base: `http://127.0.0.1:${server.address().port}`, translationBase: `http://127.0.0.1:${server.address().port}`, translationModel: 'fixture-model' });
  assert.match(await provider.translate('Payjoin improves privacy.', new AbortController().signal), /Payjoin/);
  assert.equal(received.key, 'Bearer router-fixture');
  assert.match(received.body.messages[0].content, /French/);
  assert.match(received.body.messages[0].content, /Payjoin/);
});

test('ElevenLabs realtime uses PCM chunks, bounded keyterms and committed transcripts', async t => {
  let query, key, input;
  const http = createServer(); const wss = new WebSocketServer({ server: http });
  wss.on('connection', (ws, req) => {
    query = new URL(req.url, 'http://fixture').searchParams; key = req.headers['xi-api-key'];
    ws.send(JSON.stringify({ message_type: 'session_started' }));
    ws.on('message', raw => {
      input = JSON.parse(raw);
      ws.send(JSON.stringify({ message_type: 'committed_transcript', text: 'FROST protects Bitcoin keys.' }));
    });
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  t.after(() => { for (const c of wss.clients) c.terminate(); wss.close(); http.close(); });
  const texts = [];
  let bridge;
  const ready = new Promise((resolve, reject) => {
    bridge = adapters.connectTranscriber({ sttProvider: 'elevenlabs', elevenKey: 'eleven-fixture',
      sttUrl: `ws://127.0.0.1:${http.address().port}/realtime` }, {
      topic: 'cryptography', onReady: resolve, onText: text => texts.push(text), onPartial() {}, onError: reject });
  });
  t.after(() => bridge.abort()); await ready;
  assert.equal(bridge.send(Buffer.alloc(3200)), true);
  for (let i = 0; i < 30 && !texts.length; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(key, 'eleven-fixture');
  assert.equal(query.get('model_id'), 'scribe_v2_realtime');
  const hints = query.getAll('keyterms');
  assert.ok(hints.length <= 50 && hints.every(x => x.length <= 20));
  assert.ok(hints.includes('FROST'));
  assert.equal(input.message_type, 'input_audio_chunk');
  assert.equal(Buffer.from(input.audio_base_64, 'base64').length, 3200);
  assert.deepEqual(texts, ['FROST protects Bitcoin keys.']);
});

test('unfinished model reasoning cannot become a translated caption or spoken audio', async t => {
  const server = createServer((req, res) => {
    req.resume(); res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '<think>I need to decide which words to use' } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const provider = adapters.createLiveProvider({ translationProvider: 'local', targetLanguage: 'ko',
    translationBase: `http://127.0.0.1:${server.address().port}`, translationModel: 'fixture-reasoning-model' });
  await assert.rejects(provider.translate('Bitcoin.', new AbortController().signal), /Invalid translation/);
});
