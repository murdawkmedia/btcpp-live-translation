import test from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../src/pipeline.js';
import { configFromEnv, providerStatus } from '../src/config.js';
const { ProviderSettings } = await import('../src/provider-settings.js').catch(() => ({}));
const key = 'ab'.repeat(32), secret = 'fixture-private-eleven-key';
const base = () => configFromEnv({ PROFILE: 'cloud' });
function store() { let value; return { get: async () => value, put: async next => { value = next; }, read: () => value }; }

test('provider overrides survive encrypted storage and never appear in snapshots', async () => {
  assert.equal(typeof ProviderSettings, 'function');
  const storage = store(), manager = new ProviderSettings(base(), { storage, key });
  await manager.ready;
  await manager.update({ sttProvider: 'elevenlabs', translationProvider: 'openrouter', ttsProvider: 'none', keys: { elevenlabs: secret, openrouter: 'fixture-private-router-key' } });
  assert.equal(manager.config.elevenKey, secret);
  assert.equal(manager.config.translationModel, 'google/gemini-2.5-flash');
  assert.equal(manager.snapshot().providers.ready, true);
  assert.equal(manager.snapshot().keys.elevenlabs.source, 'saved');
  assert.equal(JSON.stringify(manager.snapshot()).includes(secret), false);
  const first = JSON.stringify(storage.read()); assert.equal(first.includes(secret), false);
  await manager.update({ voice: 'eve' }); assert.notEqual(JSON.stringify(storage.read()), first);
  const restored = new ProviderSettings(base(), { storage, key }); await restored.ready;
  assert.equal(restored.config.elevenKey, secret); assert.equal(restored.config.ttsProvider, 'none');
});

test('blank keys preserve saved secrets and explicit removal restores the environment key', async () => {
  const manager = new ProviderSettings({ ...base(), elevenKey: 'environment-fixture' }, { storage: store(), key }); await manager.ready;
  await manager.update({ keys: { elevenlabs: secret } });
  await manager.update({ keys: { elevenlabs: '' } }); assert.equal(manager.config.elevenKey, secret);
  await manager.update({ keys: { elevenlabs: null } });
  assert.equal(manager.config.elevenKey, 'environment-fixture'); assert.equal(manager.snapshot().keys.elevenlabs.source, 'environment');
});

test('invalid configuration and failed writes leave working settings untouched', async () => {
  const storage = store(), manager = new ProviderSettings(base(), { storage, key }); await manager.ready;
  for (const patch of [{ sttProvider: 'none' }, { translationProvider: 'unknown' }, { keys: { xai: 'bad\nheader' } }, { translationModel: 'https://invalid.example/' }, { base: 'https://invalid.example/' }])
    await assert.rejects(manager.update(patch));
  storage.put = async () => { throw Error(secret); };
  await assert.rejects(manager.update({ ttsProvider: 'none' }), error => !error.message.includes(secret));
  assert.equal(manager.config.ttsProvider, 'workers-ai');
});

test('tampered ciphertext fails closed and settings operations exclude concurrent capture', async () => {
  const storage = store(), manager = new ProviderSettings(base(), { storage, key }); await manager.ready;
  await manager.update({ keys: { elevenlabs: secret } });
  await storage.put({ ...storage.read(), ciphertext: 'corrupt' });
  const broken = new ProviderSettings(base(), { storage, key }); await broken.ready;
  assert.equal(broken.snapshot().available, false);
  await assert.rejects(broken.update({ ttsProvider: 'none' }));
  let release; const held = manager.withLock(() => new Promise(resolve => { release = resolve; }));
  assert.equal(manager.busy, true); await assert.rejects(manager.update({ ttsProvider: 'none' }), /busy/i);
  release(); await held; assert.equal(manager.busy, false);
});

test('captions-only sessions need no speech credential and never call synthesis', async () => {
  assert.equal(providerStatus({ sttProvider: 'xai', translationProvider: 'xai', xaiKey: secret, ttsProvider: 'none' }).ready, true);
  let speech = 0;
  const pipeline = new Pipeline({ targetLanguage: 'ko', speechEnabled: false, translate: async () => '비트코인.', speak: async () => { speech++; throw Error('must not call'); } });
  const events = []; pipeline.on('event', event => events.push(event));
  assert.equal(await pipeline.submit('Bitcoin.'), true); await pipeline.drain();
  assert.equal(speech, 0); assert.equal(pipeline.history[0].audioReady, false);
  assert.equal(events.filter(event => event.type === 'issue').length, 0);
});

test('xAI and OpenRouter selections get their own models and never inherit local endpoints', async () => {
  const manager = new ProviderSettings(configFromEnv({}), { storage: store(), key }); await manager.ready;
  await manager.update({ translationProvider: 'xai', keys: { xai: secret } });
  assert.equal(manager.config.translationModel, 'grok-4.7'); assert.equal(manager.config.translationBase, undefined);
  await manager.update({ translationProvider: 'openrouter' }); assert.equal(manager.config.translationModel, 'google/gemini-2.5-flash');
});
