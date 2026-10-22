import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { once } from 'node:events';

const base = process.env.VERIFY_ORIGIN || 'http://127.0.0.1:4318';
const token = process.env.VERIFY_OPERATOR_TOKEN;
assert.ok(token, 'Set VERIFY_OPERATOR_TOKEN privately');
const page = await fetch(base + '/'); assert.equal(page.status, 200); assert.match(await page.text(), /Translation desk/);
const request = (path, body, cookie, origin = base) => fetch(base + path, { method: body ? 'POST' : 'GET',
  headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}) });
assert.equal((await request('/api/rehearsal', {})).status, 401);
assert.equal((await request('/api/login', { token }, '', 'https://untrusted.invalid')).status, 403);
const login = await request('/api/login', { token }); assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
assert.match(login.headers.get('set-cookie'), /HttpOnly/);
const config = await (await request('/api/config', null, cookie)).json();
assert.equal(config.termCount, 345); assert.ok(config.languages.some(x => x.code === 'ko'));
assert.equal((await request('/api/settings', { targetLanguage: 'invalid' }, cookie)).status, 400);
assert.equal((await request('/api/settings', { targetLanguage: 'fr' }, cookie)).status, 200);
const viewer = new URL(config.viewerUrl).searchParams.get('token');
const stream = await request(`/api/events?token=${encodeURIComponent(viewer)}`);
assert.equal(stream.status, 200); const reader = stream.body.getReader();
assert.equal((await request('/api/rehearsal', {}, cookie)).status, 202);
assert.equal((await request('/api/settings', { targetLanguage: 'fr' }, cookie)).status, 409);
let text = ''; const deadline = AbortSignal.timeout(15000);
while (!text.includes('"type":"audio"')) {
  const data = await Promise.race([reader.read(), new Promise((_, reject) => deadline.addEventListener('abort', () => reject(Error('SSE deadline')), { once: true }))]);
  text += new TextDecoder().decode(data.value);
}
assert.match(text, /비트코인/);
const audio = await request(`/api/audio/1?token=${encodeURIComponent(viewer)}`);
assert.equal(audio.status, 200); assert.equal(Buffer.from(await audio.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
assert.equal((await request('/api/audio/1')).status, 401);
await reader.cancel(); await request('/api/stop', {}, cookie);
const denied = await new Promise(resolve => {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/capture', { headers: { Origin: base, Cookie: `btcpp_operator=${viewer}` } });
  ws.on('unexpected-response', (_, response) => { response.resume(); resolve(response.statusCode); ws.terminate(); }); ws.on('error', () => {});
});
assert.equal(denied, 401);
console.log('PASS: authenticated settings, capability separation, origins, SSE captions, shared audio and stop');
