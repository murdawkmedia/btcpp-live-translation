import test from 'node:test';
import assert from 'node:assert/strict';
const { Pipeline } = await import('../src/pipeline.js').catch(() => ({}));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a slow voice response cannot hold back the next translated caption', async () => {
  let releaseVoice, voiceStarted;
  const started = new Promise(resolve => { voiceStarted = resolve; });
  const gate = new Promise(resolve => { releaseVoice = resolve; });
  const p = new Pipeline({ translate: async text => `ko:${text}`, speak: async text => {
    if (text === 'ko:first') { voiceStarted(); await gate; }
    return { data: Buffer.alloc(10), mime: 'audio/wav' };
  } });
  const events = []; p.on('event', event => events.push(event));
  const first = p.submit('first'); await started;
  const second = p.submit('second');
  try {
    await new Promise(setImmediate);
    assert.deepEqual(events.filter(event => event.type === 'caption').map(event => event.segment.english), ['first', 'second']);
    assert.equal(events.some(event => event.type === 'audio'), false);
  } finally { releaseVoice(); await Promise.all([first, second]); }
});

test('a stalled voice queue stays bounded while all captions continue', async () => {
  let release, ready;
  const started = new Promise(resolve => { ready = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const p = new Pipeline({ translate: async text => text, speak: async text => {
    if (text === '1') { ready(); await gate; }
    return { data: Buffer.alloc(10), mime: 'audio/wav' };
  } }, { maxSpeechQueue: 2 });
  const events = []; p.on('event', event => events.push(event));
  const submitted = [p.submit('1')]; await started;
  try {
    for (let i = 2; i <= 8; i++) { submitted.push(p.submit(String(i))); await new Promise(setImmediate); }
    assert.deepEqual(p.history.map(segment => segment.english), ['1', '2', '3', '4', '5', '6', '7', '8']);
    assert.equal(p.speechQueue.length, 2);
  } finally { release(); await Promise.all(submitted); await p.drain(); }
  assert.deepEqual(events.filter(event => event.type === 'audio').map(event => event.id), [1, 7, 8]);
  assert.ok(events.some(event => event.type === 'issue' && event.stage === 'speech'));
});

test('stop cancels queued voice and ignores a late in-flight speech response', async () => {
  let release, ready;
  const started = new Promise(resolve => { ready = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const p = new Pipeline({ translate: async text => text, speak: async () => { ready(); await gate; return { data: Buffer.alloc(10), mime: 'audio/wav' }; } });
  const events = []; p.on('event', event => events.push(event));
  const first = p.submit('first'); await started; const second = p.submit('second');
  await new Promise(setImmediate); p.cancel(); release();
  assert.deepEqual(await Promise.all([first, second]), [false, false]); await p.drain();
  assert.equal(events.filter(event => event.type === 'audio').length, 0);
  assert.equal(p.audio.size, 0);
});

test('invalid voice queue capacity is rejected', () => {
  assert.throws(() => new Pipeline({}, { maxSpeechQueue: 0 }), /voice queue/i);
});

test('a non-Korean broadcast labels shared captions with its selected language', async () => {
  const p = new Pipeline({ targetLanguage: 'fr', translate: async () => 'Bonjour Bitcoin.',
    speak: async () => ({ data: Buffer.alloc(10), mime: 'audio/mpeg' }) });
  await p.submit('Hello Bitcoin.');
  assert.equal(p.history[0].language, 'fr');
  assert.equal(p.history[0].translated, 'Bonjour Bitcoin.');
  assert.equal(p.history[0].korean, undefined);
});

test('translation stays ordered and speech failure leaves readable captions', async () => {
  const p = new Pipeline({ translate: async text => { await sleep(text === 'one' ? 15 : 1); return `ko:${text}`; },
    speak: async text => { if (text.includes('two')) throw Error('unavailable'); return { data: Buffer.alloc(40), mime: 'audio/wav' }; } });
  const events = []; p.on('event', e => events.push(e));
  await Promise.all([p.submit('one'), p.submit('two')]);
  assert.deepEqual(p.history.map(s => s.english), ['one', 'two']);
  assert.equal(p.history[1].korean, 'ko:two');
  assert.ok(events.some(e => e.type === 'issue' && e.stage === 'speech'));
});

test('cancelling prevents in-flight work from leaking into another session', async () => {
  const p = new Pipeline({ translate: async text => { await sleep(20); return text; }, speak: async () => ({ data: Buffer.alloc(1), mime: 'audio/wav' }) });
  const old = p.submit('old'); p.cancel();
  await old;
  assert.equal(p.history.length, 0);
  await p.submit('new');
  assert.deepEqual(p.history.map(s => s.english), ['new']);
});

test('queue overflow is explicit and audio/history memory stays bounded', async () => {
  const p = new Pipeline({ translate: async text => { await sleep(5); return text; },
    speak: async () => ({ data: Buffer.alloc(40), mime: 'audio/wav' }) }, { maxQueue: 1, maxAudioBytes: 60, maxHistory: 2 });
  const a = p.submit('a'), b = p.submit('b');
  assert.throws(() => p.submit('c'), /capacity/);
  await Promise.all([a, b]); await p.submit('d');
  assert.equal(p.history.length, 2);
  assert.ok(p.audioBytes <= 60);
  assert.equal(p.audio.size, 1);
});
test('English is broadcast and recoverable while translation is still pending', async () => {
  let finish;
  const pipeline = new Pipeline({ translate: () => new Promise(resolve => { finish = resolve; }), speak: async () => ({ data: Buffer.from('audio'), mime: 'audio/wav' }) });
  const events = []; pipeline.on('event', event => events.push(event));
  const done = pipeline.submit('Bitcoin is open source.');
  assert.equal(events[0]?.type, 'transcript');
  assert.equal(events[0]?.segment.english, 'Bitcoin is open source.');
  assert.equal(pipeline.transcripts?.[0]?.english, 'Bitcoin is open source.');
  finish('비트코인은 오픈 소스입니다.'); await done;
  assert.equal(events.find(event => event.type === 'caption').segment.id, events[0].segment.id);
});
