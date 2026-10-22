import { DurableObject } from 'cloudflare:workers';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import QRCode from 'qrcode';
import { configFromEnv, providerStatus } from '../src/config.js';
import { languages, language } from '../src/languages.js';
import { terms, topics, selectHints } from '../src/glossary.js';
import { Pipeline } from '../src/pipeline.js';
import { createLiveProvider } from '../src/http-provider.js';
import { connectStreamingTranscriber } from '../src/streaming-stt.js';
import { connectBufferedTranscriber } from '../src/buffered-stt.js';
import { createRehearsalProvider, samples } from '../src/rehearsal.js';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const error = (status, message) => Object.assign(Error(message), { status });
const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers });
const cookieToken = request => (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('btcpp_operator='))?.slice(15);
const security = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;
    if (url.pathname.startsWith('/api/')) {
      if (!env.OPERATOR_TOKEN || !env.VIEWER_TOKEN) response = json({ error: 'Service access is not configured.' }, 503);
      else response = await env.STAGE.get(env.STAGE.idFromName('main-stage')).fetch(request);
    } else {
      if (url.pathname === '/') url.pathname = '/index.html';
      if (url.pathname === '/listen') url.pathname = '/listen.html';
      response = await env.ASSETS.fetch(new Request(url, request));
    }
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(security)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }
};

