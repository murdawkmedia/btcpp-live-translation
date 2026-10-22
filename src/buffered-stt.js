import { Buffer } from 'node:buffer';
import { selectHints } from './glossary.js';
import { bytes } from './http-provider.js';

export function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export function connectBufferedTranscriber(config, { topic, context = '', onReady, onText, onPartial, onError, onClosed }) {
  let chunks = [], size = 0, quiet = 0, hasSpeech = false, ended = false, processing = false, closed = false;
  const queue = [], controller = new AbortController();
  const prompt = selectHints(topic, { limit: 50, maxLength: 50, context }).join(', ');
  const close = () => { if (!closed) { closed = true; onClosed?.(); } };
  const fail = message => { controller.abort(); ended = true; chunks = []; queue.length = 0; onError(message); close(); };
  async function run() {
    if (processing) return; processing = true;
    while (queue.length && !controller.signal.aborted) {
      const audio = wav(queue.shift());
      try {
        let result;
        if (config.sttProvider === 'workers-ai') {
          result = await config.runAI('@cf/openai/whisper-large-v3-turbo', { audio: audio.toString('base64'),
            task: 'transcribe', language: 'en', initial_prompt: prompt, condition_on_previous_text: false, vad_filter: true });
        } else {
          const body = new FormData(); body.append('file', new Blob([audio], { type: 'audio/wav' }), 'speech.wav');
          body.append('language', 'en'); body.append('response_format', 'json'); body.append('prompt', prompt);
          const response = await fetch(config.localSttUrl, { method: 'POST', body,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
          result = JSON.parse((await bytes(response, 128000)).toString());
        }
        const text = result.text?.trim();
        if (!controller.signal.aborted && text && text.length <= 4000) { onPartial(''); onText(text); }
      } catch { if (!controller.signal.aborted) fail('Recognition failed. Check the selected model service.'); }
    }
    processing = false; if (ended) close();
  }
  function flush() {
    if (hasSpeech && size >= 6400) {
      if (queue.length >= 3) return fail('Recognition is falling behind. Capture stopped.');
      queue.push(Buffer.concat(chunks)); void run();
    }
    chunks = []; size = 0; quiet = 0; hasSpeech = false;
  }
  queueMicrotask(() => { if (!ended) onReady(); });
  return {
    send(frame) {
      if (ended) return false;
      const data = Buffer.from(frame); let sum = 0;
      for (let i = 0; i < data.length; i += 2) sum += (data.readInt16LE(i) / 32768) ** 2;
      const speech = Math.sqrt(sum / (data.length / 2)) > 0.008;
      if (speech || hasSpeech) { chunks.push(data); size += data.length; hasSpeech ||= speech; quiet = speech ? 0 : quiet + data.length; }
      if (size >= 160000 || quiet >= 22400) flush();
      return !ended;
    },
    finish() { if (ended) return; flush(); ended = true; if (!processing && !queue.length) close(); },
    abort() { ended = true; controller.abort(); chunks = []; queue.length = 0; }
  };
}
