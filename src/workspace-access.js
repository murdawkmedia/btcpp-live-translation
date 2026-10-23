import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const fail = (status, message) => Object.assign(Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const accessCode = () => randomBytes(32).toString('base64url');
export const cookieValue = (headers, name) => (headers.get('Cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1);
export const validWorkspaceId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);

export function workspaceSecret(master, id, purpose) {
  if (!/^[a-f0-9]{64}$/i.test(master || '')) throw fail(503, 'Workspace private storage is not configured.');
  return createHmac('sha256', Buffer.from(master, 'hex')).update(`btcpp-workspace-v1:${purpose}:${id}`).digest('hex');
}
export function privateWorkspaceEnv(env, id) {
  return { ...env, PROFILE: 'cloud', ELEVENLABS_API_KEY: undefined, OPENROUTER_API_KEY: undefined, XAI_API_KEY: undefined,
    AI: undefined, STT_PROVIDER: 'elevenlabs', TRANSLATION_PROVIDER: 'openrouter', TTS_PROVIDER: 'none', TRANSLATION_MODEL: undefined,
    ELEVENLABS_VOICE_ID: undefined, XAI_VOICE: undefined,
    STT_URL: env.WORKSPACE_STT_URL, TRANSLATION_BASE_URL: env.WORKSPACE_TRANSLATION_BASE_URL, XAI_BASE_URL: env.WORKSPACE_XAI_BASE_URL,
    OPERATOR_TOKEN: workspaceSecret(env.PROVIDER_SETTINGS_KEY, id, 'operator'), VIEWER_TOKEN: workspaceSecret(env.PROVIDER_SETTINGS_KEY, id, 'viewer'),
    PROVIDER_SETTINGS_KEY: workspaceSecret(env.PROVIDER_SETTINGS_KEY, id, 'settings') };
}

export class WorkspaceAccess {
  constructor(storage) {
    this.storage = storage; this.value = null; this.busy = false;
    this.ready = storage.get().then(value => { this.value = value || null; }).catch(() => { this.problem = 'Workspace access could not be opened.'; });
  }
  authenticate(code, now = Date.now()) {
    if (this.problem || !this.value || typeof code !== 'string' || code.length < 24 || code.length > 128) return null;
    const candidate = hash(code);
    if (same(candidate, this.value.ownerHash)) return { role: 'owner', id: 'owner' };
    const invite = this.value.invites.find(v => v.expiresAt > now && same(candidate, v.hash));
    return invite ? { role: 'operator', id: invite.id, expiresAt: invite.expiresAt } : null;
  }
  info(role) {
    if (!this.value) return null;
    return { name: this.value.name, createdAt: this.value.createdAt, role,
      ...(role === 'owner' ? { invites: this.value.invites.filter(v => v.expiresAt > Date.now()).map(({ id, createdAt, expiresAt }) => ({ id, createdAt, expiresAt })) } : {}) };
  }
  async mutate(action) {
    if (this.busy) throw fail(409, 'Workspace access is busy. Try again shortly.');
    this.busy = true;
    try {
      await this.ready; if (this.problem) throw fail(503, this.problem);
      const { next, result } = action();
      try { await this.storage.put(next); } catch { throw fail(503, 'Workspace access could not be saved. Existing access is unchanged.'); }
      this.value = next; return result;
    } finally { this.busy = false; }
  }
  initialize({ name, ownerCode }) {
    return this.mutate(() => {
      if (this.value) throw fail(409, 'Workspace is already initialized.');
      if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || typeof ownerCode !== 'string' || ownerCode.length < 24 || ownerCode.length > 128) throw fail(400, 'Enter a workspace name of up to 80 characters.');
      return { next: { name: name.trim(), createdAt: Date.now(), ownerHash: hash(ownerCode), invites: [] }, result: { ok: true } };
    });
  }
  issue() {
    return this.mutate(() => {
      if (!this.value) throw fail(404, 'Workspace not found.');
      const invites = this.value.invites.filter(v => v.expiresAt > Date.now());
      if (invites.length >= 8) throw fail(409, 'Revoke an event operator code before creating another.');
      const code = accessCode(), invite = { id: randomUUID(), hash: hash(code), createdAt: Date.now(), expiresAt: Date.now() + 7 * 86400000 };
      return { next: { ...this.value, invites: [...invites, invite] }, result: { code, id: invite.id, expiresAt: invite.expiresAt } };
    });
  }
  revoke(id) {
    return this.mutate(() => {
      if (!this.value) throw fail(404, 'Workspace not found.');
      if (typeof id !== 'string' || !this.value.invites.some(v => v.id === id)) throw fail(404, 'Event operator code not found.');
      return { next: { ...this.value, invites: this.value.invites.filter(v => v.id !== id) }, result: { ok: true } };
    });
  }
  recover() {
    return this.mutate(() => {
      if (!this.value) throw fail(404, 'Workspace not found.');
      const code = accessCode();
      return { next: { ...this.value, ownerHash: hash(code), invites: [] }, result: { code } };
    });
  }
}
