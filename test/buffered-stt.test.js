import test from 'node:test';
import assert from 'node:assert/strict';
import { connectBufferedTranscriber } from '../src/buffered-stt.js';

const speech = () => { const frame = Buffer.alloc(3200); for (let i = 0; i < frame.length; i += 2) frame.writeInt16LE(6000, i); return frame; };
function capture(runAI) {
  const texts = [], warnings = [], statuses = []; let done, fail;
  const closed = new Promise((resolve, reject) => { done = resolve; fail = reject; });
  closed.catch(() => {});
  const bridge = connectBufferedTranscriber({ sttProvider: 'workers-ai', runAI }, { topic: 'privacy', context: 'Cashu, Nostr and Bitcoin',
    onReady() {}, onPartial() {}, onStatus: status => statuses.push(status), onWarning: message => warnings.push(message), onText: text => texts.push(text), onError: message => fail(Error(message)), onClosed: done });
  return { bridge, texts, warnings, statuses, closed };
}

test('buffered recognition keeps overlapping audio and emits each timed word once', async () => {
  const lengths = []; let call = 0;
  const { bridge, texts, closed } = capture(async (_, input) => {
    assert.equal(input.word_timestamps, true);
    lengths.push((Buffer.from(input.audio, 'base64').length - 44) / 32000);
    const words = call++ === 0
      ? [{ word: 'Bitcoin', start: 0, end: 0.8 }, { word: 'channels', start: 0.8, end: 1.8 }, { word: 'protect.', start: 2, end: 2.8 }, { word: 'your', start: 3.3, end: 3.8 }, { word: 'seed', start: 4.2, end: 4.95 }]
      : [{ word: 'your', start: 3.3, end: 3.8 }, { word: 'seed', start: 4.2, end: 4.95 }, { word: 'phrase', start: 5, end: 5.4 }, { word: 'private', start: 5.5, end: 6.1 }];
    return { text: words.map(word => word.word).join(' '), segments: [{ words }] };
  });
  for (let i = 0; i < 75; i++) bridge.send(speech());
  bridge.finish(); await closed;
  assert.deepEqual(lengths, [5, 7.5]);
  assert.deepEqual(texts, ['Bitcoin channels protect.', 'your seed phrase private']);
});

test('the input onset keeps a short quiet lead-in instead of clipping the first word', async () => {
  let bytes;
  const { bridge, closed } = capture(async (_, input) => { bytes = Buffer.from(input.audio, 'base64').length - 44; return { text: 'The Bitcoin network.' }; });
  bridge.send(Buffer.alloc(3200)); bridge.send(Buffer.alloc(3200));
  for (let i = 0; i < 5; i++) bridge.send(speech());
  bridge.finish(); await closed;
  assert.equal(bytes, 22400);
});

test('recognition context stays concise and retains the named technical spellings', async () => {
  const { bridge, closed } = capture(async (_, input) => {
    assert.ok(input.initial_prompt.length <= 500);
    assert.match(input.initial_prompt, /Cashu/); assert.match(input.initial_prompt, /Nostr/);
    return { text: 'Cashu and Nostr.' };
  });
  for (let i = 0; i < 5; i++) bridge.send(speech());
  bridge.finish(); await closed;
});

test('quiet input never creates an inference request', async () => {
  let calls = 0;
  const { bridge, closed, texts } = capture(async () => { calls++; });
  for (let i = 0; i < 60; i++) bridge.send(Buffer.alloc(3200));
  bridge.finish(); await closed;
  assert.equal(calls, 0); assert.deepEqual(texts, []);
});

test('a continuous talk revisits bounded context instead of retaining all source audio', async () => {
  const lengths = [];
  const { bridge, closed } = capture(async (_, input) => {
    lengths.push((Buffer.from(input.audio, 'base64').length - 44) / 32000);
    return { text: '' };
  });
  for (let i = 0; i < 300; i++) {
    bridge.send(speech());
    await new Promise(resolve => setImmediate(resolve));
  }
  bridge.finish(); await closed;
  assert.deepEqual(lengths.slice(0, 3), [5, 8, 11]);
  assert.ok(lengths.length > 8);
  assert.ok(lengths.every(seconds => seconds <= 13));
});

test('one transient cloud recognition failure retries the same audio without ending capture', async () => {
  let calls = 0;
  const { bridge, texts, closed } = capture(async (_, input) => {
    calls++;
    if (calls === 1) throw Object.assign(Error('upstream fixture unavailable'), { status: 503 });
    return { text: 'Bitcoin works.', segments: [{ words: [{ word: 'Bitcoin', start: 0, end: 1 }, { word: 'works.', start: 1, end: 2 }] }] };
  });
  for (let i = 0; i < 5; i++) bridge.send(speech());
  bridge.finish(); await closed;
  assert.equal(calls, 2); assert.deepEqual(texts, ['Bitcoin works.']);
});

