import test from 'node:test';
import assert from 'node:assert/strict';
import { connectStreamingTranscriber } from '../src/streaming-stt.js';
import { checkProvider } from '../src/provider-check.js';

const socket = () => {
  const handlers = new Map();
  return { readyState: 1, bufferedAmount: 0, closes: 0,
    addEventListener(type, fn) { handlers.set(type, fn); },
    send() {}, close() { this.closes++; },
    event(value) { handlers.get('message')({ data: JSON.stringify(value) }); }
  };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('documented ElevenLabs failures retain specific safe reasons without copying provider text', async () => {
  for (const [code, explanation] of [
    ['quota_exceeded', /quota/i], ['session_time_limit_exceeded', /session.*limit/i],
    ['insufficient_audio_activity', /audio activity/i], ['rate_limited', /rate/i],
    ['auth_error', /key/i], ['resource_exhausted', /capacity/i],
    ['input_error', /audio/i], ['invalid_request', /parameters/i],
    ['transcriber_error', /provider/i], ['unaccepted_terms', /terms/i],
    ['queue_overflow', /queue/i], ['chunk_size_exceeded', /chunk/i],
    ['commit_throttled', /commit/i], ['error', /provider/i]
  ]) {
    const ws = socket(), errors = []; let closed = 0;
    const bridge = connectStreamingTranscriber({ sttProvider: 'elevenlabs', elevenKey: 'fixture-only' },
      { onReady() {}, onText() {}, onPartial() {}, onError: text => errors.push(text), onClosed: () => closed++ }, async () => ws);
    await tick();
    ws.event({ message_type: 'session_started' });
    ws.event({ message_type: code, error: 'private-provider-body-and-speech', text: 'untrusted transcription' });
    assert.equal(errors.length, 1); assert.match(errors[0], new RegExp(`\\(${code}\\)`));
    assert.match(errors[0], explanation); assert.equal(errors[0].includes('private-provider'), false);
    assert.equal(errors[0].includes('untrusted transcription'), false);
    assert.equal(closed, 1); assert.equal(bridge.send(new ArrayBuffer(3200)), false);
    bridge.abort();
  }
});

test('new documented errors are recognized even when a provider sends no raw error body', async () => {
  const ws = socket(), errors = [];
  const bridge = connectStreamingTranscriber({ sttProvider: 'elevenlabs' },
    { onReady() {}, onText() {}, onPartial() {}, onError: text => errors.push(text) }, async () => ws);
  await tick(); ws.event({ message_type: 'insufficient_audio_activity' });
  assert.equal(errors.length, 1); assert.match(errors[0], /insufficient_audio_activity/); bridge.abort();
});

test('unknown provider errors and xAI messages remain generic and never expose raw details', async () => {
  for (const provider of ['elevenlabs', 'xai']) {
    const ws = socket(), errors = [];
    const bridge = connectStreamingTranscriber({ sttProvider: provider },
      { onReady() {}, onText() {}, onPartial() {}, onError: text => errors.push(text) }, async () => ws);
    await tick(); ws.event({ type: 'error', message_type: 'private-unknown-error', error: 'fixture-secret-never-display' });
    assert.deepEqual(errors, ['Transcription provider rejected the session. Check credentials and quota.']);
    bridge.abort();
  }
});

test('recognition checks report safe provider categories without sending audio', async () => {
  const ws = socket(); let sends = 0; ws.send = () => sends++;
  const pending = checkProvider({ sttProvider: 'elevenlabs', elevenKey: 'fixture-only' }, 'recognition', { openSocket: async () => ws });
  await tick(); ws.event({ message_type: 'quota_exceeded', error: 'fixture-secret-never-display' });
  const report = await pending;
  assert.equal(report.ok, false); assert.match(report.message, /quota_exceeded/);
  assert.equal(report.message.includes('fixture-secret'), false); assert.equal(sends, 0);
});
