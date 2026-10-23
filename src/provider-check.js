import { Buffer } from 'node:buffer';
import { createLiveProvider } from './http-provider.js';
import { connectStreamingTranscriber } from './streaming-stt.js';
import { providerStatus } from './config.js';
import { wav } from './buffered-stt.js';

export async function checkProvider(config, stage, { openSocket, timeoutMs = 10000 } = {}) {
  const started = Date.now();
  const result = (ok, message) => ({ stage, ok, message, elapsedMs: Date.now() - started });
  if (!['recognition', 'translation', 'speech'].includes(stage)) return result(false, 'Choose a supported processing stage.');
  if (!providerStatus(config).configured[stage]) return result(false, 'This stage needs its provider key, model or voice configured.');
  if (stage === 'speech' && config.ttsProvider === 'none') return result(true, 'Voice is disabled. No speech request was made.');
  const signal = AbortSignal.timeout(timeoutMs);
  if (config.runAI) {
    const runAI = config.runAI;
    config = { ...config, runAI: (...args) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Provider check timed out')), timeoutMs);
      Promise.resolve().then(() => runAI(...args)).then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); reject(Error('Provider check failed')); });
    }) };
  }
  try {
    if (stage === 'recognition' && ['elevenlabs', 'xai'].includes(config.sttProvider || 'xai')) {
      await new Promise((resolve, reject) => {
        let bridge, settled = false;
        const done = error => {
          if (settled) return; settled = true; clearTimeout(timer); bridge?.abort();
          error ? reject(Error('Recognition check failed')) : resolve();
        };
        const timer = setTimeout(() => done(true), timeoutMs);
        bridge = connectStreamingTranscriber(config, { topic: 'protocol', onReady: () => done(), onText() {}, onPartial() {}, onError: () => done(true), onClosed: () => done(true) }, openSocket);
      });
      return result(true, 'Streaming connection accepted; no audio was sent. Test live speech separately.');
    }
    if (stage === 'recognition') {
      const data = wav(Buffer.alloc(3200));
      if (config.sttProvider === 'workers-ai') await config.runAI('@cf/openai/whisper-large-v3-turbo', { audio: data.toString('base64'), language: 'en', task: 'transcribe' });
      else {
        const form = new FormData(); form.append('file', new Blob([data], { type: 'audio/wav' }), 'check.wav'); form.append('language', 'en');
        const response = await fetch(config.localSttUrl, { method: 'POST', body: form, signal });
        await response.body?.cancel(); if (!response.ok) throw Error('Recognition check failed');
      }
    } else if (stage === 'translation') await createLiveProvider(config).translate('Bitcoin transactions use satoshis.', signal);
    else {
      const samples = { ko: '비트코인', ja: 'ビットコイン', zh: '比特币' };
      const audio = await createLiveProvider(config).speak(samples[config.targetLanguage] || 'Bitcoin', signal);
      if (!audio.data.length) throw Error('Speech check failed');
    }
    return result(true, 'Provider accepted the sample request. Accuracy and sustained reliability still need a live test.');
  } catch {
    return result(false, 'Provider check failed. Check the key, model, available credits and service status. No provider error details were exposed.');
  }
}
