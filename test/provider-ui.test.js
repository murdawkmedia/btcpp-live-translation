import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const code = await readFile(new URL('../public/provider-settings.js', import.meta.url), 'utf8').catch(() => '');

async function panel({ rejectSave = false } = {}) {
  const nodes = new Map(), calls = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, disabled: false, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() {} }); return nodes.get(id); };
  const state = { available: true, persistent: true, sttProvider: 'elevenlabs', translationProvider: 'openrouter', ttsProvider: 'none', translationModel: 'fixture-model', elevenVoice: '', voice: 'eve', models: { xai: 'grok-4.7' },
    options: { sttProvider: ['elevenlabs', 'xai'], translationProvider: ['openrouter', 'xai'], ttsProvider: ['none', 'elevenlabs', 'xai'] },
    keys: Object.fromEntries(['elevenlabs', 'openrouter', 'xai'].map(k => [k, { configured: false, source: 'missing' }])) };
  const sandbox = { document: { getElementById: node, createElement: () => ({}) }, AbortSignal,
    api: async (path, body) => { calls.push({ path, body }); if (body && rejectSave) throw Error('Could not save privately.'); return body && path.endsWith('/test') ? { ok: true, message: 'Connection accepted.' } : state; } };
  vm.runInNewContext(code.replace('export function ', 'function ') + '\nthis.panel = initProviderSettings({ api, onChange() {}, onBusy() {} });', sandbox);
  await sandbox.panel.load(); return { node, calls, panel: sandbox.panel };
}

test('operator provider form clears successfully submitted keys and locks changes during capture', async () => {
  assert.match(code, /initProviderSettings/);
  const ui = await panel(); ui.node('key-elevenlabs').value = 'fixture-private-key';
  await ui.node('provider-form').handlers.submit({ preventDefault() {} });
  assert.equal(ui.calls.at(-1).body.keys.elevenlabs, 'fixture-private-key');
  assert.equal(ui.node('key-elevenlabs').value, '');
  ui.panel.setRunning(true); assert.equal(ui.node('provider-save').disabled, true); assert.equal(ui.node('test-recognition').disabled, true);
  ui.panel.setRunning(false); assert.equal(ui.node('provider-save').disabled, false);
});

test('failed saves keep retry inputs and a provider check sends no key from the form', async () => {
  const ui = await panel({ rejectSave: true }); ui.node('key-elevenlabs').value = 'fixture-private-key';
  await ui.node('provider-form').handlers.submit({ preventDefault() {} });
  assert.equal(ui.node('key-elevenlabs').value, 'fixture-private-key'); assert.match(ui.node('provider-message').textContent, /Could not save/);
  const clean = await panel(); clean.node('key-elevenlabs').value = 'not-yet-saved-key';
  await clean.node('test-recognition').handlers.click(); assert.equal(JSON.stringify(clean.calls.at(-1)).includes('not-yet-saved-key'), false);
});
