import test from 'node:test';
import assert from 'node:assert/strict';
import { terms, topics, matchTerms, selectHints, translationInstructions } from '../src/glossary.js';
import { normalizeTranscript } from '../src/transcript-terms.js';

test('Seoul preset balances main-stage people, sponsors and technical terms under provider limits', () => {
  assert.ok(topics.includes('seoul'));
  const hints = selectHints('seoul', { limit: 50, maxLength: 20 });
  assert.equal(hints.length, 50);
  assert.equal(new Set(hints).size, hints.length);
  assert.ok(hints.every(t => t.length <= 20));
  for (const name of ['Calvin Kim', 'Fabian Jahr', 'Oleksandr Kurbatov', 'niftynei', 'NYDIG', 'Btrust', 'Stakwork', 'HRF', 'Base58', 'Soapbox', 'LX', 'btc++ insider', 'FROST', 'CISA', 'BIP 54', 'UTXO', 'Utreexo'])
    assert.ok(hints.includes(name), name);
  const xai = selectHints('seoul', { limit: 100, maxLength: 50 });
  assert.equal(xai.length, 100);
  assert.ok(xai.includes('btc++ insider edition'));
});

test('talk context prioritizes people and companies regardless of the selected technical topic', () => {
  const hints = selectHints('privacy', { limit: 5, maxLength: 20,
    context: 'Andrej Karpathy, Anthropic, Blockstream, OpenRouter and Fei-Fei Li' });
  assert.deepEqual(new Set(hints), new Set(['Andrej Karpathy', 'Anthropic', 'Blockstream', 'OpenRouter', 'Fei-Fei Li']));
  const ai = selectHints('ai', { limit: 50, maxLength: 20,
    context: 'Sam Altman, Dario Amodei, Jensen Huang and Demis Hassabis' });
  for (const name of ['Sam Altman', 'Dario Amodei', 'Jensen Huang', 'Demis Hassabis', 'Google DeepMind', 'Microsoft'])
    assert.ok(ai.includes(name), name);
});

test('full names and distinctive organizations keep canonical spellings in translation guidance', () => {
  const prompt = translationInstructions('Calvin Kim and Fabian Jahr thank Btrust, NYDIG and ElevenLabs.');
  const glossary = JSON.parse(prompt.split('Terminology: ')[1]);
  for (const name of ['Calvin Kim', 'Fabian Jahr', 'Btrust', 'NYDIG', 'ElevenLabs'])
    assert.ok(glossary.some(t => t.term === name && t.preserveSpelling), name);
  assert.match(prompt, /people.*organizations.*spellings/);
});

test('ordinary words and surnames alone do not become people or company names', () => {
  for (const text of ['The block is full.', 'Draw a spiral near the brink.', 'That is meta learning.',
    'Use a soapbox and play the piccolo.', 'Danny and Sam met Jin.', 'Kim and Adam went home.',
    'Draw a spiral. Next, discuss Bitcoin.', 'That is meta learning. Facebook is another subject.']) {
    assert.equal(matchTerms(text).some(t => ['people', 'organizations'].includes(t.category) || t.term === 'Meta'), false, text);
    assert.equal(normalizeTranscript(text), text);
  }
});

test('ambiguous brands and handles require independent context and never rewrite source text', () => {
  for (const [text, expected] of [['Bitcoin grant support from Brink and Spiral.', ['Brink', 'Spiral']],
    ['Meta develops Llama.', ['Meta']], ['Sponsors include Soapbox and LX.', ['Soapbox', 'LX']],
    ['Speaker Jin presents payer notes.', ['Jin']], ['Speaker Danny discusses Marmot.', ['Danny']]]) {
    const found = matchTerms(text).map(t => t.term);
    for (const name of expected) assert.ok(found.includes(name), `${name}: ${text}`);
    assert.equal(normalizeTranscript(text), text);
  }
});

test('all named entries have public provenance and hints never include invented phonetic replacements', () => {
  const named = terms.filter(t => ['people', 'organizations'].includes(t.category));
  assert.ok(named.length >= 60);
  for (const term of named) {
    assert.ok(term.preserve, term.term);
    assert.match(term.source, /^https:\/\//, term.term);
  }
  assert.equal(matchTerms('Andrea builds cloud code using a network router.').some(t =>
    ['Andrej Karpathy', 'Claude Code', 'Routstr'].includes(t.term)), false);
});
