import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderSettings } from '../src/provider-settings.js';
import { ProviderConnect } from '../src/provider-connect.js';
import { createHash } from 'node:crypto';
const setup = () => {
 let encrypted;
 const settings = new ProviderSettings({ sttProvider: 'elevenlabs', translationProvider: 'xai', ttsProvider: 'none', xaiKey: 'fixture-xai-only' }, { key: '12'.repeat(32), storage: { get: () => encrypted, put: value => { encrypted = value; } } });
 return { settings, connect: new ProviderConnect(settings), encrypted: () => encrypted };
};
test('OpenRouter connects through official S256 PKCE and saves only an encrypted workspace key', async t => {
 const { settings, connect, encrypted } = setup(); await settings.ready;
 const begun = await connect.begin('https://fixture.invalid/w/' + 'ab'.repeat(16) + '/', 'owner-fixture');
 const url = new URL(begun.url); assert.equal(url.origin, 'https://openrouter.ai'); assert.equal(url.pathname, '/auth');
 assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.match(url.searchParams.get('state'), /^[a-zA-Z0-9_-]{40,}$/);
 let called = 0;
 t.mock.method(globalThis, 'fetch', async (endpoint, options) => {
  called++; assert.equal(endpoint, 'https://openrouter.ai/api/v1/auth/keys'); const body = JSON.parse(options.body);
  assert.equal(body.code, 'fixture-code'); assert.equal(body.code_challenge_method, 'S256');
  assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  return Response.json({ key: 'fixture-private-openrouter-key' });
 });
 const result = await connect.finish({ state: url.searchParams.get('state'), code: 'fixture-code' }, 'owner-fixture');
 assert.equal(called, 1); assert.equal(settings.config.openrouterKey, 'fixture-private-openrouter-key');
 assert.equal(settings.config.translationProvider, 'xai'); assert.equal(settings.config.xaiKey, 'fixture-xai-only');
 assert.equal(JSON.stringify(result).includes('fixture-private-openrouter-key'), false); assert.equal(JSON.stringify(encrypted()).includes('fixture-private-openrouter-key'), false);
 await assert.rejects(connect.finish({ state: url.searchParams.get('state'), code: 'fixture-code' }, 'owner-fixture'));
});
test('foreign owners, expired state and changed settings cannot complete a connection', async t => {
 t.mock.timers.enable({ apis: ['Date'] }); const { settings, connect } = setup(); await settings.ready;
 const begin = async owner => new URL((await connect.begin('https://fixture.invalid/', owner)).url).searchParams.get('state');
 const state = await begin('owner-a'); await assert.rejects(connect.finish({ state, code: 'fixture-code' }, 'owner-b'));
 const expired = await begin('owner-a'); t.mock.timers.tick(601000); await assert.rejects(connect.finish({ state: expired, code: 'fixture-code' }, 'owner-a'));
 const stale = await begin('owner-a'); await settings.update({ voice: 'rex' }); await assert.rejects(connect.finish({ state: stale, code: 'fixture-code' }, 'owner-a'));
 await assert.rejects(connect.begin('https://fixture.invalid/other-path', 'owner-a'));
});
test('connection attempts are bounded and upstream errors never echo codes or secrets', async t => {
 const { settings, connect } = setup(); await settings.ready;
 for (let i=0;i<4;i++) await connect.begin('https://fixture.invalid/', 'owner-a');
 await assert.rejects(connect.begin('https://fixture.invalid/', 'owner-a'), /pending|limit/i);
 const other=setup();await other.settings.ready;const state=new URL((await other.connect.begin('http://localhost:4317/','owner-a')).url).searchParams.get('state');
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'private-upstream-response'},{status:400}));
 await assert.rejects(other.connect.finish({state,code:'private-code'},'owner-a'), e=>!e.message.includes('private-'));
});
