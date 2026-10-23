import test from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../src/pipeline.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('English and translated draft tokens arrive before final recognition or translation', async t => {
  const hold = gate(), events = [];
  const p = new Pipeline({ draftEnabled: true, speechEnabled: false, targetLanguage: 'ko',
    translate: async (_text, _signal, _previous, options) => { options.onDelta('비트코인'); await hold.promise; return '비트코인 결제'; } });
  t.after(() => { p.cancel(); hold.resolve(); }); p.on('event', e => events.push(e));
  assert.equal(typeof p.preview, 'function'); p.preview('Bitcoin payment');
  assert.equal(p.draft.english, 'Bitcoin payment'); await tick();
  assert.equal(p.draft.translated, '비트코인'); assert.equal(p.history.length, 0);
  assert.ok(events.some(e => e.type === 'draft' && e.draft?.english));
});

test('draft calls coalesce to the latest input with one active request and a bounded cadence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const requests = []; let active = 0, peak = 0;
  const p = new Pipeline({ draftEnabled: true, speechEnabled: false, translate: async text => {
    const hold = gate(); requests.push({ text, hold }); peak = Math.max(peak, ++active); await hold.promise; active--; return '번역';
  } }, { draftIntervalMs: 100 });
  t.after(() => { p.cancel(); for (const r of requests) r.hold.resolve(); });
  assert.equal(typeof p.preview, 'function'); p.preview('one'); p.preview('two'); p.preview('three');
  assert.deepEqual(requests.map(r => r.text), ['one']); requests[0].hold.resolve(); await tick();
  t.mock.timers.tick(100); await tick();
  assert.deepEqual(requests.map(r => r.text), ['one', 'three']); assert.equal(peak, 1);
});

test('commit cancels old draft work and late updates cannot overwrite the next utterance', async t => {
  const hold = gate(); let stale;
  const p = new Pipeline({ draftEnabled: true, speechEnabled: false, translate: async (_text, _signal, _previous, options) => {
    if (options.draft) { stale = options.onDelta; await hold.promise; return '이전'; } return '확정';
  } });
  t.after(() => { p.cancel(); hold.resolve(); });
  assert.equal(typeof p.preview, 'function'); p.preview('First'); const old = p.draft.id;
  await p.submit('First'); assert.equal(p.draft, null); p.preview('Next');
  stale('LATE'); hold.resolve(); await tick();
  assert.notEqual(p.draft.id, old); assert.equal(p.draft.english, 'Next'); assert.notEqual(p.draft.translated, 'LATE');
});

test('a completed exact-match draft promotes to final without another translation or provisional voice', async t => {
  let translations = 0, spoken = 0;
  const p = new Pipeline({ draftEnabled: true, targetLanguage: 'ko', translate: async () => { translations++; return '비트코인'; },
    speak: async () => { spoken++; return { data: Buffer.from('fixture-audio'), mime: 'audio/wav' }; } });
  t.after(() => p.cancel()); assert.equal(typeof p.preview, 'function'); p.preview('Bitcoin'); await tick();
  assert.equal(translations, 1); assert.equal(spoken, 0); assert.equal(p.history.length, 0);
  await p.submit('Bitcoin'); assert.equal(translations, 1); assert.equal(spoken, 1); assert.equal(p.draft, null);
  assert.equal(p.history[0].translated, '비트코인');
});

test('pending final translation tokens are recoverable but cannot survive cancellation', async t => {
  const hold = gate(); let update;
  const p = new Pipeline({ speechEnabled: false, translate: async (_text, _signal, _previous, options) => {
    update = options.onDelta; update('비트코인'); await hold.promise; return '비트코인 결제';
  } });
  t.after(() => { p.cancel(); hold.resolve(); }); const events = []; p.on('event', e => events.push(e));
  const done = p.submit('Bitcoin payment'); await tick();
  assert.equal(p.listenerHistory()[0].translated, '비트코인'); assert.equal(p.listenerHistory()[0].provisional, true);
  assert.ok(events.some(e => e.type === 'caption-draft'));
  p.cancel(); update('LATE'); hold.resolve(); await done;
  assert.equal(p.history.length, 0); assert.equal(p.listenerHistory()[0].translated, undefined);
});

test('providers without draft support still publish English without extra model calls', t => {
  let calls = 0;
  const p = new Pipeline({ draftEnabled: false, translate: async () => { calls++; return '번역'; } });
  t.after(() => p.cancel()); assert.equal(typeof p.preview, 'function'); p.preview('Bitcoin');
  assert.equal(p.draft.english, 'Bitcoin'); assert.equal(calls, 0);
});

test('failed final streams discard their prefix and never enter stable history or voice', async t => {
  let spoken = 0;
  const p = new Pipeline({ translate: async (_text, _signal, _previous, { onDelta }) => {
    onDelta('일부'); throw Error('fixture failure');
  }, speak: async () => { spoken++; } });
  t.after(() => p.cancel());
  assert.equal(await p.submit('Bitcoin'), false);
  assert.equal(p.history.length, 0); assert.equal(spoken, 0);
  assert.equal(p.listenerHistory()[0].failed, true); assert.equal(p.listenerHistory()[0].translated, undefined);
});
