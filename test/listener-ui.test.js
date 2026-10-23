import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = (await readFile(new URL('../public/workspace.js', import.meta.url), 'utf8')).replaceAll('export function ', 'function ') + '\n' + (await readFile(new URL('../public/listen.js', import.meta.url), 'utf8')).replace("import { scopedUrl } from './workspace.js';", '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const segment = (text = '비트코인.', id = 1) => ({ id, english: 'Bitcoin.', translated: text, language: 'ko', createdAt: 100000, audioReady: false });
async function phone(initial = {}, pathname = '/listen') {
  const nodes = new Map(), streams = [], intervals = [], requests = [], windowHandlers = {}, saved = new Map(); let now = 100000, status = 200, pending;
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.handlers = {}; this.disabled = false; this.value = ''; this.textContent = ''; this.classes = new Set(); this.classList = { add: s => this.classes.add(s), remove: s => this.classes.delete(s), toggle: (s, yes) => yes ? this.classes.add(s) : this.classes.delete(s) }; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    replaceChildren(...children) { this.children = children; }
    append(child) { this.children.push(child); }
    prepend(child) { this.children.unshift(child); child.parent = this; }
    get lastElementChild() { return this.children.at(-1); }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    querySelector(selector) { const match = selector.match(/data-id="(\d+)"/); return match ? this.children.find(child => Number(child.dataset.id) === Number(match[1])) : this.children.find(child => child.className === 'empty'); }
    pause() { this.paused = true; }
    load() {}
    removeAttribute(name) { delete this[name]; }
    async play() { this.plays = (this.plays || 0) + 1; this.paused = false; }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const snapshot = { type: 'snapshot', sessionId: 'session-a', mode: 'live', phase: 'live', targetLanguage: 'ko', stage: 'Main Stage', direction: 'English → Korean', history: [segment()], ...initial };
  const sandbox = { document: { getElementById: node, createElement: () => new Element(), querySelector: node, body: node('body'), documentElement: node('html') },
    location: { search: '?token=viewer-fixture-only', pathname }, navigator: { language: 'en-CA' }, localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    URL, URLSearchParams, Blob, DataView, ArrayBuffer, AbortSignal, AbortController, console,
    Date: class extends Date { static now() { return now; } },
    window: { addEventListener: (name, handler) => { windowHandlers[name] = handler; } },
    EventSource: class { constructor(url) { this.url = url; streams.push(this); } close() { this.closed = true; } },
    fetch: async (path, options) => { requests.push({ path, options }); if (pending) return pending; return { ok: status === 200, status, json: async () => structuredClone(snapshot) }; },
    setTimeout, clearTimeout, setInterval: callback => { intervals.push(callback); return intervals.length; }, clearInterval() {} };
  vm.runInNewContext(code, sandbox, { filename: 'listen.js' }); await tick();
  return { node, snapshot, requests, streams, saved, advance: ms => { now += ms; }, poll: async () => { for (const callback of intervals) await callback(); await tick(); },
    click: async id => { if (!node(id).disabled) await node(id).handlers.click?.(); },
    locale: async value => { node('ui-language').value = value; await node('ui-language').handlers.change?.(); },
    emit: event => streams[0].onmessage({ data: JSON.stringify(event) }), disconnect: () => streams[0].onerror(),
    response: value => { status = value; }, defer: () => { let resolve; pending = new Promise(r => { resolve = r; }); return resolve; }, hide: () => windowHandlers.pagehide() };
}

test('failed translation clears provisional Korean and retains English', async () => {
  const ui = await phone();
  ui.emit({ type: 'caption-draft', segment: { id: 1, english: 'Bitcoin', translated: '일부', provisional: true } });
  ui.emit({ type: 'caption-draft', segment: { id: 1, english: 'Bitcoin', failed: true } });
  const row = ui.node('captions').children[0];
  assert.notEqual(row.children[0].textContent, '일부'); assert.equal(row.children[1].textContent, 'Bitcoin');
  assert.equal(row.dataset.provisional, undefined); assert.equal(row.dataset.failed, 'true');
});

test('live Korean drafts revise immediately and older final captions cannot erase newer draft text', async () => {
  const ui = await phone(); await ui.locale('en');
  ui.emit({ type: 'draft', draft: { id: 1, revision: 1, english: 'New speech', translated: '새 발언', language: 'ko' } });
  assert.equal(ui.node('live-draft').hidden, false); assert.equal(ui.node('draft-translated').textContent, '새 발언');
  assert.equal(ui.node('english-partial').textContent, 'New speech');
  ui.emit({ type: 'caption', segment: segment('Earlier final.', 1) });
  assert.equal(ui.node('english-partial').textContent, 'New speech');
  ui.emit({ type: 'draft', draft: null }); assert.equal(ui.node('live-draft').hidden, true);
});

test('draft snapshots recover without SSE and off-air status clears them', async () => {
  const ui = await phone({ draft: { id: 1, english: 'Bitcoin', translated: '비트코인', language: 'ko' } });
  assert.equal(ui.node('draft-translated').textContent, '비트코인'); assert.equal(ui.node('live-draft').hidden, false);
  ui.emit({ type: 'status', ...ui.snapshot, phase: 'idle' });
  assert.equal(ui.node('live-draft').hidden, true); assert.equal(ui.node('english-partial').textContent, '');
});

test('streaming final-caption tokens update the same row until completion', async () => {
  const ui = await phone();
  ui.emit({ type: 'caption-draft', segment: { ...segment('비트'), provisional: true } });
  assert.equal(ui.node('captions').children[0].children[0].textContent, '비트');
  assert.equal(ui.node('captions').children[0].dataset.provisional, 'true');
  ui.emit({ type: 'caption', segment: segment('비트코인입니다.') });
  assert.equal(ui.node('captions').children.length, 1); assert.equal(ui.node('captions').children[0].dataset.provisional, undefined);
});

test('a fresh attendee opens captions without login or a working event stream', async () => {
  const ui = await phone();
  assert.equal(ui.node('status').textContent, 'LIVE');
  assert.equal(ui.node('captions').children[0]?.children[0]?.textContent, '비트코인.');
  assert.match(ui.requests[0]?.path, /^\/api\/listener\?token=/);
  assert.equal(ui.node('audio').plays || 0, 0, 'Captions start without requiring an audio gesture');
});

test('waiting phones join automatically and clear captions and audio when the stage stops', async () => {
  const ui = await phone({ phase: 'idle', history: [segment('Old caption.')] });
  assert.equal(ui.node('captions').children.some(child => child.dataset.id), false);
  assert.equal(ui.node('listen').disabled, true);
  ui.snapshot.phase = 'live'; ui.advance(6000); await ui.poll();
  assert.equal(ui.node('status').textContent, 'LIVE'); assert.equal(ui.node('listen').disabled, false);
  await ui.click('listen');
  ui.emit({ type: 'audio', id: 1, createdAt: 100000 });
  ui.emit({ type: 'status', ...ui.snapshot, history: undefined, phase: 'idle' });
  assert.equal(ui.node('captions').children.some(child => child.dataset.id), false);
  assert.equal(ui.node('audio').paused, true); assert.equal(ui.node('listen').disabled, true);
  const plays = ui.node('audio').plays;
  ui.emit({ type: 'caption', segment: segment('Late caption.') }); ui.emit({ type: 'audio', id: 2, createdAt: 100000 });
  assert.equal(ui.node('captions').children.some(child => child.dataset.id), false); assert.equal(ui.node('audio').plays, plays);
});

test('lost reset events cannot retain old caption IDs across sessions', async () => {
  const ui = await phone();
  ui.snapshot.sessionId = 'session-b'; ui.snapshot.history = [segment('새 문장.')]; ui.advance(6000); await ui.poll();
  assert.equal(ui.node('captions').children.length, 1);
  assert.equal(ui.node('captions').children[0].children[0].textContent, '새 문장.');
});

test('interface language changes no shared captions, stream or stage configuration', async () => {
  const ui = await phone(); const before = ui.node('captions').children[0]; const requests = ui.requests.length;
  for (const value of ['ko', 'ja', 'es', 'fr', 'zh', 'en']) {
    await ui.locale(value);
    assert.equal(ui.node('html').lang, value); assert.equal(ui.node('captions').children[0], before);
  }
  assert.equal(ui.requests.length, requests); assert.equal(ui.streams.length, 1);
  assert.equal(ui.node('listen').textContent, '▶ Listen to translation');
});

test('snapshot recovery never repeats an already played audio segment', async () => {
  const ui = await phone({ history: [{ ...segment(), audioReady: true }] }); await ui.click('listen');
  ui.node('audio').onended(); const plays = ui.node('audio').plays;
  ui.advance(6000); await ui.poll(); ui.advance(3000); await ui.poll();
  assert.equal(ui.node('audio').plays, plays);
  assert.equal(ui.node('captions').children.length, 1);
});

test('invalid attendee access is explained instead of silently reconnecting forever', async () => {
  const ui = await phone(); ui.response(401); ui.advance(6000); await ui.poll();
  assert.match(ui.node('notice').textContent, /link|QR/i);
  assert.equal(ui.node('listen').disabled, true);
  assert.equal(ui.node('captions').children.some(child => child.dataset.id), false);
});

test('a delayed snapshot cannot restore captions after a newer stop event', async () => {
  const ui = await phone(); const resolve = ui.defer(); ui.advance(6000); const poll = ui.poll(); await tick();
  ui.emit({ ...ui.snapshot, type: 'status', phase: 'idle', history: undefined });
  resolve({ ok: true, status: 200, json: async () => structuredClone(ui.snapshot) }); await poll;
  assert.equal(ui.node('status').textContent, 'WAITING');
  assert.equal(ui.node('captions').children.some(child => child.dataset.id), false);
});

test('English transcription appears before translation and merges into the same caption', async () => {
  const ui = await phone({ history: [] });
  ui.node('caption-view').value = 'en'; await ui.node('caption-view').handlers.change?.();
  ui.emit({ type: 'transcript', segment: { id: 1, english: 'Taproot improves Bitcoin.', createdAt: 100000 } });
  assert.equal(ui.node('captions').children[0]?.children[1]?.textContent, 'Taproot improves Bitcoin.');
  ui.emit({ type: 'caption', segment: { ...segment(), english: 'Taproot improves Bitcoin.' } });
  assert.equal(ui.node('captions').children.length, 1);
  assert.equal(ui.node('captions').children[0].children[0].textContent, '비트코인.');
});

test('a recognition gap warns attendees without stopping caption delivery', async () => {
  const ui = await phone();
  ui.emit({ type: 'issue', stage: 'recognition', message: 'Recognition is catching up. Some earlier speech may be missing.' });
  assert.match(ui.node('notice').textContent, /speech.*missing/i);
  ui.emit({ type: 'caption', segment: segment('계속합니다.', 2) });
  assert.equal(ui.node('captions').children.length, 2);
});

test('workspace attendee snapshots, event streams and audio stay scoped', async () => {
  const id = 'b'.repeat(32), prefix = `/w/${id}`;
  const ui = await phone({}, prefix + '/listen');
  assert.ok(ui.requests[0].path.startsWith(prefix + '/api/listener'));
  assert.ok(ui.streams[0].url.startsWith(prefix + '/api/events'));
  await ui.click('listen'); ui.emit({ type: 'audio', id: 1, createdAt: 100000 });
  ui.node('audio').onended();
  await tick(); assert.ok(ui.node('audio').src.startsWith(prefix + '/api/audio/'));
});
