import { Buffer } from 'node:buffer';
import { translationInstructions } from './glossary.js';

const timeoutSignal = signal => AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(30000)]);
export async function bytes(response, max = 6 * 1024 * 1024) {
  if (!response.ok) { await response.body?.cancel(); throw Error(`Provider HTTP ${response.status}`); }
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > max) { await response.body.cancel().catch(() => {}); throw Error('Provider response too large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createLiveProvider(config = {}) {
  const target = config.targetLanguage || 'ko';
  const base = config.base || 'https://api.x.ai/v1';
  return { targetLanguage: target,
    async translate(text, signal, previous = []) {
      const provider = config.translationProvider || 'xai';
      const messages = [{ role: 'system', content: translationInstructions(text, target) }, { role: 'user', content: JSON.stringify({
        previousContextOnly: previous.map(s => ({ english: s.english, translated: s.translated || s.korean })), currentUtterance: text }) }];
      let payload;
      if (provider === 'workers-ai') {
        payload = await config.runAI(config.translationModel || '@cf/qwen/qwen3-30b-a3b-fp8', { messages, max_tokens: 1500, temperature: 0.1 });
      } else {
        const url = config.translationBase || (provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : base);
        const key = provider === 'openrouter' ? config.openrouterKey : provider === 'local' ? null : config.xaiKey;
        const response = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          signal: timeoutSignal(signal), body: JSON.stringify({ model: config.translationModel || 'grok-4.7', messages,
            max_tokens: 1500, temperature: 0.1, stream: false, ...(provider === 'local' ? { think: false } : {}) }) });
        payload = JSON.parse((await bytes(response, 128000)).toString());
      }
      const raw = payload.response ?? payload.choices?.[0]?.message?.content;
      const output = typeof raw === 'string' ? raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').trim() : '';
      if (!output || output.length > 8000 || /^<think\b/i.test(output)) throw Error('Invalid translation response');
      return output;
    },
    async speak(text, signal) {
      const provider = config.ttsProvider || 'xai';
      if (provider === 'workers-ai') {
        const lang = ({ ko: 'kr', ja: 'jp' })[target] || target;
        const result = await config.runAI('@cf/myshell-ai/melotts', { prompt: text, lang });
        const response = result instanceof Response ? result : result instanceof ReadableStream ? new Response(result) : null;
        const data = response ? await bytes(response) : result?.audio ? Buffer.from(result.audio, 'base64') : null;
        if (!data?.length) throw Error('Speech provider returned no audio');
        const isWav = data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WAVE';
        return { data, mime: isWav ? 'audio/wav' : 'audio/mpeg' };
      }
      let response;
      if (provider === 'local') {
        response = await fetch(config.localTtsUrl, { method: 'POST', signal: timeoutSignal(signal),
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.localTtsModel,
            voice: config.localTtsVoice, input: text, language: target, response_format: 'mp3' }) });
      } else if (provider === 'elevenlabs') {
        if (!config.elevenKey || !config.elevenVoice) throw Error('ElevenLabs voice not configured');
        response = await fetch(`${config.elevenBase || 'https://api.elevenlabs.io/v1'}/text-to-speech/${encodeURIComponent(config.elevenVoice)}/stream?output_format=mp3_44100_128`, {
          method: 'POST', signal: timeoutSignal(signal), headers: { 'xi-api-key': config.elevenKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', language_code: target }) });
      } else {
        response = await fetch(`${base}/tts`, { method: 'POST', signal: timeoutSignal(signal),
          headers: { Authorization: `Bearer ${config.xaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice_id: config.voice || 'eve', language: target,
            output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 64000 } }) });
      }
      return { data: await bytes(response), mime: response.headers.get('content-type')?.startsWith('audio/') ? response.headers.get('content-type') : 'audio/mpeg' };
    }
  };
}
