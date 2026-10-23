import { Buffer } from 'node:buffer';
import { providerStatus } from './config.js';

const bad = message => Object.assign(Error(message), { status: 400 });
const defaults = { local: 'qwen3:8b', 'workers-ai': '@cf/qwen/qwen3-30b-a3b-fp8', openrouter: 'google/gemini-2.5-flash', xai: 'grok-4.7' };
const credentials = { elevenlabs: 'elevenKey', openrouter: 'openrouterKey', xai: 'xaiKey' };
const choices = ['sttProvider', 'translationProvider', 'ttsProvider', 'translationModel', 'elevenVoice', 'voice'];
const encoder = new TextEncoder(), aad = encoder.encode('btcpp-provider-settings-v1');

export function secureProviderOrigin(origin) {
  try { const url = new URL(origin); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)); }
  catch { return false; }
}

export class ProviderSettings {
  constructor(base, { storage, key } = {}) {
    this.base = { ...base }; this.storage = storage; this.key = key; this.overrides = {}; this.busy = false;
    this.config = this.resolve({});
    this.ready = this.load().catch(() => { this.problem = 'Private provider settings could not be opened. Restore the settings encryption key before going live.'; });
  }
  options() {
    const local = this.base.localSttUrl ? ['local'] : [];
    const cloud = this.base.runAI || this.base.sttProvider === 'workers-ai' ? ['workers-ai'] : [];
    return { sttProvider: [...local, ...cloud, 'elevenlabs', 'xai'], translationProvider: [...local, ...cloud, 'openrouter', 'xai'], ttsProvider: ['none', ...local, ...cloud, 'elevenlabs', 'xai'] };
  }
  resolve(value) {
    const result = { ...this.base, ...Object.fromEntries(choices.filter(k => value[k] !== undefined).map(k => [k, value[k]])) };
    result.sttProvider ||= 'xai'; result.translationProvider ||= 'xai'; result.ttsProvider ||= 'xai';
    result.translationModel ||= defaults[result.translationProvider];
    for (const [name, field] of Object.entries(credentials)) if (value.keys?.[name]) result[field] = value.keys[name];
    if (value.translationProvider && value.translationProvider !== this.base.translationProvider) {
      result.translationModel = value.translationModel || defaults[value.translationProvider];
      result.translationBase = value.translationProvider === 'local' ? this.base.translationBase : undefined;
    }
    return result;
  }
  validate(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => ![...choices, 'keys'].includes(k))) throw bad('Unsupported provider setting');
    const next = { ...this.overrides, keys: { ...this.overrides.keys } }, options = this.options();
    for (const field of choices) if (Object.hasOwn(patch, field)) {
      const value = patch[field];
      if (options[field]) { if (!options[field].includes(value)) throw bad('Unsupported provider selection'); }
      else if (typeof value !== 'string' || value.length > 160 || (value && !(field === 'translationModel' ? /^[a-zA-Z0-9@._:/-]+$/ : /^[a-zA-Z0-9_-]+$/).test(value)) || value.includes('://')) throw bad('Invalid model or voice identifier');
      next[field] = value;
    }
    if (patch.translationProvider && patch.translationProvider !== this.config.translationProvider && !Object.hasOwn(patch, 'translationModel')) next.translationModel = defaults[patch.translationProvider];
    if (!this.resolve(next).translationModel) throw bad('A translation model is required');
    if (patch.keys !== undefined) {
      if (!patch.keys || typeof patch.keys !== 'object' || Array.isArray(patch.keys) || Object.keys(patch.keys).some(k => !Object.hasOwn(credentials, k))) throw bad('Unsupported credential');
      for (const [name, value] of Object.entries(patch.keys)) {
        if (value === null) { delete next.keys[name]; continue; }
        if (typeof value !== 'string' || value.length > 2048 || (value.trim() && !/^[\x21-\x7e]{8,2048}$/.test(value.trim()))) throw bad('Invalid API key format');
        if (value.trim()) next.keys[name] = value.trim();
      }
    }
    return next;
  }
  async cryptoKey() {
    if (!/^[a-f0-9]{64}$/i.test(this.key || '')) throw Error('Private settings storage is not configured');
    return crypto.subtle.importKey('raw', Buffer.from(this.key, 'hex'), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async load() {
    const saved = await this.storage?.get(); if (!saved) return;
    if (saved.version !== 1 || typeof saved.iv !== 'string' || typeof saved.ciphertext !== 'string') throw Error('Invalid private settings');
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(saved.iv, 'base64'), additionalData: aad }, await this.cryptoKey(), Buffer.from(saved.ciphertext, 'base64'));
    this.overrides = this.validate(JSON.parse(new TextDecoder().decode(data))); this.config = this.resolve(this.overrides);
  }
  snapshot() {
    return { available: !this.problem, problem: this.problem || null, persistent: Boolean(this.storage && /^[a-f0-9]{64}$/i.test(this.key || '')), busy: this.busy,
      ...Object.fromEntries(choices.map(k => [k, this.config[k] || (k === 'voice' ? 'eve' : '')])),
      sttProvider: this.config.sttProvider || 'xai', translationProvider: this.config.translationProvider || 'xai', ttsProvider: this.config.ttsProvider || 'xai',
      keys: Object.fromEntries(Object.entries(credentials).map(([name, field]) => [name, { configured: Boolean(this.config[field]), source: this.overrides.keys?.[name] ? 'saved' : this.base[field] ? 'environment' : 'missing' }])),
      providers: providerStatus(this.config), options: this.options(), models: defaults };
  }
  async withLock(action) {
    if (this.busy) throw Object.assign(Error('Provider settings are busy. Try again shortly.'), { status: 409 });
    this.busy = true;
    try {
      await this.ready;
      if (this.problem) throw Object.assign(Error(this.problem), { status: 503 });
      return await action();
    } finally { this.busy = false; }
  }
  async update(patch) {
    await this.withLock(async () => {
      const next = this.validate(patch);
      if (!this.storage || !this.snapshot().persistent) throw Object.assign(Error('Private settings storage is not configured. Configure the server encryption key first.'), { status: 503 });
      try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await this.cryptoKey(), encoder.encode(JSON.stringify(next)));
        await this.storage.put({ version: 1, iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(encrypted).toString('base64') });
      } catch { throw Object.assign(Error('Private settings could not be saved. The previous configuration is still active.'), { status: 503 }); }
      this.overrides = next; this.config = this.resolve(next);
    });
    return this.snapshot();
  }
}
