import test from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../src/pipeline.js';
import { selectHints, matchTerms } from '../src/glossary.js';

const provider = (calls = []) => ({ targetLanguage: 'ko', speechEnabled: false,
  async translate(text) { calls.push(text); return '번역'; } });

test('a numbered proposal misheard as Bit54 is corrected before English and translation fanout', async () => {
  const calls = [], events = [], p = new Pipeline(provider(calls));
  p.on('event', value => events.push(value));
  p.preview('Does Bit54 help with UTXO?');
  assert.equal(p.draft.english, 'Does BIP 54 help with UTXO?');
  await p.submit('Does Bit54 help with UTXO?');
  assert.equal(events.find(e => e.type === 'transcript').segment.english, 'Does BIP 54 help with UTXO?');
  assert.equal(p.history[0].english, 'Does BIP 54 help with UTXO?');
  assert.deepEqual(calls, ['Does BIP 54 help with UTXO?']);
});

test('explicit BIP spelling variants retain their exact numeric identifier', async () => {
  for (const [input, expected] of [
    ['Compare BIP54 and BIP-30.', 'Compare BIP 54 and BIP 30.'],
    ['B I P 125 does not mean BIP 1250.', 'BIP 125 does not mean BIP 1250.'],
    ['bip 0054, not BIP-53.', 'BIP 0054, not BIP 53.']
  ]) {
    const p = new Pipeline(provider()); await p.submit(input);
    assert.equal(p.history[0].english, expected);
  }
});

test('ambiguous numbers, ordinary words and code-like identifiers are preserved', async () => {
  for (const input of [
    'Set bit 54 of the mask for the UTXO flag.',
    'This UTXO integer uses bit54 as an offset.',
    'The register bit54 sets the consensus flag.',
    'A 54 bit integer and a 32-bit key.',
    'Bit54 was printed on the label.',
    'Bit54 was printed on the label. Next we will discuss UTXO.',
    'The UTXO key is some_bit54 and bip54_example.',
    'See https://example.com/bip-0054.md and `bip54` for UTXO.',
    'Read bip-0054.md rather than change some.bip54 or /bip54.',
    'This 32-bit54 for UTXO is an identifier.',
    'Read bit54/docs and bip54/docs for UTXO.',
    'We need a URSF, not UASF. URI sign and Bitcoin 10 chain are uncertain.',
    'The multi-armed bandit draws an arc and makes a beep.',
    '70 tokens per second; RTX 6000 Ada, not RTX 6000 Blackwell.',
    '1000 satoshis, not 1000000 sats.'
  ]) {
    const p = new Pipeline(provider()); p.preview(input); await p.submit(input);
    assert.equal(p.history[0].english, input);
  }
});

test('repeated candidate spellings do not masquerade as a bitfield context', async () => {
  const p = new Pipeline(provider()); await p.submit('Bit54 and bit 54 help UTXO.');
  assert.equal(p.history[0].english, 'BIP 54 and BIP 54 help UTXO.');
});

test('default conference recognition hints include the observed consensus acronyms', () => {
  const hints = selectHints('protocol', { limit: 50, maxLength: 20 });
  for (const term of ['BIP 54', 'BIP 30', 'UASF', 'URSF', 'UTXO']) assert.ok(hints.includes(term), term);
  assert.equal(hints.length, 50); assert.ok(hints.every(term => term.length <= 20));
});

test('talk context selects proposal identifiers and AI hardware under the same provider limits', () => {
  const hints = selectHints('protocol', { limit: 50, maxLength: 20,
    context: 'BIP54, UTXO, UASF, RTX 6000 Ada, GGUF and llama.cpp' });
  for (const term of ['BIP 54', 'UASF', 'RTX 6000 Ada', 'GGUF', 'llama.cpp']) assert.ok(hints.includes(term), term);
  const ai = selectHints('ai', { limit: 50, maxLength: 20 });
  for (const term of ['CUDA', 'VRAM', 'GGUF', 'RTX 6000 Ada']) assert.ok(ai.includes(term), term);
  assert.ok(matchTerms('BIP54 and BIP-30').some(term => term.term === 'BIP 54'));
});