export class StageSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.ctx = ctx; this.env = env;
    this.config = configFromEnv(env); if (env.AI) this.config.runAI = (model, input) => env.AI.run(model, input);
    this.target = this.config.targetLanguage; this.subscribers = new Set(); this.active = null;
    this.mode = 'idle'; this.phase = 'idle'; this.replace(createRehearsalProvider());
  }
  state() {
    return { mode: this.mode, phase: this.phase, sessionId: this.sessionId, listeners: this.subscribers.size, history: this.pipeline.history,
      queue: this.pipeline.queue.length, name: this.config.eventName, stage: this.config.stageName,
      targetLanguage: this.target, direction: `English → ${language(this.target).name}` };
  }
  onAir() { return ['live', 'reconnecting', 'finishing'].includes(this.phase); }
  listenerState() { return { ...this.state(), history: this.onAir() ? this.pipeline.listenerHistory() : [] }; }
  broadcast(event) {
    const data = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
    for (const controller of this.subscribers) {
      try { if (controller.desiredSize <= 0) { controller.close(); this.subscribers.delete(controller); } else controller.enqueue(data); }
      catch { this.subscribers.delete(controller); }
    }
  }
  status() { const { history, ...state } = this.state(); this.broadcast({ type: 'status', ...state }); }
  replace(provider) {
    this.pipeline?.cancel(); const pipeline = new Pipeline(provider); this.pipeline = pipeline; this.sessionId = randomUUID(); this.lastIssue = null;
    pipeline.on('event', event => { if (this.pipeline === pipeline) this.broadcast({ ...event, sessionId: this.sessionId }); });
    this.broadcast({ type: 'reset', sessionId: this.sessionId });
  }
  halt(message = '') {
    const source = this.active; this.active = null;
    if (message) {
      this.lastIssue = { stage: 'capture', message, sessionId: this.sessionId, at: Date.now() };
      try { source?.socket?.send(JSON.stringify({ type: 'issue', ...this.lastIssue })); } catch {}
    }
    clearTimeout(source?.timer); clearTimeout(source?.startTimer); source?.bridge?.abort();
    try { source?.socket?.close(message ? 1011 : 1000, message ? 'Session failed' : 'Session stopped'); } catch {}
    this.pipeline.cancel(); this.phase = message ? 'error' : 'idle';
    if (message) this.broadcast({ type: 'issue', stage: 'capture', message });
    this.status();
  }
  submit(text) {
    try { return this.pipeline.submit(text); }
    catch { this.halt('Processing reached capacity. Stop and check the connection.'); return Promise.resolve(false); }
  }
  async body(request) {
    let length = 0; const chunks = []; const reader = request.body?.getReader();
    if (reader) for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      if ((length += value.byteLength) > 8192) { await reader.cancel(); throw error(413, 'Request too large'); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw error(400, 'Invalid JSON'); }
  }
  async fetch(request) {
    const url = new URL(request.url), operator = same(cookieToken(request), this.env.OPERATOR_TOKEN);
    const attendee = operator || same(url.searchParams.get('token'), this.env.VIEWER_TOKEN);
    const originOK = request.headers.get('Origin') === url.origin;
    try {
      if (url.pathname === '/api/capture') {
        if (!operator || !originOK) throw error(401, 'Operator access required');
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw error(426, 'WebSocket required');
        if (!providerStatus(this.config).ready || this.active) throw error(409, 'Stop the current session or configure providers');
        const pair = new WebSocketPair(); this.capture(pair[1]);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      if (request.method === 'POST') {
        if (!originOK) throw error(403, 'Request origin not allowed');
        const body = await this.body(request);
        if (url.pathname === '/api/login') {
          if (!same(body.token, this.env.OPERATOR_TOKEN)) throw error(401, 'Invalid operator token');
          return json({ ok: true }, 200, { 'Set-Cookie': `btcpp_operator=${this.env.OPERATOR_TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${url.protocol === 'https:' ? '; Secure' : ''}` });
        }
        if (!operator) throw error(401, 'Operator access required');
        if (url.pathname === '/api/stop') { this.halt(); return json({ ok: true }); }
        if (url.pathname === '/api/settings') {
          if (this.active) throw error(409, 'Stop the session before changing language');
          if (!language(body.targetLanguage)) throw error(400, 'Unsupported target language');
          this.target = body.targetLanguage; this.status(); return json({ ok: true, targetLanguage: this.target });
        }
        if (url.pathname === '/api/rehearsal') {
          if (this.active) throw error(409, 'Stop the current session first');
          this.target = 'ko'; this.mode = 'rehearsal'; this.phase = 'live'; this.replace(createRehearsalProvider());
          const source = { index: 0 }; this.active = source; this.status();
          const tick = async () => {
            if (this.active !== source) return;
            if (source.index === samples.length) { this.active = null; this.phase = 'idle'; this.status(); return; }
            await this.submit(samples[source.index++][0]);
            if (this.active === source) source.timer = setTimeout(tick, 1800);
          };
          source.timer = setTimeout(tick, 50); return json({ ok: true }, 202);
        }
        throw error(404, 'Unknown operation');
      }
      if (request.method !== 'GET') throw error(405, 'Method not allowed');
      if (url.pathname === '/api/health') return json({ service: 'btcpp-live-translation', mode: this.mode, phase: this.phase,
        liveReady: providerStatus(this.config).ready, operatorAuthenticated: operator });
      if (url.pathname === '/api/config') {
        if (!operator) throw error(401, 'Operator access required');
        const viewerUrl = `${url.origin}/listen?token=${this.env.VIEWER_TOKEN}`;
        const svg = await QRCode.toString(viewerUrl, { type: 'svg', margin: 1, width: 200 });
        return json({ ...this.state(), lastIssue: this.lastIssue, viewerUrl, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
          liveReady: providerStatus(this.config).ready, providers: providerStatus(this.config), languages,
          topics, termCount: terms.length, publicReady: true, ttsProvider: this.config.ttsProvider });
      }
      if (url.pathname === '/api/terms') {
        if (!operator) throw error(401, 'Operator access required');
        return json({ terms, hints: selectHints(url.searchParams.get('topic') || 'protocol'), reviewedKoreanTerms: 0 });
      }
      if (url.pathname === '/api/listener') {
        if (!attendee) throw error(401, 'Attendee link required');
        return json({ type: 'snapshot', ...this.listenerState() });
      }
      if (url.pathname === '/api/events') {
        if (!attendee) throw error(401, 'Attendee link required');
        if (this.subscribers.size >= 500) throw error(503, 'Listener capacity reached');
        let heartbeat, controller;
        const cleanup = () => { clearInterval(heartbeat); this.subscribers.delete(controller); };
        const stream = new ReadableStream({
          start: value => {
            controller = value; this.subscribers.add(controller);
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'snapshot', ...(operator ? { ...this.state(), history: this.pipeline.history.slice(-10) } : this.listenerState()) })}\n\n`));
            heartbeat = setInterval(() => { try { if (controller.desiredSize <= 0) { controller.close(); cleanup(); } else controller.enqueue(new TextEncoder().encode(': heartbeat\n\n')); } catch { cleanup(); } }, 15000);
          }, cancel: cleanup
        }, { highWaterMark: 256000, size: chunk => chunk.byteLength });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
      }
      if (url.pathname.startsWith('/api/audio/')) {
        if (!attendee) throw error(401, 'Attendee link required');
        if (!this.onAir()) throw error(409, 'Session is not live');
        if (url.searchParams.has('session') && url.searchParams.get('session') !== this.sessionId) throw error(404, 'Audio session expired');
        const audio = this.pipeline.audio.get(Number(url.pathname.split('/').at(-1)));
        if (!audio) throw error(404, 'Audio segment expired or unavailable');
        return new Response(audio.data, { headers: { 'Content-Type': audio.mime, 'Content-Length': String(audio.data.length) } });
      }
      throw error(404, 'Not found');
    } catch (e) { return json({ error: e.status ? e.message : 'Request failed' }, e.status || 500); }
  }
  capture(socket) {
    socket.accept(); socket.binaryType = 'arraybuffer';
    const source = { socket }; this.active = source; let started = false;
    source.startTimer = setTimeout(() => { if (this.active === source && !started) this.halt('Capture did not start.'); }, 10000);
    socket.addEventListener('message', ({ data }) => {
      if (this.active !== source) return;
      if (typeof data !== 'string') {
        if (!source.bridge || !['live', 'reconnecting'].includes(this.phase) || data.byteLength > 6400 || data.byteLength % 2)
          return this.halt('Invalid or early audio frame.');
        if (!source.bridge.send(data)) this.halt('Audio connection failed. Restart capture.');
        return;
      }
      try {
        if (data.length > 8192) return this.halt('Capture control message too large.');
        const message = JSON.parse(data);
        if (message.type === 'start' && !started) {
          started = true; clearTimeout(source.startTimer); this.mode = 'live'; this.phase = 'connecting';
          this.replace(createLiveProvider({ ...this.config, targetLanguage: this.target })); this.status();
          void this.ctx.storage.setAlarm(Date.now() + 6 * 3600000);
          const handlers = { topic: topics.includes(message.topic) ? message.topic : 'protocol', context: String(message.context || '').slice(0, 1000),
            onReady: () => { if (this.active === source) { this.phase = 'live'; socket.send(JSON.stringify({ type: 'ready', sessionId: this.sessionId })); this.status(); } },
            onPartial: text => { if (this.active === source) this.broadcast({ type: 'partial', text: text.slice(0, 4000) }); },
            onText: text => { if (this.active === source) void this.submit(text); },
            onStatus: phase => { if (this.active === source) { this.phase = phase; this.status(); } },
            onError: message => { if (this.active === source) this.halt(message); },
            onClosed: async () => {
              if (this.active !== source) return; this.phase = 'finishing'; this.status();
              await this.pipeline.drain();
              if (this.active === source) { this.active = null; this.phase = 'idle'; this.status(); socket.close(); }
            } };
          source.bridge = ['workers-ai', 'local'].includes(this.config.sttProvider)
            ? connectBufferedTranscriber(this.config, handlers)
            : connectStreamingTranscriber(this.config, handlers, async (url, headers) => {
              const response = await fetch(url.replace(/^ws/, 'http'), { headers: { ...headers, Upgrade: 'websocket' } });
              if (!response.webSocket) throw Error('Transcription upgrade failed');
              response.webSocket.accept(); return response.webSocket;
            });
        } else if (message.type === 'stop' && started) { this.phase = 'finishing'; source.bridge.finish(); this.status(); }
        else this.halt('Invalid capture control message.');
      } catch { this.halt('Invalid capture control message.'); }
    });
    socket.addEventListener('close', () => { clearTimeout(source.startTimer); if (this.active === source) source.bridge?.finish(); });
    socket.addEventListener('error', () => { if (this.active === source) this.halt('Capture browser disconnected.'); });
  }
  async alarm() { if (this.active) this.halt('Six-hour session limit reached. Start a new session to continue.'); }
}
