import { chooseAudio } from './capture.js';
const $ = id => document.getElementById(id);
let config, terms = [], events, capture, socket;
let localPhase = 'idle', localMode = 'idle', attempt = 0, serverState = { phase: 'idle', mode: 'idle' }, lastIssue = '';
let lastEventAt = Date.now(), polling = false;
const notice = (message, warning = false) => { $('notice').textContent = message; $('notice').classList.toggle('warning', warning); };
async function api(path, body, signal) {
  const response = await fetch(path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
  const value = await response.json(); if (!response.ok) throw Error(value.error || 'Request failed'); return value;
}
function renderCaption(segment) {
  if ($('captions').querySelector(`[data-id="${Number(segment.id)}"]`)) return;
  if ($('captions').querySelector('.empty')) $('captions').replaceChildren();
  const row = document.createElement('article'); row.className = 'caption-row'; row.dataset.id = segment.id;
  for (const [key, cls] of [['english', 'en'], ['korean', 'ko']]) {
    const p = document.createElement('p'); p.className = cls; p.lang = key === 'korean' ? 'ko' : 'en'; p.textContent = key === 'korean' ? (segment.translated || segment.korean) : segment[key]; if (key === 'korean') p.lang = segment.language || 'ko'; row.append(p);
  }
  $('captions').append(row); while ($('captions').children.length > 40) $('captions').firstElementChild.remove();
  $('captions').scrollTop = $('captions').scrollHeight;
  $('processing').textContent = `${(segment.processingMs / 1000).toFixed(1)}s PROCESSING`;
}
function renderStatus(update = {}) {
  serverState = { ...serverState, ...update };
  const local = localPhase !== 'idle';
  const state = local ? { ...serverState, phase: localPhase === 'live' && serverState.phase === 'reconnecting' ? 'reconnecting' : localPhase, mode: localMode } : serverState;
  const running = local || ['live', 'connecting', 'reconnecting', 'finishing'].includes(state.phase);
  $('start').disabled = running || !config.liveReady; $('rehearsal').disabled = running; $('stop').disabled = !running;
  $('soundcheck').disabled = running;
  $('target').disabled = running; $('topic').disabled = running; $('context').disabled = running;
  if (state.targetLanguage) { $('target').value = state.targetLanguage; $('target-code').textContent = state.targetLanguage.toUpperCase(); }
  $('status').textContent = state.phase === 'live' ? (state.mode === 'rehearsal' ? 'SAMPLE SESSION' : 'ON AIR') : state.phase.toUpperCase();
  $('status').classList.toggle('live', state.phase === 'live');
  $('mode-label').textContent = state.mode === 'soundcheck' ? 'LOCAL SOUNDCHECK / NO TRANSLATION' : state.mode === 'live' ? 'LIVE API SESSION' : 'REHEARSAL / FIXED TEXT + TEST TONE';
  if (state.phase === 'live' && state.mode === 'rehearsal') notice('Local rehearsal: fixed sample captions and a test tone. No live transcription or Korean speech synthesis is being tested.');
  if (state.phase === 'live' && state.mode === 'live') notice('Receiving Main Stage audio. Attendees can read translated captions and enable audio.');
  if (state.phase === 'connecting') notice('Connecting to the transcription service…');
  if (state.phase === 'reconnecting') notice('Recognition is delayed or reconnecting. Buffering speech and catching up…', true);
  if (state.phase === 'finishing') notice('Finishing the last captured speech…');
  const empty = $('captions').querySelector('.empty');
  if (empty) {
    const checking = state.mode === 'soundcheck', live = state.phase === 'live' && state.mode === 'live';
    empty.querySelector('h3').textContent = checking ? 'Soundcheck: audio only.' : live ? 'Listening for English speech.' : 'Ready when the speaker is.';
    empty.querySelector('p').textContent = checking ? 'Stop the check, then choose audio & go live for translated captions.' : live ? 'The first caption takes a few seconds after speech starts.' : 'Choose an audio source or run a local rehearsal.';
  }
}
function recoverSnapshot(state) {
  if (state.lastIssue && state.lastIssue.sessionId === state.sessionId) lastIssue = state.lastIssue.message;
  for (const segment of state.history || []) renderCaption(segment);
  const finished = localPhase === 'finishing' && ['idle', 'error'].includes(state.phase);
  if (finished) { localPhase = 'idle'; localMode = 'idle'; }
  renderStatus(state);
  if (finished) notice(state.phase === 'error' ? lastIssue || 'The session stopped with an error. Choose audio & go live to retry.' : 'Session stopped. Choose audio & go live to start again.', state.phase === 'error');
}
async function recoverCaptions() {
  if (polling || !['live', 'finishing'].includes(localPhase) || Date.now() - lastEventAt < 5000) return;
  const id = attempt; polling = true;
  try {
    const state = await api('/api/config', undefined, AbortSignal.timeout(10000));
    if (id === attempt) recoverSnapshot(state);
  } catch { if (id === attempt) notice('Caption connection interrupted. Retrying; Stop remains available.', true); }
  finally { polling = false; }
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
    const event = JSON.parse(data); lastEventAt = Date.now();
    if (event.type === 'snapshot') recoverSnapshot(event);
    if (event.type === 'reset') { $('captions').replaceChildren(); $('partial').textContent = ''; }
    if (event.type === 'caption') { renderCaption(event.segment); $('partial').textContent = ''; }
    if (event.type === 'partial') $('partial').textContent = event.text;
    if (event.type === 'status') {
      if (localPhase === 'finishing' && ['idle', 'error'].includes(event.phase)) { localPhase = 'idle'; localMode = 'idle'; }
      renderStatus(event);
    }
    if (event.type === 'issue') { lastIssue = event.message; notice(event.message, true); }
  };
  events.onerror = () => { lastEventAt = 0; notice('Caption stream interrupted. Recovering current captions automatically.', true); };
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
async function stopCapture({ cancel = false } = {}) {
  const wasLive = localMode === 'live' && localPhase === 'live', wasSoundcheck = localMode === 'soundcheck';
  ++attempt; lastEventAt = 0;
  const old = capture, oldSocket = socket; capture = null; socket = null;
  localPhase = wasLive && !cancel ? 'finishing' : 'idle';
  if (localPhase === 'idle') localMode = 'idle';
  if (oldSocket?.readyState === WebSocket.OPEN) oldSocket.send(JSON.stringify({ type: 'stop' }));
  oldSocket?.close();
  await old?.stop();
  $('meter').value = 0; $('level-label').textContent = '−∞ dB'; $('input-tag').textContent = 'DISCONNECTED';
  renderStatus(localPhase === 'idle' ? { phase: 'idle' } : {});
  if (wasSoundcheck) notice('Soundcheck stopped. Choose audio & go live to start translation.');
}
const showLevel = value => { $('meter').value = value; $('level-label').textContent = `${Math.round(20 * Math.log10(Math.max(value, 0.00001)))} dB`; };
$('soundcheck').addEventListener('click', async () => {
  const id = ++attempt; localPhase = 'selecting'; localMode = 'soundcheck'; renderStatus();
  try {
    const selected = await chooseAudio($('source').value, $('device').value);
    if (id !== attempt) { await selected.stop(); return; }
    capture = selected; localPhase = 'soundcheck'; renderStatus();
    await selected.connect(() => {}, value => { if (id === attempt) showLevel(value); }, () => { if (id === attempt) void stopCapture(); });
    if (id !== attempt) return;
    $('input-tag').textContent = 'LOCAL AUDIO';
    notice(`Soundcheck only: ${selected.label}. No translation is running. Stop this check, then choose audio & go live.`);
  } catch (error) { if (id === attempt) { await stopCapture({ cancel: true }); notice(error.message, true); } }
});
$('start').addEventListener('click', async () => {
  const id = ++attempt; localPhase = 'selecting'; localMode = 'live'; lastIssue = ''; renderStatus();
  notice('Choose the audio source for live translation.');
  try {
    const selected = await chooseAudio($('source').value, $('device').value);
    if (id !== attempt) { await selected.stop(); return; }
    capture = selected; localPhase = 'connecting'; renderStatus();
    $('input-tag').textContent = 'INPUT SELECTED';
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/capture`); socket = ws; let captureSession;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Live connection timed out. Stop and try again.')), 12000);
      const done = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      ws.onopen = () => ws.send(JSON.stringify({ type: 'start', topic: $('topic').value, context: $('context').value }));
      ws.onmessage = ({ data }) => { const event = JSON.parse(data); if (event.type === 'ready') { captureSession = event.sessionId; done(); } };
      ws.onerror = () => done(Error('Capture connection failed. Check the connection and try again.'));
      ws.onclose = () => done(Error('Capture connection closed before becoming ready.'));
    });
    if (id !== attempt) return;
    $('captions').replaceChildren(); $('partial').textContent = ''; $('processing').textContent = 'WAITING FOR TRANSCRIPT';
    ws.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (socket === ws && event.type === 'issue') { lastIssue = event.message; notice(lastIssue, true); }
      if (socket === ws && event.type === 'warning') notice(event.message, true);
    };
    ws.onclose = event => {
      if (socket !== ws) return;
      const old = capture; capture = null; socket = null; const endedAttempt = ++attempt; localPhase = 'idle'; localMode = 'idle';
      void old?.stop(); $('meter').value = 0; $('level-label').textContent = '−∞ dB'; $('input-tag').textContent = 'DISCONNECTED';
      renderStatus({ phase: 'error' }); notice(lastIssue || `Live audio connection closed${event?.code ? ` (code ${event.code})` : ''}. Choose audio & go live to try again.`, true);
      if (!lastIssue && captureSession) void api('/api/config', undefined, AbortSignal.timeout(5000)).then(state => {
        if (endedAttempt === attempt && state.sessionId === captureSession && state.lastIssue?.sessionId === captureSession) {
          lastIssue = state.lastIssue.message; notice(lastIssue, true);
        }
      }).catch(() => {});
    };
    await selected.connect(buffer => {
      if (id !== attempt) return;
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 128000) { void stopCapture({ cancel: true }); notice('Audio upload fell behind. Capture stopped; check the network.', true); return; }
      ws.send(buffer);
    }, value => { if (id === attempt) showLevel(value); }, () => { if (id === attempt) void stopCapture(); });
    if (id !== attempt) return;
    localPhase = 'live'; renderStatus(); $('input-tag').textContent = 'AUDIO CONNECTED';
  } catch (error) { if (id === attempt) { await stopCapture({ cancel: true }); notice(error.message, true); } }
});
$('stop').addEventListener('click', async () => {
  try {
    if (localPhase !== 'idle' && localPhase !== 'finishing') await stopCapture();
    else { await api('/api/stop', {}); localPhase = 'idle'; localMode = 'idle'; renderStatus({ phase: 'idle' }); notice('Session stopped.'); }
  } catch (error) { notice(error.message, true); }
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
const recoveryTimer = setInterval(recoverCaptions, 2500);
window.addEventListener('pagehide', () => { clearInterval(recoveryTimer); ++attempt; capture?.stop(); socket?.close(); events?.close(); });
