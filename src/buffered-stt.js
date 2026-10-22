import { Buffer } from 'node:buffer';
import { selectHints } from './glossary.js';
import { bytes } from './http-provider.js';
import { TimedTranscriptAssembler } from './transcript.js';

export function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export function connectBufferedTranscriber(config, { topic, context = '', onReady, onText, onPartial, onError, onClosed, onStatus = () => {}, onWarning = () => {} }) {
  let chunks = [], size = 0, quiet = 0, hasSpeech = false, ended = false, processing = false, closed = false;
  let lead = Buffer.alloc(0), received = 0, start = 0, timed = false, fresh = 0;
  const queue = [], controller = new AbortController();
  let requests = 0, retries = 0, coalescedWindows = 0, droppedAudioSeconds = 0, catchingUp = false, gapWarned = false;
  let requestStartedAt = 0, lastRequestMs = 0;
  const cloud = config.sttProvider === 'workers-ai', assembler = new TimedTranscriptAssembler({ preferSentences: true });
  const hints = selectHints(topic, { limit: cloud ? 20 : 50, maxLength: cloud ? 40 : 50, context });
  const prefix = 'English Bitcoin technical conference. Technical spellings: ';
  if (cloud) while ((prefix + hints.join(', ') + '.').length > 500) hints.pop();
  const prompt = cloud ? prefix + hints.join(', ') + '.' : hints.join(', ');
  const close = () => { if (!closed) { closed = true; onClosed?.(); } };
  const fail = message => { controller.abort(); ended = true; chunks = []; queue.length = 0; onError(message); close(); };
  const quotaError = error => cloud && /daily free allocation/i.test(String(error?.message || ''));
  const failureMessage = error => {
    if (quotaError(error)) return 'Cloudflare’s daily free AI allowance is exhausted. Wait for the 00:00 UTC reset or enable Workers Paid.';
    if (error.code === 'missing_word_timing') return 'Recognition returned text without word timings after retry. Capture stopped to avoid repeating speech.';
    const status = Number(error.status || error.statusCode);
    if (status === 429) return 'Recognition service rate limit reached after retry. Wait briefly, then restart capture.';
    if ([401, 403].includes(status)) return 'Recognition service access was rejected. Check the configured provider.';
    if (status >= 500 && status <= 599) return `Recognition service returned HTTP ${status} after retry. Restart capture when the service recovers.`;
    return 'Recognition failed after retry. Check the selected model service and restart capture.';
  };
  async function recognize(job, audio) {
    const attempts = cloud ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (controller.signal.aborted) throw Error('Recognition cancelled');
      requests++; if (attempt) retries++; requestStartedAt = Date.now();
      try {
        let result;
        if (cloud) {
          result = await config.runAI('@cf/openai/whisper-large-v3-turbo', { audio: audio.toString('base64'),
            task: 'transcribe', language: 'en', initial_prompt: prompt, condition_on_previous_text: false, vad_filter: true, word_timestamps: true });
        } else {
          const body = new FormData(); body.append('file', new Blob([audio], { type: 'audio/wav' }), 'speech.wav');
          body.append('language', 'en'); body.append('response_format', 'json'); body.append('prompt', prompt);
          const response = await fetch(config.localSttUrl, { method: 'POST', body,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
          result = JSON.parse((await bytes(response, 128000)).toString());
        }
        const text = result.text?.trim() || '';
        const words = (result.segments || []).flatMap(segment => segment.words || []);
        if (cloud && text && !words.length && (!job.final || timed)) throw Object.assign(Error('Missing word timing'), { code: 'missing_word_timing' });
        return { text, words };
      } catch (error) {
        if (attempt + 1 === attempts || controller.signal.aborted || quotaError(error) || [400, 401, 403].includes(Number(error.status || error.statusCode))) throw error;
      } finally { lastRequestMs = Date.now() - requestStartedAt; requestStartedAt = 0; }
    }
  }
  async function run() {
    if (processing) return; processing = true;
    while (queue.length && !controller.signal.aborted) {
      const job = queue.shift(), audio = wav(job.pcm);
      try {
        let { text, words } = await recognize(job, audio);
        if (cloud && text) {
          if (words.length) {
            timed = true;
            text = assembler.accept(words, job.start, job.final ? Infinity : job.start + job.pcm.length / 32000 - 0.6);
          }
        }
        if (!controller.signal.aborted && text && text.length <= 4000) { onPartial(''); onText(text); }
      } catch (error) { if (!controller.signal.aborted) fail(cloud ? failureMessage(error) : 'Recognition failed. Check the selected model service.'); }
    }
    if (catchingUp && !controller.signal.aborted) {
      catchingUp = false; gapWarned = false;
      if (!ended) onStatus('live');
    }
    processing = false; if (ended) close();
  }
  function enqueue(job) {
    const jobs = [...queue, job];
    const first = Math.min(...jobs.map(item => Math.round(item.start * 32000)));
    const end = Math.max(...jobs.map(item => Math.round(item.start * 32000) + item.pcm.length));
    if (queue.length < 3 && (!cloud || end - first <= 30 * 32000)) { queue.push(job); return; }
    if (!cloud) return fail('Recognition is falling behind. Capture stopped.');
    // Pending windows share most of their samples. Merge their union rather
    // than transcribing stale overlaps separately. Keep at most 30 seconds.
    const begin = Math.max(first, end - 30 * 32000), pcm = Buffer.alloc(end - begin);
    for (const item of jobs) {
      const position = Math.round(item.start * 32000), from = Math.max(begin, position), to = Math.min(end, position + item.pcm.length);
      if (to > from) item.pcm.copy(pcm, from - begin, from - position, to - position);
    }
    queue.splice(0, queue.length, { pcm, start: begin / 32000, final: job.final }); coalescedWindows++;
    droppedAudioSeconds += (begin - first) / 32000;
    if (!catchingUp) { catchingUp = true; if (!ended) onStatus('reconnecting'); }
    if (begin > first && !gapWarned) { gapWarned = true; onWarning('Recognition is catching up. Some earlier speech may be missing.'); }
  }
  function flush(final) {
    if (hasSpeech && size >= 6400) {
      const pcm = Buffer.concat(chunks); enqueue({ pcm, start, final });
      if (controller.signal.aborted) return;
      if (cloud && !final) {
        // Revisit enough context to recognize a term or phrase across a cut.
        // First result at five seconds, then every three seconds; at most
        // ten seconds of preceding context survives a hard cut.
        const overlap = pcm.subarray(-320000);
        chunks = [overlap]; size = overlap.length; start += (pcm.length - overlap.length) / 32000; quiet = 0; fresh = 0;
      } else {
        lead = pcm.subarray(-8000); chunks = []; size = 0; quiet = 0; hasSpeech = false; fresh = 0;
      }
      void run(); return;
    }
    chunks = []; size = 0; quiet = 0; hasSpeech = false;
  }
  queueMicrotask(() => { if (!ended) onReady(); });
  return {
    stats() {
      const first = Math.min(...queue.map(job => job.start)), end = Math.max(...queue.map(job => job.start + job.pcm.length / 32000));
      return { requests, retries, coalescedWindows, droppedAudioSeconds, pendingWindows: queue.length, bufferedSeconds: queue.length ? end - first : 0,
        inFlight: processing, activeRequestMs: requestStartedAt ? Date.now() - requestStartedAt : 0, lastRequestMs };
    },
    send(frame) {
      if (ended) return false;
      const data = Buffer.from(frame), position = received; received += data.length; let sum = 0;
      for (let i = 0; i < data.length; i += 2) sum += (data.readInt16LE(i) / 32768) ** 2;
      const speech = Math.sqrt(sum / (data.length / 2)) > 0.008;
      if (!hasSpeech) {
        if (!speech) { lead = Buffer.concat([lead, data]).subarray(-8000); return true; }
        chunks = lead.length ? [lead, data] : [data]; size = lead.length + data.length;
        start = (position - lead.length) / 32000; lead = Buffer.alloc(0); hasSpeech = true; quiet = 0; fresh = size;
      } else { chunks.push(data); size += data.length; fresh += data.length; quiet = speech ? 0 : quiet + data.length; }
      if (size >= 160000 && (!cloud || fresh >= 96000)) flush(false);
      else if (quiet >= 22400) flush(true);
      return !ended;
    },
    finish() { if (ended) return; ended = true; flush(true); if (!processing && !queue.length) close(); },
    abort() { ended = true; controller.abort(); chunks = []; lead = Buffer.alloc(0); queue.length = 0; }
  };
}
