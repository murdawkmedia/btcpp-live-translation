import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLiveProvider } from '../src/providers.js';

test('ElevenLabs speech adapter sends Korean text with server-side credentials', async t => {
  let received;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received = { url: req.url, key: req.headers['xi-api-key'], body: JSON.parse(body) };
    res.setHeader('Content-Type', 'audio/mpeg'); res.end(Buffer.from('eleven-fixture-audio'));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const provider = createLiveProvider({ ttsProvider: 'elevenlabs', elevenKey: 'fixture-only', elevenVoice: 'test-voice',
    elevenBase: `http://127.0.0.1:${server.address().port}` });
  const audio = await provider.speak('비트코인', new AbortController().signal);
  assert.equal(audio.data.toString(), 'eleven-fixture-audio');
  assert.equal(received.key, 'fixture-only'); assert.equal(received.body.language_code, 'ko');
  assert.equal(received.body.text, '비트코인'); assert.match(received.url, /test-voice\/stream/);
});
