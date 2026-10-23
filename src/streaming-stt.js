import { Buffer } from 'node:buffer';
import { selectHints } from './glossary.js';
import { TranscriptAssembler } from './transcript.js';

// Public documented codes only. Raw provider bodies can contain private speech
// or credentials and must never be forwarded into issues, diagnostics or logs.
const elevenFailures = new Map(Object.entries({
  auth_error: 'Check the ElevenLabs API key and its permissions.',
  quota_exceeded: 'Usage quota exceeded. Check available ElevenLabs credits.',
  transcriber_error: 'The provider could not transcribe the audio. Try again.',
  input_error: 'The provider rejected the audio format or input.',
  invalid_request: 'The provider rejected the connection parameters.',
  error: 'The transcription provider reported a server error. Try again.',
  commit_throttled: 'The provider received too many commit requests.',
  unaccepted_terms: 'Accept the Scribe terms in the ElevenLabs dashboard.',
  rate_limited: 'The provider rate limit was reached. Wait before retrying.',
  queue_overflow: 'The provider processing queue is full. Try again later.',
  resource_exhausted: 'The provider is at capacity. Try again later.',
  session_time_limit_exceeded: 'The provider session time limit was reached. Start a new session.',
  chunk_size_exceeded: 'The provider rejected an oversized audio chunk.',
  insufficient_audio_activity: 'The provider stopped after insufficient audio activity. Check captured audio and start again.'
}));

export function connectStreamingTranscriber(config, callbacks, openSocket) {
  const { topic, context = '', onReady, onText, onPartial, onError, onClosed, onStatus = () => {} } = callbacks;
  const eleven = config.sttProvider === 'elevenlabs';
  const url = new URL(config.sttUrl || (eleven ? 'wss://api.elevenlabs.io/v1/speech-to-text/realtime' : 'wss://api.x.ai/v1/stt'));
  const parameters = eleven ? { model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', language_code: 'en', commit_strategy: 'vad',
    vad_silence_threshold_secs: 0.6, min_speech_duration_ms: 150, min_silence_duration_ms: 150 } : {
    model: 'grok-voice-transcribe-2.0', sample_rate: 16000, encoding: 'pcm', language: 'en', interim_results: true, endpointing: 500, format: true };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  for (const term of selectHints(topic, { limit: eleven ? 50 : 100, maxLength: eleven ? 20 : 50, context }))
    url.searchParams.append(eleven ? 'keyterms' : 'keyterm', term);
  const headers = eleven ? { 'xi-api-key': config.elevenKey } : { Authorization: `Bearer ${config.xaiKey}` };
  const assembler = new TranscriptAssembler();
  let socket, ready = false, ending = false, aborted = false, notified = false, attempts = 0;
  let timer, retryTimer, finishTimer, pending = [], pendingBytes = 0;
  const clear = () => { clearTimeout(timer); clearTimeout(retryTimer); clearTimeout(finishTimer); };
  const closed = () => { if (!notified) { notified = true; onClosed?.(); } };
  const fail = message => { if (aborted) return; aborted = true; clear(); socket?.close(); pending = []; onError(message); closed(); };
  const write = data => socket.send(eleven ? JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.from(data).toString('base64'), sample_rate: 16000 }) : data);
  async function dial() {
    timer = setTimeout(() => fail('Transcription did not become ready.'), 12000);
    try {
      const current = await openSocket(url.toString(), headers); socket = current;
      if (aborted || ending) { current.close(); return; }
      current.addEventListener('message', ({ data }) => {
        if (current !== socket || aborted) return;
        try {
          const event = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString());
          if (event.type === 'transcript.created' || event.message_type === 'session_started') {
            ready = true; clearTimeout(timer);
            for (const frame of pending.splice(0)) write(frame);
            pendingBytes = 0; onStatus('live'); onReady();
          }
          const reason = eleven && elevenFailures.get(event.message_type);
          if (reason) return fail(`ElevenLabs transcription stopped (${event.message_type}). ${reason}`);
          if (event.type === 'error' || event.error || /error|limited|exceeded|failure/.test(event.message_type || ''))
            return fail('Transcription provider rejected the session. Check credentials and quota.');
          if (eleven) {
            if (event.message_type === 'partial_transcript') onPartial(event.text || '');
            if (event.message_type === 'committed_transcript' && event.text?.trim()) onText(event.text.trim().slice(0, 4000));
          } else if (event.type === 'transcript.partial') {
            if (!event.is_final) onPartial(event.text || '');
            const text = assembler.accept(event); if (text) onText(text);
          }
          if (event.type === 'transcript.done') { ending = true; clear(); current.close(); }
        } catch { fail('Invalid transcription response.'); }
      });
      current.addEventListener('error', () => { if (current === socket && !aborted) current.close(); });
      current.addEventListener('close', () => {
        if (current !== socket || aborted) return;
        ready = false; clearTimeout(timer);
        if (ending) { clear(); closed(); return; }
        if (++attempts > 3) return fail('Transcription disconnected repeatedly. Stop and check the network.');
        onStatus('reconnecting'); retryTimer = setTimeout(dial, Math.min(250 * 2 ** attempts, 2000));
      });
    } catch { fail('Transcription connection failed.'); }
  }
  void dial();
  return {
    send(data) {
      if (aborted || ending) return false;
      if (!ready || socket?.readyState !== 1) {
        if ((pendingBytes += data.byteLength) > 96000) { fail('Transcription reconnect buffer filled. Capture stopped.'); return false; }
        pending.push(Buffer.from(data)); return true;
      }
      if (socket.bufferedAmount > 128000) { fail('Transcription connection is falling behind.'); return false; }
      write(data); return true;
    },
    finish() {
      if (aborted || ending) return;
      ending = true; clearTimeout(timer); clearTimeout(retryTimer);
      if (socket?.readyState === 1) {
        if (eleven) socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.alloc(3200).toString('base64'), sample_rate: 16000, commit: true }));
        else socket.send(JSON.stringify({ type: 'audio.done' }));
        finishTimer = setTimeout(() => { socket.close(); closed(); }, 3000);
      } else { socket?.close(); closed(); }
    },
    abort() { aborted = true; clear(); pending = []; socket?.close(); }
  };
}
