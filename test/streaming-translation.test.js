import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveProvider } from '../src/http-provider.js';

const config = { translationProvider: 'xai', translationModel: 'grok-4.7', xaiKey: 'fixture-only', targetLanguage: 'ko', ttsProvider: 'none' };
const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
const delta = content => event({ choices: [{ delta: { content }, finish_reason: null }] });
const end = reason => event({ choices: [{ delta: {}, finish_reason: reason }] }) + 'data: [DONE]\r\n\r\n';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('translation publishes answer tokens before the upstream response finishes and lowers xAI reasoning', async t => {
  let release, body; const tail = new Promise(resolve => { release = resolve; });
  const encoder = new TextEncoder();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(encoder.encode(delta('비트코인은'))); await tail;
      controller.enqueue(encoder.encode(delta(' 오픈 소스입니다.') + end('stop'))); controller.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const updates = [];
  const pending = createLiveProvider(config).translate('Bitcoin is open source.', new AbortController().signal, [], { onDelta: text => updates.push(text) })
    .then(value => ({ value }), error => ({ error }));
  try {
    await tick(); assert.equal(updates[0], '비트코인은', 'First text must be visible while the upstream stream is still open');
    assert.equal(body.stream, true); assert.equal(body.reasoning_effort, 'low');
  } finally { release(); }
  const result = await pending; assert.ifError(result.error); assert.equal(result.value, '비트코인은 오픈 소스입니다.');
});

test('stream decoding handles fragmented Korean UTF-8 and excludes reasoning and think blocks', async t => {
  const secret = 'private-reasoning-fixture';
  const wire = new TextEncoder().encode(event({ choices: [{ delta: { reasoning_content: secret } }] })
    + delta('<thi') + delta(`nk>${secret}</think>비트코인`) + delta(' 결제.') + end('stop'));
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < wire.length; i += 7) controller.enqueue(wire.slice(i, i + 7)); controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const updates = [];
  const text = await createLiveProvider(config).translate('Bitcoin payment.', new AbortController().signal, [], { onDelta: text => updates.push(text) });
  assert.equal(text, '비트코인 결제.'); assert.ok(updates.length > 0);
  assert.equal(updates.some(text => text.includes(secret) || text.includes('<thi') || text.includes('�')), false);
});

test('incomplete translation streams fail instead of becoming final captions', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(delta('일부') + end('length'), { headers: { 'Content-Type': 'text/event-stream' } }));
  await assert.rejects(createLiveProvider(config).translate('Partial.', new AbortController().signal, [], { onDelta() {} }), /incomplete/i);
});

test('oversized and malformed streams fail without echoing upstream content', async t => {
  let wire = delta('가'.repeat(9000)) + end('stop');
  t.mock.method(globalThis, 'fetch', async () => new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }));
  await assert.rejects(createLiveProvider(config).translate('Large.', new AbortController().signal, [], { onDelta() {} }), /large|limit/i);
  wire = 'data: private-upstream-fixture\n\n';
  await assert.rejects(createLiveProvider(config).translate('Malformed.', new AbortController().signal, [], { onDelta() {} }), error => !error.message.includes('private-upstream-fixture'));
});
