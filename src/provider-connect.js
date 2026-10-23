import { createHash, randomBytes } from 'node:crypto';
import { secureProviderOrigin } from './provider-settings.js';
import { bytes } from './http-provider.js';
const fail = (status, message) => Object.assign(Error(message), { status });
const digest = value => createHash('sha256').update(value).digest('base64url');
const fingerprint = settings => digest(JSON.stringify(settings.overrides));

// Pending verifiers are server-only, short lived and never part of a snapshot.
export class ProviderConnect {
 constructor(settings) { this.settings = settings; this.pending = new Map(); }
 clean() { for (const [id, value] of this.pending) if (value.expires <= Date.now()) this.pending.delete(id); }
 async begin(callback, owner) {
  await this.settings.ready; this.clean();
  const url = new URL(callback);
  if (!secureProviderOrigin(url.origin) || !/^\/(?:w\/[a-f0-9]{32}\/)?$/.test(url.pathname) || url.search || url.hash || url.username || url.password || !owner) throw fail(400, 'Invalid provider callback.');
  if (!this.settings.snapshot().persistent || this.settings.problem) throw fail(503, 'Private provider storage must be available before connecting.');
  if (this.pending.size >= 4) throw fail(429, 'Too many pending connections. Retry after ten minutes.');
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  this.pending.set(state, { verifier, owner: digest(owner), fingerprint: fingerprint(this.settings), expires: Date.now() + 600000 });
  const auth = new URL('https://openrouter.ai/auth');
  auth.search = new URLSearchParams({ callback_url: url.href, code_challenge: digest(verifier), code_challenge_method: 'S256', state, key_label: 'Bitcoin++ live translation' });
  return { url: auth.href };
 }
 async finish(body, owner) {
  this.clean();
  const attempt = this.pending.get(body.state);
  if (!attempt || attempt.owner !== digest(owner || '') || attempt.fingerprint !== fingerprint(this.settings)) throw fail(400, 'Connection expired or changed. Connect OpenRouter again.');
  if (typeof body.code !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(body.code)) throw fail(400, 'Invalid connection code. Connect OpenRouter again.');
  this.pending.delete(body.state);
  let key;
  try {
   key = await this.settings.withLock(async () => {
    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
     body: JSON.stringify({ code: body.code, code_verifier: attempt.verifier, code_challenge_method: 'S256' }) });
    const value = JSON.parse((await bytes(response, 16384)).toString());
    if (typeof value.key !== 'string' || !/^[\x21-\x7e]{8,2048}$/.test(value.key)) throw Error('Invalid credential');
    return value.key;
   });
  } catch { throw fail(400, 'OpenRouter connection failed. Connect again; existing keys are unchanged.'); }
  return this.settings.update({ keys: { openrouter: key } });
 }
}
