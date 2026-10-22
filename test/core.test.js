import test from 'node:test';
import assert from 'node:assert/strict';

const glossary = await import('../src/glossary.js').catch(() => ({}));
const transcript = await import('../src/transcript.js').catch(() => ({}));
const pcm = await import('../public/audio-core.js').catch(() => ({}));

test('broad vocabulary covers protocol, Lightning, privacy, ecash and Nostr', () => {
  assert.ok(glossary.terms?.length >= 180, 'at least 180 authored entries');
  assert.equal(new Set(glossary.terms.map(t => t.term.toLowerCase())).size, glossary.terms.length);
  for (const category of ['protocol', 'lightning', 'privacy', 'ecash', 'nostr']) {
    assert.ok(glossary.terms.some(t => t.category === category), category);
  }
});

test('recognition hints obey provider count/length and favor the current topic', () => {
  const hints = glossary.selectHints('privacy', { limit: 50, maxLength: 20 });
  assert.equal(hints.length, 50);
  assert.ok(hints.every(t => t.length <= 20));
  assert.ok(hints.includes('Payjoin'));
  assert.ok(hints.includes('CoinJoin'));
  const xai = glossary.selectHints('cryptography', { limit: 100, maxLength: 50 });
  assert.equal(xai.length, 100);
  assert.ok(xai.includes('FROST'));
});

test('translation context matches whole terms without turning ordinary cash into Cashu', () => {
  assert.equal(glossary.matchTerms('I paid cash yesterday.').some(t => t.term === 'Cashu'), false);
  assert.ok(glossary.matchTerms('Payjoin uses PSBTs.').some(t => t.term === 'PSBT'));
  assert.ok(glossary.matchTerms('cash oo and fedimint').some(t => t.term === 'Cashu'));
  assert.match(glossary.translationInstructions('We use Payjoin and 21 BTC.'), /21|numbers/);
});

test('Bitcoin currency units are protected from being renamed in translation', () => {
  const instructions = glossary.translationInstructions('Alice sends 1000 satoshis, not 1000000 sats.');
  const terminology = JSON.parse(instructions.split('Terminology: ')[1]);
  assert.ok(terminology.some(term => term.term === 'satoshis' && term.preserveSpelling));
  assert.match(instructions, /Keep Bitcoin currency units .*satoshis.*unchanged/);
});

test('timed overlapping windows defer unstable words without repeating the shared prefix', () => {
  assert.equal(typeof transcript.TimedTranscriptAssembler, 'function');
  const a = new transcript.TimedTranscriptAssembler();
  assert.equal(a.accept([{ word: 'Do', start: 0, end: 0.4 }, { word: 'not', start: 0.4, end: 0.8 }, { word: 'share', start: 0.8, end: 1.3 }], 0, 1), 'Do not');
  assert.equal(a.accept([{ word: 'not', start: 0.3, end: 0.7 }, { word: 'share', start: 0.7, end: 1.2 }, { word: 'seeds.', start: 1.2, end: 1.8 }], 0.1), 'share seeds.');
  assert.equal(a.accept([{ word: 'very', start: 2, end: 2.3 }, { word: 'very', start: 2.3, end: 2.6 }], 0), 'very very');
});

test('chunk-final then stitched utterance translates only the remaining words', () => {
  const a = new transcript.TranscriptAssembler();
  assert.equal(a.accept({ type: 'transcript.partial', is_final: false, text: 'Pay' }), null);
  assert.equal(a.accept({ type: 'transcript.partial', is_final: true, speech_final: false,
    text: 'Payjoin improves', start: 0, duration: 2 }), 'Payjoin improves');
  assert.equal(a.accept({ type: 'transcript.partial', is_final: true, speech_final: true,
    text: 'Payjoin improves privacy.', start: 0, duration: 3,
    words: [{ text: 'Payjoin', start: 0, end: 1 }, { text: 'improves', start: 1, end: 2 }, { text: 'privacy.', start: 2, end: 3 }] }), 'privacy.');
  assert.equal(a.accept({ type: 'transcript.done', text: 'Payjoin improves privacy.', duration: 3 }), null);
});

test('stitched final without word timing does not repeat its committed prefix', () => {
  const a = new transcript.TranscriptAssembler();
  assert.equal(a.accept({ type: 'transcript.partial', is_final: true, text: 'Bitcoin is', start: 0, duration: 2 }), 'Bitcoin is');
  assert.equal(a.accept({ type: 'transcript.partial', is_final: true, speech_final: true,
    text: 'Bitcoin is money.', start: 0, duration: 3 }), 'money.');
  assert.equal(a.accept({ type: 'transcript.partial', is_final: true, speech_final: true,
    text: 'Bitcoin is money.', start: 3, duration: 3 }), 'Bitcoin is money.');
});

test('PCM framing preserves duration across arbitrary chunk boundaries and clips safely', () => {
  const framer = new pcm.PcmFramer(48000);
  const frames = [];
  for (let i = 0; i < 375; i++) frames.push(...framer.push(new Float32Array(128).fill(2)));
  assert.equal(frames.length, 10);
  assert.equal(frames[0].byteLength, 3200);
  assert.equal(new DataView(frames[0]).getInt16(0, true), 32767);
});

test('a fully duplicated utterance final clears context before the next utterance', () => {
  const a = new transcript.TranscriptAssembler();
  assert.equal(a.accept({ type: 'transcript.partial', is_final: true, text: 'Bitcoin', start: 0, duration: 1 }), 'Bitcoin');
  assert.equal(a.accept({ type: 'transcript.partial', is_final: true, speech_final: true, text: 'Bitcoin', start: 0, duration: 1 }), null);
  assert.equal(a.accept({ type: 'transcript.partial', is_final: true, text: 'Payjoin', start: 2, duration: 1 }), 'Payjoin');
  assert.equal(a.accept({ type: 'transcript.partial', is_final: true, speech_final: true, text: 'Payjoin works.', start: 2, duration: 2 }), 'works.');
});

// Whisper emits punctuation/number pieces without spaces inside one number.
test('timed words retain tokenizer spacing in amounts and punctuation', () => {
  const a = new transcript.TimedTranscriptAssembler();
  assert.equal(a.accept([
    { word: ' Alice', start: 0, end: 0.2 }, { word: ' sends', start: 0.2, end: 0.4 },
    { word: ' 1', start: 0.4, end: 0.5 }, { word: ',000', start: 0.5, end: 0.6 },
    { word: ' sats.', start: 0.6, end: 0.8 }
  ]), 'Alice sends 1,000 sats.');
});
