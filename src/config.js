import { language } from './languages.js';

export function configFromEnv(env = {}) {
  const cloud = env.PROFILE === 'cloud';
  const translationProvider = env.TRANSLATION_PROVIDER || (cloud ? (env.OPENROUTER_API_KEY ? 'openrouter' : 'workers-ai') : 'local');
  const config = {
    sttProvider: env.STT_PROVIDER || (cloud ? (env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'workers-ai') : 'local'),
    translationProvider,
    ttsProvider: env.TTS_PROVIDER || (cloud ? (env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'workers-ai') : 'local'),
    targetLanguage: env.TARGET_LANGUAGE || 'ko',
    translationModel: env.TRANSLATION_MODEL || ({ local: 'qwen3:8b', openrouter: 'google/gemini-2.5-flash', xai: 'grok-4.7', 'workers-ai': '@cf/qwen/qwen3-30b-a3b-fp8' })[translationProvider],
    localSttUrl: cloud ? undefined : env.LOCAL_STT_URL || 'http://127.0.0.1:8080/inference',
    translationBase: env.TRANSLATION_BASE_URL || (cloud || (env.TRANSLATION_PROVIDER && env.TRANSLATION_PROVIDER !== 'local') ? undefined : 'http://127.0.0.1:11434/v1'),
    localTtsUrl: cloud ? undefined : env.LOCAL_TTS_URL || 'http://127.0.0.1:8880/v1/audio/speech',
    localTtsModel: env.LOCAL_TTS_MODEL || '', localTtsVoice: env.LOCAL_TTS_VOICE || '',
    xaiKey: env.XAI_API_KEY, openrouterKey: env.OPENROUTER_API_KEY,
    elevenKey: env.ELEVENLABS_API_KEY, elevenVoice: env.ELEVENLABS_VOICE_ID,
    voice: env.XAI_VOICE || 'eve', publicBaseUrl: env.PUBLIC_BASE_URL,
    base: env.XAI_BASE_URL, sttUrl: env.STT_URL,
    eventName: env.EVENT_NAME || 'Bitcoin++', stageName: env.STAGE_NAME || 'Main Stage'
  };
  if (!language(config.targetLanguage)) throw Error('Unsupported target language');
  if (!['local', 'workers-ai', 'elevenlabs', 'xai'].includes(config.sttProvider) ||
      !['local', 'workers-ai', 'openrouter', 'xai'].includes(config.translationProvider) ||
      !['none', 'local', 'workers-ai', 'elevenlabs', 'xai'].includes(config.ttsProvider)) throw Error('Unsupported provider');
  if (!cloud) for (const key of ['localSttUrl', 'localTtsUrl']) {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config[key]).hostname)) throw Error('Local services must use loopback endpoints');
  }
  if (config.translationProvider === 'local' && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.translationBase).hostname))
    throw Error('Local translation must use a loopback endpoint');
  return config;
}

export function providerStatus(c) {
  const stt = c.sttProvider || 'xai', translation = c.translationProvider || 'xai', speech = c.ttsProvider || 'xai';
  const configured = {
    recognition: stt === 'local' ? Boolean(c.localSttUrl) : stt === 'workers-ai' ? Boolean(c.runAI) : stt === 'elevenlabs' ? Boolean(c.elevenKey) : Boolean(c.xaiKey),
    translation: translation === 'local' ? Boolean(c.translationBase && c.translationModel) : translation === 'workers-ai' ? Boolean(c.runAI) : translation === 'openrouter' ? Boolean(c.openrouterKey) : Boolean(c.xaiKey),
    speech: speech === 'none' || (speech === 'local' ? Boolean(c.localTtsUrl && c.localTtsModel && c.localTtsVoice) : speech === 'workers-ai' ? Boolean(c.runAI) : speech === 'elevenlabs' ? Boolean(c.elevenKey && c.elevenVoice) : Boolean(c.xaiKey))
  };
  return { recognition: stt, translation, speech, configured, ready: Object.values(configured).every(Boolean) };
}
