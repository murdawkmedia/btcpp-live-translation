import test from 'node:test';
import assert from 'node:assert/strict';
const { WorkspaceAccess, privateWorkspaceEnv, workspaceSecret } = await import('../src/workspace-access.js').catch(() => ({}));
const master = 'ab'.repeat(32), owner = 'fixture-owner-access-code-1234567890';
function store() { let value; return { get: async () => value, put: async next => { value = structuredClone(next); }, read: () => value }; }

test('workspace access persists only code hashes and isolates owner/operator rights', async () => {
  assert.equal(typeof WorkspaceAccess, 'function');
  const storage = store(), access = new WorkspaceAccess(storage); await access.ready;
  await access.initialize({ name: 'Team rehearsal', ownerCode: owner });
  assert.equal(access.authenticate(owner)?.role, 'owner'); assert.equal(access.authenticate('another-owner-code'), null);
  const invite = await access.issue(); assert.equal(access.authenticate(invite.code)?.role, 'operator');
  assert.equal(JSON.stringify(storage.read()).includes(owner), false); assert.equal(JSON.stringify(storage.read()).includes(invite.code), false);
  assert.equal(JSON.stringify(access.info('owner')).includes('hash'), false);
  assert.equal(access.info('operator').invites, undefined);
  const restored = new WorkspaceAccess(storage); await restored.ready; assert.equal(restored.authenticate(owner)?.role, 'owner');
  await restored.revoke(invite.id); assert.equal(restored.authenticate(invite.code), null);
});

test('owner recovery invalidates old owner/operator codes and does not expose old codes', async () => {
  const storage = store(), access = new WorkspaceAccess(storage); await access.ready;
  await access.initialize({ name: 'Event stage', ownerCode: owner });
  const invite = await access.issue(); const recovered = await access.recover();
  assert.equal(access.authenticate(owner), null); assert.equal(access.authenticate(invite.code), null);
  assert.equal(access.authenticate(recovered.code)?.role, 'owner');
  assert.equal(JSON.stringify(storage.read()).includes(recovered.code), false);
});

test('invites expire and failed persistence never silently changes active access', async () => {
  const storage = store(), access = new WorkspaceAccess(storage); await access.ready;
  await access.initialize({ name: 'Event', ownerCode: owner }); const invite = await access.issue();
  assert.equal(access.authenticate(invite.code, Date.now() + 8 * 86400000), null);
  storage.put = async () => { throw Error('private-storage-error'); };
  await assert.rejects(access.revoke(invite.id), e => !e.message.includes('private-storage-error'));
  assert.equal(access.authenticate(invite.code)?.role, 'operator');
});

test('personal workspaces never inherit admin API keys or Cloudflare AI access', () => {
  const env = { PROVIDER_SETTINGS_KEY: master, OPERATOR_TOKEN: owner, VIEWER_TOKEN: 'default-viewer', ELEVENLABS_API_KEY: 'root-eleven-private', OPENROUTER_API_KEY: 'root-router-private', XAI_API_KEY: 'root-xai-private', AI: {}, TRANSLATION_MODEL: '@cf/qwen/fixture', STT_URL: 'https://private-root.invalid', TRANSLATION_BASE_URL: 'https://private-root.invalid', XAI_BASE_URL: 'https://private-root.invalid', ELEVENLABS_VOICE_ID: 'root-voice' };
  const a = privateWorkspaceEnv(env, 'workspace-a'), b = privateWorkspaceEnv(env, 'workspace-b');
  assert.notEqual(a.PROVIDER_SETTINGS_KEY, b.PROVIDER_SETTINGS_KEY); assert.notEqual(a.VIEWER_TOKEN, b.VIEWER_TOKEN);
  assert.notEqual(a.OPERATOR_TOKEN, owner); assert.equal(a.AI, undefined);
  for (const key of ['ELEVENLABS_API_KEY', 'OPENROUTER_API_KEY', 'XAI_API_KEY']) assert.equal(a[key], undefined);
  assert.equal(a.STT_PROVIDER, 'elevenlabs'); assert.equal(a.TRANSLATION_PROVIDER, 'openrouter'); assert.equal(a.TTS_PROVIDER, 'none');
  assert.equal(a.TRANSLATION_MODEL, undefined); assert.equal(workspaceSecret(master, 'workspace-a', 'viewer'), a.VIEWER_TOKEN);
  for (const field of ['STT_URL', 'TRANSLATION_BASE_URL', 'XAI_BASE_URL', 'ELEVENLABS_VOICE_ID']) assert.equal(a[field], undefined);
});