test('a single malformed timing response can recover without losing its utterance', async () => {
  let calls = 0;
  const { bridge, texts, closed } = capture(async () => ++calls === 1 ? { text: 'Bitcoin works.' } :
    { text: 'Bitcoin works.', segments: [{ words: [{ word: 'Bitcoin', start: 0, end: 1 }, { word: 'works.', start: 1, end: 2 }] }] });
  for (let i = 0; i < 50; i++) bridge.send(speech());
  await new Promise(resolve => setImmediate(resolve)); bridge.finish(); await closed;
  assert.deepEqual(texts, ['Bitcoin works.']); assert.ok(calls >= 2);
});

test('persistent recognition failures stop after two attempts without exposing upstream details', async () => {
  let calls = 0;
  const { bridge, closed } = capture(async () => { calls++; throw Object.assign(Error('private upstream fixture text'), { status: 503 }); });
  const failure = assert.rejects(closed, /Recognition.*503.*retry/);
  for (let i = 0; i < 5; i++) bridge.send(speech()); bridge.finish(); await failure;
  assert.equal(calls, 2);
});

test('rejected recognition credentials are not retried', async () => {
  let calls = 0;
  const { bridge, closed } = capture(async () => { calls++; throw Object.assign(Error('private auth response'), { status: 401 }); });
  const failure = assert.rejects(closed, /access was rejected/);
  for (let i = 0; i < 5; i++) bridge.send(speech()); bridge.finish(); await failure;
  assert.equal(calls, 1);
});

test('a slow cloud request coalesces overlapping pending audio and drains every word on Stop', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); const lengths = []; let calls = 0;
  const { bridge, texts, closed, statuses } = capture(async (_, input) => {
    const audio = Buffer.from(input.audio, 'base64'), firstFrame = audio.readInt16LE(44) - 1000, count = (audio.length - 44) / 3200;
    lengths.push(count / 10); if (++calls === 1) await gate;
    const words = [];
    for (let frame = Math.ceil(firstFrame / 10) * 10; frame < firstFrame + count; frame += 10)
      words.push({ word: `w${frame / 10}.`, start: (frame - firstFrame) / 10, end: (frame - firstFrame) / 10 + 0.2 });
    return { text: words.map(word => word.word).join(' '), segments: [{ words }] };
  });
  for (let i = 0; i < 200; i++) { const frame = Buffer.alloc(3200); for (let n = 0; n < frame.length; n += 2) frame.writeInt16LE(1000 + i, n); bridge.send(frame); }
  release(); await new Promise(resolve => setImmediate(resolve)); bridge.finish(); await closed;
  assert.equal(texts.join(' '), Array.from({ length: 20 }, (_, i) => `w${i}.`).join(' '));
  assert.ok(lengths.some(seconds => seconds > 13), 'Overlapping pending windows should share one request');
  assert.ok(statuses.includes('reconnecting')); assert.equal(statuses.at(-1), 'live');
});

test('an extended cloud slowdown keeps capture open with bounded audio and warns about skipped speech', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0; const lengths = [];
  const { bridge, closed, warnings } = capture(async (_, input) => {
    lengths.push((Buffer.from(input.audio, 'base64').length - 44) / 32000); if (++calls === 1) await gate;
    return { text: '' };
  });
  for (let i = 0; i < 600; i++) assert.equal(bridge.send(speech()), true);
  const stats = bridge.stats();
  assert.ok(stats.pendingWindows <= 3); assert.ok(stats.bufferedSeconds <= 30);
  assert.ok(stats.droppedAudioSeconds > 0); assert.ok(warnings.some(message => /missing|skipp/i.test(message)));
  bridge.finish(); release(); await closed;
  assert.ok(lengths.every(seconds => seconds <= 30));
});

test('a native Cloudflare daily allocation error stops without retry and explains the quota', async () => {
  let calls = 0;
  const { bridge, closed } = capture(async () => {
    calls++; throw Error('AiError: you have used up your daily free allocation of 10,000 neurons. private fixture response');
  });
  const failure = assert.rejects(closed, error => {
    assert.match(error.message, /daily free AI allowance.*exhausted/);
    assert.match(error.message, /00:00 UTC|Workers Paid/);
    assert.doesNotMatch(error.message, /private fixture/); return true;
  });
  for (let i = 0; i < 5; i++) bridge.send(speech()); bridge.finish(); await failure;
  assert.equal(calls, 1, 'An exhausted daily allowance cannot recover through an immediate retry');
});

test('the documented native AI account-limit code is recognized without a message body', async () => {
  let calls = 0;
  const { bridge, closed } = capture(async () => { calls++; throw Object.assign(Error('3036: Account limited'), { code: 3036 }); });
  const failure = assert.rejects(closed, /daily free AI allowance.*exhausted/);
  for (let i = 0; i < 5; i++) bridge.send(speech()); bridge.finish(); await failure;
  assert.equal(calls, 1);
});
