import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the real page handlers; only browser/media/network boundaries are fixtures.
const code = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace("import { chooseAudio } from './capture.js';", '');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function desk({ chooser, ready = true } = {}) {
  const nodes = new Map(), sockets = [], streams = [], captures = [], intervals = []; let now = 100000;
  class Element {
    constructor() { this.disabled = false; this.value = ''; this.children = []; this.handlers = {}; this.dataset = {}; this.classList = { toggle() {} }; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    replaceChildren(...children) { this.children = children; }
    append(child) { this.children.push(child); }
    querySelector(selector) {
      const match = selector.match(/data-id="(\d+)"/);
      return match ? this.children.find(child => Number(child.dataset.id) === Number(match[1])) || null : null;
    }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  node('source').value = 'input'; node('stop').disabled = true;
  class Socket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor() { sockets.push(this); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); }); }
    send(data) {
      this.sent.push(data);
      if (typeof data === 'string' && JSON.parse(data).type === 'start' && ready)
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) }));
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
  }
  const makeCapture = () => {
    const capture = { label: 'Fixture speech input', stopped: 0,
      async connect(onFrame, onLevel) { this.frame = onFrame; onLevel(0.4); onFrame(new ArrayBuffer(3200)); },
      async stop() { this.stopped++; } };
    captures.push(capture); return capture;
  };
  const config = { liveReady: true, topics: ['privacy'], languages: [{ code: 'ko', name: 'Korean', native: '한국어' }], targetLanguage: 'ko',
    providers: { recognition: 'fixture', translation: 'fixture', speech: 'fixture' }, qr: '', viewerUrl: '/listen', publicReady: true, termCount: 345, phase: 'idle', mode: 'idle', history: [] };
  const sandbox = { document: { getElementById: node, createElement: () => new Element() },
    window: { addEventListener() {} }, location: { protocol: 'https:', host: 'fixture.invalid' },
    WebSocket: Socket, EventSource: class { constructor() { streams.push(this); } close() {} },
    chooseAudio: chooser ? () => chooser(makeCapture) : async () => makeCapture(),
    fetch: async path => ({ ok: true, json: async () => path === '/api/health' ? { operatorAuthenticated: true } : path === '/api/config' ? config : path === '/api/terms' ? { terms: [] } : { ok: true } }),
    AbortSignal, setTimeout, clearTimeout, setInterval: callback => { intervals.push(callback); return intervals.length; }, clearInterval() {},
    Date: class extends Date { static now() { return now; } }, navigator: {}, console };
  vm.runInNewContext(code, sandbox, { filename: 'app.js' });
  await tick();
  return { node, sockets, captures, config,
    advance: ms => { now += ms; }, poll: async () => { for (const callback of intervals) await callback(); },
    click: id => node(id).disabled ? undefined : node(id).handlers.click?.({}),
    emit: event => streams[0].onmessage({ data: JSON.stringify(event) }),
    disconnect: () => streams[0].onerror() };
}

test('live audio enables Stop and ON AIR without waiting for server-status SSE', async () => {
  const ui = await desk();
  await ui.click('start');
  assert.ok(ui.node('meter').value > 0);
  assert.equal(ui.node('stop').disabled, false, 'A working local capture must always be stoppable');
  assert.equal(ui.node('status').textContent, 'ON AIR');
  await ui.click('stop');
  assert.equal(ui.captures[0].stopped, 1);
  assert.equal(ui.node('meter').value, 0);
});

test('a delayed idle snapshot cannot disable Stop during live audio capture', async () => {
  const ui = await desk(); await ui.click('start');
  ui.emit({ type: 'snapshot', ...ui.config, history: [] });
  assert.equal(ui.node('stop').disabled, false);
  assert.equal(ui.node('status').textContent, 'ON AIR');
  ui.disconnect();
  assert.equal(ui.node('stop').disabled, false);
  await ui.click('stop');
});

test('Stop cancels a pending audio chooser and closes a late result', async () => {
  let resolveChoice, make;
  const ui = await desk({ chooser: factory => { make = factory; return new Promise(resolve => { resolveChoice = resolve; }); } });
  const starting = ui.click('start');
  assert.equal(ui.node('stop').disabled, false);
  await ui.click('stop');
  const late = make(); resolveChoice(late); await starting;
  assert.equal(late.stopped, 1);
  assert.equal(ui.sockets.length, 0);
  assert.equal(ui.node('stop').disabled, true);
});

test('Stop cancels a connecting socket before its ready message', async () => {
  const ui = await desk({ ready: false });
  const starting = ui.click('start'); await tick();
  assert.equal(ui.node('stop').disabled, false);
  await ui.click('stop'); await starting;
  assert.equal(ui.sockets[0].readyState, 3);
  assert.equal(ui.captures[0].stopped, 1);
});

test('soundcheck stays stoppable and clearly identifies its local-only purpose', async () => {
  const ui = await desk(); await ui.click('soundcheck');
  assert.equal(ui.node('stop').disabled, false);
  assert.equal(ui.node('status').textContent, 'SOUNDCHECK');
  assert.match(ui.node('notice').textContent, /check|soundcheck/i);
  assert.equal(ui.sockets.length, 0);
  await ui.click('stop');
  assert.equal(ui.captures[0].stopped, 1);
});

test('a lost status stream recovers captions from snapshots without duplicates', async () => {
  const ui = await desk(); await ui.click('start'); ui.disconnect();
  ui.config.phase = 'live'; ui.config.mode = 'live';
  ui.config.history = [{ id: 1, english: 'Bitcoin.', translated: '비트코인.', language: 'ko', processingMs: 900 }];
  ui.advance(6000); await ui.poll();
  assert.equal(ui.node('captions').children.length, 1);
  assert.equal(ui.node('stop').disabled, false);
  ui.advance(3000); await ui.poll();
  assert.equal(ui.node('captions').children.length, 1);
  await ui.click('stop');
});

test('snapshot recovery releases finishing controls when no status events arrive', async () => {
  const ui = await desk(); await ui.click('start'); await ui.click('stop');
  ui.config.phase = 'idle'; ui.config.mode = 'live';
  ui.advance(6000); await ui.poll();
  assert.equal(ui.node('stop').disabled, true);
  assert.equal(ui.node('start').disabled, false);
});

test('a new local session clears old caption IDs even when its reset event is lost', async () => {
  const ui = await desk(); await ui.click('start');
  ui.config.phase = 'live'; ui.config.mode = 'live';
  ui.config.history = [{ id: 1, english: 'Old sentence.', translated: '이전 문장.', processingMs: 800 }];
  ui.advance(6000); await ui.poll(); await ui.click('stop');
  ui.config.phase = 'idle'; ui.advance(3000); await ui.poll();
  assert.match(ui.node('notice').textContent, /stopped/i);
  await ui.click('start');
  ui.config.phase = 'live'; ui.config.history = [{ id: 1, english: 'New sentence.', translated: '새 문장.', processingMs: 800 }];
  ui.advance(6000); await ui.poll();
  assert.equal(ui.node('captions').children.length, 1);
  assert.equal(ui.node('captions').children[0].children[0].textContent, 'New sentence.');
  await ui.click('stop');
});
