import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { terms, topics, selectHints } from './glossary.js';
import { Pipeline } from './pipeline.js';
import { createLiveProvider, connectTranscriber } from './providers.js';
import { createRehearsalProvider, samples } from './rehearsal.js';
import { providerStatus } from './config.js';
import { languages, language } from './languages.js';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status, message) => Object.assign(Error(message), { status });
const staticFiles = new Map(['index.html', 'listen.html', 'app.js', 'listen.js', 'styles.css', 'capture.js', 'pcm-worklet.js', 'audio-core.js'].map(name => ['/' + name, name]));
const mime = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

export function createApp(config = {}) {
  const operatorToken = config.operatorToken || randomBytes(32).toString('hex');
  const viewerToken = config.viewerToken || randomBytes(24).toString('hex');
  const providers = providerStatus(config), liveReady = providers.ready;
  let targetLanguage = config.targetLanguage || 'ko';
  const subscribers = new Set();
  let pipeline, active = null, mode = 'idle', phase = 'idle', closed = false;
  const operator = req => same((req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('btcpp_operator='))?.slice(15), operatorToken);
  const viewer = (req, url) => operator(req) || same(url.searchParams.get('token'), viewerToken);
  const originAllowed = req => {
    try {
      const origin = new URL(req.headers.origin);
      return origin.host === req.headers.host || (config.publicBaseUrl && origin.origin === new URL(config.publicBaseUrl).origin);
    } catch { return false; }
  };
  const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const state = () => ({ mode, phase, listeners: subscribers.size, history: pipeline?.history || [],
    queue: pipeline?.queue.length || 0, name: config.eventName || 'Bitcoin++', stage: config.stageName || 'Main Stage',
    targetLanguage, direction: `English → ${language(targetLanguage).name}` });
  const broadcast = event => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of subscribers) {
      if (response.writableLength > 256000 || !response.write(data)) { response.end(); subscribers.delete(response); }
    }
  };
  const status = () => { const { history, ...value } = state(); broadcast({ type: 'status', ...value }); };
  const replacePipeline = provider => {
    pipeline?.cancel(); const p = new Pipeline(provider); pipeline = p;
    p.on('event', event => { if (pipeline === p) broadcast(event); });
    broadcast({ type: 'reset' });
  };
  replacePipeline(createRehearsalProvider());
  const halt = (message = '') => {
    const source = active; active = null;
    if (source?.timer) clearTimeout(source.timer);
    source?.bridge?.abort();
    if (source?.socket?.readyState === WebSocket.OPEN) source.socket.close(1000, 'Session stopped');
    pipeline.cancel(); phase = message ? 'error' : 'idle';
    if (message) broadcast({ type: 'issue', stage: 'capture', message });
    status();
  };
  const submit = text => {
    try { return pipeline.submit(text); }
    catch { halt('Processing reached capacity. Capture stopped; check connection and restart.'); return Promise.resolve(false); }
  };
  const readJson = async req => {
    let length = 0; const chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 8192) throw fail(413, 'Request too large');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw fail(400, 'Invalid JSON'); }
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://local');
      if (req.method === 'POST') {
        if (!originAllowed(req)) throw fail(403, 'Request origin not allowed');
        const body = await readJson(req);
        if (url.pathname === '/api/login') {
          if (!same(body.token, operatorToken)) throw fail(401, 'Invalid operator token');
          res.setHeader('Set-Cookie', `btcpp_operator=${operatorToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${config.publicBaseUrl?.startsWith('https:') ? '; Secure' : ''}`);
          return json(res, { ok: true });
        }
        if (!operator(req)) throw fail(401, 'Operator access required');
        if (url.pathname === '/api/rehearsal') {
          if (active) throw fail(409, 'Stop the current session first');
          targetLanguage = 'ko'; mode = 'rehearsal'; phase = 'live'; replacePipeline(createRehearsalProvider());
          const source = { index: 0 }; active = source; status();
          const tick = async () => {
            if (active !== source) return;
            if (source.index === samples.length) { active = null; phase = 'idle'; status(); return; }
            await submit(samples[source.index++][0]);
            if (active === source) source.timer = setTimeout(tick, config.rehearsalInterval ?? 1800);
          };
          source.timer = setTimeout(tick, 50); return json(res, { ok: true }, 202);
        }
        if (url.pathname === '/api/settings') {
          if (active) throw fail(409, 'Stop the session before changing language');
          if (!language(body.targetLanguage)) throw fail(400, 'Unsupported target language');
          targetLanguage = body.targetLanguage; status(); return json(res, { ok: true, targetLanguage });
        }
        if (url.pathname === '/api/stop') { halt(); return json(res, { ok: true }); }
        throw fail(404, 'Unknown operation');
      }
      if (req.method !== 'GET') throw fail(405, 'Method not allowed');
      if (url.pathname === '/api/health') return json(res, { service: 'btcpp-live-translation', mode, phase, liveReady, operatorAuthenticated: operator(req) });
      if (url.pathname === '/api/config') {
        if (!operator(req)) throw fail(401, 'Operator access required');
        const origin = config.publicBaseUrl || `http://${server.address().address === '::1' ? '[::1]' : 'localhost'}:${server.address().port}`;
        const viewerUrl = `${origin.replace(/\/$/, '')}/listen?token=${viewerToken}`;
        return json(res, { ...state(), liveReady, topics, languages, providers, termCount: terms.length,
          ttsProvider: config.ttsProvider || 'xai', publicReady: Boolean(config.publicBaseUrl), viewerUrl,
          qr: await QRCode.toDataURL(viewerUrl, { width: 200, margin: 1 }) });
      }
      if (url.pathname === '/api/terms') {
        if (!operator(req)) throw fail(401, 'Operator access required');
        return json(res, { terms, hints: selectHints(url.searchParams.get('topic') || 'protocol'), reviewedKoreanTerms: 0 });
      }
      if (url.pathname === '/api/events') {
        if (!viewer(req, url)) throw fail(401, 'Attendee link required');
        if (subscribers.size >= 500) throw fail(503, 'Listener capacity reached');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        subscribers.add(res);
        res.on('error', () => subscribers.delete(res));
        res.write(`data: ${JSON.stringify({ type: 'snapshot', ...state(), history: pipeline.history.slice(-10) })}\n\n`);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        req.on('close', () => { clearInterval(heartbeat); subscribers.delete(res); }); return;
      }
      if (url.pathname.startsWith('/api/audio/')) {
        if (!viewer(req, url)) throw fail(401, 'Attendee link required');
        const audio = pipeline.audio.get(Number(url.pathname.split('/').at(-1)));
        if (!audio) throw fail(404, 'Audio segment expired or unavailable');
        res.writeHead(200, { 'Content-Type': audio.mime, 'Content-Length': audio.data.length }); res.end(audio.data); return;
      }
      let path = url.pathname;
      if (path === '/') path = '/index.html';
      if (path === '/listen') path = '/listen.html';
      const name = staticFiles.get(path);
      if (!name) throw fail(404, 'Not found');
      const data = await readFile(new URL(`../public/${name}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': mime[name.split('.').at(-1)] }); res.end(data);
    } catch (error) {
      if (!res.headersSent) json(res, { error: error.status ? error.message : 'Request failed' }, error.status || 500);
      else res.end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16000 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/capture' || !operator(req) || !originAllowed(req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    if (!liveReady || active) { socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', socket => {
    const source = { socket, bridge: null }; active = source; let started = false;
    const startTimer = setTimeout(() => { if (!started && active === source) halt('Capture did not start.'); }, 10000);
    socket.on('message', (data, binary) => {
      if (active !== source) return;
      if (binary) {
        if (!source.bridge || !['live', 'reconnecting'].includes(phase) || data.length > 6400 || data.length % 2) { halt('Invalid or early audio frame.'); return; }
        if (!source.bridge.send(data)) halt('Audio connection is not ready. Restart capture.');
        return;
      }
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'start' && !started) {
          started = true; clearTimeout(startTimer);
          mode = 'live'; phase = 'connecting'; replacePipeline(createLiveProvider({ ...config, targetLanguage })); status();
          source.bridge = connectTranscriber(config, { topic: topics.includes(message.topic) ? message.topic : 'protocol',
            context: String(message.context || '').slice(0, 1000),
            onReady: () => { if (active === source) { phase = 'live'; socket.send(JSON.stringify({ type: 'ready' })); status(); } },
            onPartial: text => { if (active === source) broadcast({ type: 'partial', text: text.slice(0, 4000) }); },
            onText: text => { if (active === source) submit(text); },
            onStatus: value => { if (active === source) { phase = value; status(); } },
            onError: message => { if (active === source) halt(message); },
            onClosed: async () => {
              if (active !== source) return;
              phase = 'finishing'; status();
              await pipeline.drain();
              if (active === source) { active = null; phase = 'idle'; status(); socket.close(); }
            } });
        } else if (message.type === 'stop' && started) { phase = 'finishing'; source.bridge.finish(); status(); }
        else halt('Invalid capture control message.');
      } catch { halt('Invalid capture control message.'); }
    });
    socket.on('error', () => { if (active === source) halt('Capture browser disconnected.'); });
    socket.on('close', () => { clearTimeout(startTimer); if (active === source) { source.bridge?.finish(); if (!source.bridge) { active = null; phase = 'idle'; status(); } } });
  });
  return { server, state,
    async close() {
      if (closed) return; closed = true; halt();
      for (const response of subscribers) response.end(); subscribers.clear();
      for (const client of wss.clients) client.terminate();
      wss.close(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
