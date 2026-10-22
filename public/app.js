import { chooseAudio } from './capture.js';
const $ = id => document.getElementById(id);
let config, terms = [], events, capture, socket, soundchecking = false;
const notice = (message, warning = false) => { $('notice').textContent = message; $('notice').classList.toggle('warning', warning); };
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw Error(value.error || 'Request failed'); return value;
}
function renderCaption(segment) {
  if ($('captions').querySelector('.empty')) $('captions').replaceChildren();
  const row = document.createElement('article'); row.className = 'caption-row'; row.dataset.id = segment.id;
  for (const [key, cls] of [['english', 'en'], ['korean', 'ko']]) {
    const p = document.createElement('p'); p.className = cls; p.lang = key === 'korean' ? 'ko' : 'en'; p.textContent = key === 'korean' ? (segment.translated || segment.korean) : segment[key]; if (key === 'korean') p.lang = segment.language || 'ko'; row.append(p);
  }
  $('captions').append(row); while ($('captions').children.length > 40) $('captions').firstElementChild.remove();
  $('captions').scrollTop = $('captions').scrollHeight;
  $('processing').textContent = `${(segment.processingMs / 1000).toFixed(1)}s PROCESSING`;
}
function renderStatus(state) {
  const running = soundchecking || ['live', 'connecting', 'reconnecting', 'finishing'].includes(state.phase);
  $('start').disabled = running || !config.liveReady; $('rehearsal').disabled = running; $('stop').disabled = !running;
  $('soundcheck').disabled = running;
  $('target').disabled = running; $('topic').disabled = running; $('context').disabled = running;
  if (state.targetLanguage) { $('target').value = state.targetLanguage; $('target-code').textContent = state.targetLanguage.toUpperCase(); }
  $('status').textContent = state.phase === 'live' ? (state.mode === 'rehearsal' ? 'SAMPLE SESSION' : 'ON AIR') : state.phase.toUpperCase();
  $('status').classList.toggle('live', state.phase === 'live');
  $('mode-label').textContent = state.mode === 'live' ? 'LIVE API SESSION' : 'REHEARSAL / FIXED TEXT + TEST TONE';
  if (state.phase === 'live' && state.mode === 'rehearsal') notice('Local rehearsal: fixed sample captions and a test tone. No live transcription or Korean speech synthesis is being tested.');
  if (state.phase === 'live' && state.mode === 'live') notice('Receiving Main Stage audio. Attendees can read translated captions and enable audio.');
  if (state.phase === 'connecting') notice('Connecting to the transcription service…');
  if (state.phase === 'reconnecting') notice('Recognition reconnecting. Briefly buffering incoming audio…', true);
  if (state.phase === 'finishing') notice('Finishing the last captured speech…');
}
function renderTerms() {
  const query = $('term-search').value.toLowerCase();
  const ordered = terms.filter(t => [t.term, ...t.aliases].some(s => s.toLowerCase().includes(query)))
    .sort((a, b) => Number(b.category === $('topic').value) - Number(a.category === $('topic').value));
  $('terms').replaceChildren(...ordered.slice(0, 65).map(t => {
    const span = document.createElement('span'); span.className = `term${t.category === $('topic').value ? ' topic' : ''}`;
    span.textContent = t.term; span.title = `${t.category}${t.aliases.length ? ' / ' + t.aliases.join(', ') : ''}`; return span;
  }));
}
async function openDesk() {
  config = await api('/api/config');
  $('login').hidden = true; $('desk').hidden = false;
  $('topic').replaceChildren(...config.topics.map(topic => { const option = document.createElement('option'); option.value = topic; option.textContent = topic.charAt(0).toUpperCase() + topic.slice(1); return option; }));
  $('target').replaceChildren(...config.languages.map(l => { const option = document.createElement('option'); option.value = l.code; option.textContent = `${l.native} / ${l.name}`; return option; }));
  $('target').value = config.targetLanguage;
  $('target-code').textContent = config.targetLanguage.toUpperCase();
  $('translation-heading').textContent = `TRANSLATION / ${config.languages.find(l => l.code === config.targetLanguage).native}`;
  $('provider-note').textContent = `${config.providers.recognition} recognition · ${config.providers.translation} translation · ${config.providers.speech} speech. Configuration presence does not verify service readiness.`;
  $('topic').value = 'privacy'; $('term-count').textContent = `${config.termCount} TERMS / 10 TOPICS`;
  $('qr').src = config.qr; $('viewer-link').href = config.viewerUrl;
  $('public-note').textContent = config.publicReady ? 'Attendee link uses the configured public origin. Test it on a physical phone.' : 'Local rehearsal link. Phones need a reachable HTTPS address configured as PUBLIC_BASE_URL.';
  terms = (await api('/api/terms')).terms; renderTerms(); renderStatus(config);
  if (!config.liveReady) notice('Local rehearsal is ready. Live capture needs the server’s provider configuration; see README.md.', true);
  events?.close(); events = new EventSource('/api/events');
  events.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.type === 'snapshot') { for (const s of event.history) renderCaption(s); renderStatus(event); }
    if (event.type === 'reset') { $('captions').replaceChildren(); $('partial').textContent = ''; }
    if (event.type === 'caption') { renderCaption(event.segment); $('partial').textContent = ''; }
    if (event.type === 'partial') $('partial').textContent = event.text;
    if (event.type === 'status') renderStatus(event);
    if (event.type === 'issue') notice(event.message, true);
  };
  events.onerror = () => notice('Desk connection interrupted. Captions will reconnect automatically.', true);
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('/api/login', { token: $('token').value.trim() }); $('token').value = ''; await openDesk(); }
  catch (error) { $('login-error').textContent = error.message; }
});
$('target').addEventListener('change', async () => {
  try { await api('/api/settings', { targetLanguage: $('target').value }); config.targetLanguage = $('target').value; $('target-code').textContent = config.targetLanguage.toUpperCase(); $('translation-heading').textContent = `TRANSLATION / ${config.languages.find(l => l.code === config.targetLanguage).native}`; }
  catch (error) { $('target').value = config.targetLanguage; notice(error.message, true); }
});
$('source').addEventListener('change', () => { $('device-controls').hidden = $('source').value !== 'input'; });
$('find-devices').addEventListener('click', async () => {
  try {
    const permission = await navigator.mediaDevices.getUserMedia({ audio: true }); permission.getTracks().forEach(t => t.stop());
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    $('device').replaceChildren(...devices.map((d, index) => { const option = document.createElement('option'); option.value = d.deviceId; option.textContent = d.label || `Audio input ${index + 1}`; return option; }));
  } catch (error) { notice(`Audio device access: ${error.message}`, true); }
});
$('rehearsal').addEventListener('click', async () => { try { await api('/api/rehearsal', {}); } catch (error) { notice(error.message, true); } });
async function stopCapture() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
  const old = capture; capture = null; await old?.stop(); $('meter').value = 0; $('level-label').textContent = '−∞ dB'; $('input-tag').textContent = 'DISCONNECTED';
  if (soundchecking) { soundchecking = false; renderStatus({ phase: 'idle', mode: 'idle' }); notice('Soundcheck stopped.'); }
}
const showLevel = value => { $('meter').value = value; $('level-label').textContent = `${Math.round(20 * Math.log10(Math.max(value, 0.00001)))} dB`; };
$('soundcheck').addEventListener('click', async () => {
  $('soundcheck').disabled = true;
  try {
    capture = await chooseAudio($('source').value, $('device').value);
    soundchecking = true;
    await capture.connect(() => {}, showLevel, stopCapture);
    renderStatus({ phase: 'idle', mode: 'idle' }); $('status').textContent = 'SOUNDCHECK'; $('input-tag').textContent = 'LOCAL AUDIO';
    notice(`Local soundcheck: ${capture.label}. Watch the input meter while speech plays. Audio stays on this device.`);
  } catch (error) { await stopCapture(); $('soundcheck').disabled = false; notice(error.message, true); }
});
$('start').addEventListener('click', async () => {
  $('start').disabled = true;
  try {
    capture = await chooseAudio($('source').value, $('device').value);
    $('input-tag').textContent = 'INPUT SELECTED'; notice(`Selected: ${capture.label}. Connecting…`);
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/capture`);
    await new Promise((resolve, reject) => {
      socket.onopen = () => socket.send(JSON.stringify({ type: 'start', topic: $('topic').value, context: $('context').value }));
      socket.onmessage = ({ data }) => { if (JSON.parse(data).type === 'ready') resolve(); };
      socket.onerror = () => reject(Error('Capture connection failed. Check live provider configuration.'));
      socket.onclose = () => reject(Error('Capture connection closed before becoming ready.'));
    });
    socket.onclose = () => { const old = capture; capture = null; old?.stop(); $('input-tag').textContent = 'DISCONNECTED'; };
    await capture.connect(buffer => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 128000) { stopCapture(); notice('Audio upload fell behind. Capture stopped; check the network.', true); return; }
      socket.send(buffer);
    }, showLevel, stopCapture);
    $('input-tag').textContent = 'AUDIO CONNECTED';
  } catch (error) { await stopCapture(); notice(error.message, true); $('start').disabled = !config.liveReady; }
});
$('stop').addEventListener('click', async () => {
  try { if (capture || socket?.readyState === WebSocket.OPEN) await stopCapture(); else await api('/api/stop', {}); }
  catch (error) { notice(error.message, true); }
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(config.viewerUrl); notice('Attendee link copied.'); }
  catch { notice('Copy the attendee link from Open phone view.', true); }
});
$('term-search').addEventListener('input', renderTerms); $('topic').addEventListener('change', renderTerms);
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ terms, koreanReview: 'not reviewed' }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'bitcoin-terminology.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
api('/api/health').then(health => { if (health.operatorAuthenticated) return openDesk(); }).catch(() => {});
window.addEventListener('pagehide', () => { capture?.stop(); socket?.close(); events?.close(); });
