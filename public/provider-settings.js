export function initProviderSettings({ api, onChange, onBusy }) {
  const node = id => document.getElementById(id), names = ['elevenlabs', 'openrouter', 'xai'];
  const fields = { sttProvider: 'provider-stt', translationProvider: 'provider-translation', ttsProvider: 'provider-speech', translationModel: 'provider-model', elevenVoice: 'provider-eleven-voice', voice: 'provider-xai-voice' };
  const labels = { local: 'Local model', 'workers-ai': 'Cloudflare AI', elevenlabs: 'ElevenLabs', openrouter: 'OpenRouter', xai: 'xAI / Grok', none: 'Off · captions only' };
  const controls = [...Object.values(fields), ...names.flatMap(name => [`key-${name}`, `clear-${name}`]), 'provider-save', 'test-recognition', 'test-translation', 'test-speech'];
  let state, running = false, pending = false;
  const message = text => { node('provider-message').textContent = text; };
  function lock() { for (const id of controls) node(id).disabled = running || pending || !state?.available; }
  function extras() {
    node('eleven-voice-field').hidden = node('provider-speech').value !== 'elevenlabs';
    node('xai-voice-field').hidden = node('provider-speech').value !== 'xai';
  }
  function render(value) {
    state = value;
    for (const [field, values] of Object.entries(value.options)) node(fields[field]).replaceChildren(...values.map(item => {
      const option = document.createElement('option'); option.value = item; option.textContent = labels[item]; return option;
    }));
    for (const [field, id] of Object.entries(fields)) node(id).value = value[field] || '';
    for (const name of names) {
      const key = value.keys[name];
      node(`key-state-${name}`).textContent = key.configured ? key.source === 'saved' ? 'Saved privately' : 'Available on server' : 'No key configured';
      node(`clear-row-${name}`).hidden = key.source !== 'saved';
    }
    node('provider-storage').textContent = value.problem || (value.persistent ? 'Keys are encrypted on the server. Leave a key blank to keep it.' : 'Private storage needs server setup before keys can be saved.');
    extras(); lock();
  }
  async function busy(action) {
    if (running || pending) return;
    pending = true; onBusy(true); lock();
    try { await action(); } catch (error) { message(error.message); }
    finally { pending = false; onBusy(false); lock(); }
  }
  node('provider-form').addEventListener('submit', event => {
    event.preventDefault();
    return busy(async () => {
      const body = Object.fromEntries(Object.entries(fields).map(([field, id]) => [field, node(id).value]));
      body.keys = Object.fromEntries(names.map(name => [name, node(`clear-${name}`).checked ? null : node(`key-${name}`).value]));
      const saved = await api('/api/providers', body, AbortSignal.timeout(15000));
      for (const name of names) { node(`key-${name}`).value = ''; node(`clear-${name}`).checked = false; }
      render(saved); await onChange(saved);
      message('Saved privately. Use the checks below before starting live translation.');
    });
  });
  node('provider-translation').addEventListener('change', () => { node('provider-model').value = state?.models[node('provider-translation').value] || ''; });
  node('provider-speech').addEventListener('change', extras);
  for (const stage of ['recognition', 'translation', 'speech']) node(`test-${stage}`).addEventListener('click', () => busy(async () => {
    message(`Checking saved ${stage} settings…`);
    const result = await api('/api/providers/test', { stage }, AbortSignal.timeout(35000));
    message(`${result.ok ? 'Passed' : 'Failed'} · ${stage}: ${result.message}`);
  }));
  lock();
  return {
    async load() {
      try { render(await api('/api/providers')); }
      catch { message('Provider settings could not be loaded. Refresh the desk to retry.'); }
    },
    setRunning(value) { running = value; lock(); }
  };
}
