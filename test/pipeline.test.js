import test from 'node:test';
import assert from 'node:assert/strict';
const { Pipeline } = await import('../src/pipeline.js').catch(() => ({}));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
