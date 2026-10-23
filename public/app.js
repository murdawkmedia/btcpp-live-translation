import { chooseAudio } from './capture.js';
import { initProviderSettings } from './provider-settings.js';
import { scopedUrl, workspacePrefix, initWorkspacePanel } from './workspace.js';
const $ = id => document.getElementById(id);
let config, terms = [], packs = {}, events, capture, socket, providerPanel, workspacePanel, providerBusy = false;
let localPhase = 'idle', localMode = 'idle', attempt = 0, serverState = { phase: 'idle', mode: 'idle' }, lastIssue = '';
let lastEventAt = Date.now(), polling = false, cancelRetry;
let currentDraft = null;
const notice = (message, warning = false) => { $('notice').textContent = message; $('notice').classList.toggle('warning', warning); };
async function api(path, body, signal) {
  const response = await fetch(scopedUrl(path), { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
  const value = await response.json(); if (!response.ok) throw Object.assign(Error(value.error || 'Request failed'), { status: response.status }); return value;
}
function renderCaption(segment) {
  if ($('captions').querySelector('.empty')) $('captions').replaceChildren();
  let row = $('captions').querySelector(`[data-id="${Number(segment.id)}"]`);
  if (!row) {
    row = document.createElement('article'); row.className = 'caption-row'; row.dataset.id = segment.id;
    for (const cls of ['en', 'ko']) { const p = document.createElement('p'); p.className = cls; row.append(p); }
    $('captions').append(row);
  }
  row.children[0].textContent = segment.english; row.children[0].lang = 'en';
  row.children[1].textContent = segment.failed ? 'Translation unavailable.' : segment.translated || segment.korean || 'Translating…';
  row.children[1].lang = segment.language || config.targetLanguage || 'ko';
  if (segment.provisional) { row.dataset.provisional = 'true'; row.dataset.status = 'Live draft · may revise'; }
  else { delete row.dataset.provisional; delete row.dataset.status; }
  while ($('captions').children.length > 40) $('captions').firstElementChild.remove();
  $('captions').scrollTop = $('captions').scrollHeight;
  if (Number.isFinite(segment.processingMs)) $('processing').textContent = `${(segment.processingMs / 1000).toFixed(1)}s PROCESSING`;
}
function renderDraft(draft) {
  currentDraft = draft;
  $('live-draft').hidden = !draft?.english;
  $('live-draft-label').textContent = 'Live draft · may revise';
  $('partial').textContent = draft?.english || '';
  $('draft-translated').textContent = draft?.translated || '';
  $('draft-translated').lang = draft?.language || config?.targetLanguage || 'ko';
}
function renderStatus(update = {}) {
  serverState = { ...serverState, ...update };
  const local = localPhase !== 'idle';
  const state = local ? { ...serverState, phase: localPhase === 'live' && serverState.phase === 'reconnecting' ? 'reconnecting' : localPhase, mode: localMode } : serverState;
  const running = local || ['live', 'connecting', 'reconnecting', 'finishing'].includes(state.phase);
  providerPanel?.setRunning(running);
  $('start').disabled = running || providerBusy || !config.liveReady; $('rehearsal').disabled = running || providerBusy; $('stop').disabled = !running;
  $('soundcheck').disabled = running;
  $('target').disabled = running || providerBusy; $('topic').disabled = running; $('context').disabled = running;
  if (state.targetLanguage) { $('target').value = state.targetLanguage; $('target-code').textContent = state.targetLanguage.toUpperCase(); }
  $('status').textContent = state.phase === 'live' ? (state.mode === 'rehearsal' ? 'SAMPLE SESSION' : 'ON AIR') : state.phase.toUpperCase();
  $('status').classList.toggle('live', state.phase === 'live');
  if (!['live', 'reconnecting', 'finishing'].includes(state.phase)) renderDraft(null);
  $('mode-label').textContent = state.mode === 'soundcheck' ? 'LOCAL SOUNDCHECK / NO TRANSLATION' : state.mode === 'live' ? 'LIVE API SESSION' : 'REHEARSAL / FIXED TEXT + TEST TONE';
  if (state.phase === 'live' && state.mode === 'rehearsal') notice('Local rehearsal: fixed sample captions and a test tone. No live transcription or Korean speech synthesis is being tested.');
  if (state.phase === 'live' && state.mode === 'live') notice('Receiving Main Stage audio. Attendees can read translated captions and enable audio.');
  if (state.phase === 'connecting') notice('Connecting to the transcription service…');
  if (state.phase === 'reconnecting') notice(localPhase === 'reconnecting' ? 'Audio connection interrupted. Reconnecting with the selected input; some speech may be missing.' : 'Recognition is delayed. Buffering speech and catching up…', true);
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
  renderDraft(state.draft || null);
  const finished = localPhase === 'finishing' && ['idle', 'error'].includes(state.phase);
  if (finished) { localPhase = 'idle'; localMode = 'idle'; }
  renderStatus(state);
  if (finished) notice(state.phase === 'error' ? lastIssue || 'The session stopped with an error. Choose audio & go live to retry.' : 'Session stopped. Choose audio & go live to start again.', state.phase === 'error');
}
async function recoverCaptions() {
  if (polling || !['live', 'finishing'].includes(localPhase) || Date.now() - lastEventAt < 5000) return;
  const id = attempt, sourceSocket = socket; polling = true;
  try {
    const state = await api('/api/config', undefined, AbortSignal.timeout(10000));
    if (id === attempt && sourceSocket === socket) recoverSnapshot(state);
  } catch { if (id === attempt) notice('Caption connection interrupted. Retrying; Stop remains available.', true); }
  finally { polling = false; }
}
function renderTerms() {
  const query = $('term-search').value.toLowerCase();
  const packed = new Set(packs[$('topic').value]?.terms || []);
  const inTopic = term => term.category === $('topic').value || packed.has(term.term);
  const ordered = terms.filter(t => [t.term, ...t.aliases].some(s => s.toLowerCase().includes(query)))
    .sort((a, b) => Number(inTopic(b)) - Number(inTopic(a)));
  $('terms').replaceChildren(...ordered.slice(0, 65).map(t => {
    const span = document.createElement('span'); span.className = `term${inTopic(t) ? ' topic' : ''}`;
    span.textContent = t.term; span.title = `${t.category}${t.aliases.length ? ' / ' + t.aliases.join(', ') : ''}`; return span;
  }));
}
async function openDesk() {
  config = await api('/api/config');
  $('login').hidden = true; $('desk').hidden = false;
  $('topic').replaceChildren(...config.topics.map(topic => { const option = document.createElement('option'); option.value = topic; option.textContent = topic === 'seoul' ? 'Seoul main stage' : topic === 'ai' ? 'AI' : topic.charAt(0).toUpperCase() + topic.slice(1); return option; }));
  $('target').replaceChildren(...config.languages.map(l => { const option = document.createElement('option'); option.value = l.code; option.textContent = `${l.native} / ${l.name}`; return option; }));
  $('target').value = config.targetLanguage;
  $('target-code').textContent = config.targetLanguage.toUpperCase();
  $('translation-heading').textContent = `TRANSLATION / ${config.languages.find(l => l.code === config.targetLanguage).native}`;
  $('provider-note').textContent = `${config.providers.recognition} recognition · ${config.providers.translation} translation · ${config.providers.speech} speech. Configuration presence does not verify service readiness.`;
  $('topic').value = 'privacy'; $('term-count').textContent = `${config.termCount} TERMS / ${config.topics.length} TOPICS`;
  $('qr').src = config.qr; $('viewer-link').href = config.viewerUrl;
  $('public-note').textContent = config.publicReady ? 'Attendee link uses the configured public origin. Test it on a physical phone.' : 'Local rehearsal link. Phones need a reachable HTTPS address configured as PUBLIC_BASE_URL.';
  const vocabulary = await api('/api/terms'); terms = vocabulary.terms; packs = vocabulary.packs || {};
  renderTerms(); recoverSnapshot(config);
  const eventOperator = config.workspace?.role === 'operator'; $('provider-panel').hidden = eventOperator;
  if (!eventOperator) {
    providerPanel ||= initProviderSettings({ api,
    onBusy: value => { providerBusy = value; renderStatus(); },
    onChange: async () => {
      config = await api('/api/config'); renderStatus(config);
      $('provider-note').textContent = `${config.providers.recognition} recognition · ${config.providers.translation} translation · ${config.providers.speech === 'none' ? 'voice off' : config.providers.speech + ' speech'}. Use provider checks before going live.`;
    }
  });
    await providerPanel.load(); providerPanel.setRunning(localPhase !== 'idle' || ['live', 'connecting', 'reconnecting', 'finishing'].includes(serverState.phase));
  }
  workspacePanel ||= initWorkspacePanel({ api, onLogout: async () => {
    await stopCapture({ cancel: true }); await api('/api/logout', {}); events?.close(); location.assign((workspacePrefix() || '') + '/');
  } });
  await workspacePanel.load();
  if (!config.liveReady) notice('Set up recognition and translation in Providers below. Voice is optional; local rehearsal is available.', true);
  events?.close(); events = new EventSource(scopedUrl('/api/events'));
  events.onmessage = ({ data }) => {
    const event = JSON.parse(data); lastEventAt = Date.now();
    if (event.type === 'snapshot') recoverSnapshot(event);
    if (event.type === 'reset') { serverState.sessionId = event.sessionId; $('captions').replaceChildren(); renderDraft(null); }
    if (event.sessionId && serverState.sessionId && event.type !== 'snapshot' && event.type !== 'status' && event.sessionId !== serverState.sessionId) return;
    if (['caption', 'caption-draft', 'transcript'].includes(event.type)) renderCaption(event.segment);
    if (event.type === 'draft') renderDraft(event.draft);
    if (event.type === 'partial' && event.text) renderDraft({ ...currentDraft, english: event.text });
    if (event.type === 'status') {
      if (localPhase === 'finishing' && ['idle', 'error'].includes(event.phase)) { localPhase = 'idle'; localMode = 'idle'; }
      renderStatus(event);
    }
    if (event.type === 'issue') { if (event.stage === 'capture') lastIssue = event.message; notice(event.message, true); }
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
  ++attempt; cancelRetry?.(); lastEventAt = 0;
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
function connectionEnded(ws, event, captureSession) {
  if (socket !== ws) return;
  const old = capture; capture = null; socket = null; const endedAttempt = ++attempt; localPhase = 'idle'; localMode = 'idle';
  void old?.stop(); $('meter').value = 0; $('level-label').textContent = '−∞ dB'; $('input-tag').textContent = 'DISCONNECTED';
  renderStatus({ phase: 'error' }); notice(lastIssue || `Live audio connection closed${event?.code ? ` (code ${event.code})` : ''}. Choose audio & go live to try again.`, true);
  if (!lastIssue && captureSession) void api('/api/config', undefined, AbortSignal.timeout(5000)).then(state => {
    if (endedAttempt === attempt && state.sessionId === captureSession && state.lastIssue?.sessionId === captureSession) {
      lastIssue = state.lastIssue.message; notice(lastIssue, true);
    }
  }).catch(() => {});
}
async function openCaptureSocket(id, settings) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${scopedUrl('/api/capture')}`); socket = ws; let captureSession;
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => done(Error('Live connection timed out. Stop and try again.')), 12000);
      const done = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      ws.onopen = () => ws.send(JSON.stringify({ type: 'start', ...settings }));
      ws.onmessage = ({ data }) => {
        const event = JSON.parse(data);
        if (event.type === 'ready') { captureSession = event.sessionId; done(); }
        if (event.type === 'issue') { lastIssue = event.message; done(Error(event.message)); }
      };
      ws.onerror = () => done(Error('Capture connection failed. Check the connection and try again.'));
      ws.onclose = () => done(Error('Capture connection closed before becoming ready.'));
    });
  } catch (error) {
    if (socket === ws) socket = null;
    ws.onclose = null; ws.onerror = null; ws.close(); throw error;
  }
  if (id !== attempt) { ws.close(); return; }
  ws.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (socket === ws && event.type === 'issue') { lastIssue = event.message; notice(lastIssue, true); }
    if (socket === ws && event.type === 'warning') notice(event.message, true);
  };
  ws.onclose = event => {
    if (socket !== ws) return;
    if (localPhase === 'live' && !lastIssue && [1006, 1012, 1013].includes(event.code)) {
      socket = null; void reconnectCapture(id, settings); return;
    }
    connectionEnded(ws, event, captureSession);
  };
  ws.onerror = () => {}; // The close event decides whether a live transport can recover.
  return ws;
}
async function reconnectCapture(id, settings) {
  localPhase = 'reconnecting'; renderStatus(); $('input-tag').textContent = 'RECONNECTING';
  for (let retry = 0; retry < 3; retry++) {
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); cancelRetry = null; resolve(); };
      const timer = setTimeout(done, 1000 * 2 ** retry); cancelRetry = done;
    });
    if (id !== attempt) return;
    try {
      await openCaptureSocket(id, settings);
      if (id !== attempt) return;
      $('captions').replaceChildren(); $('partial').textContent = ''; $('processing').textContent = 'WAITING FOR TRANSCRIPT';
      localPhase = 'live'; renderStatus(); $('input-tag').textContent = 'AUDIO CONNECTED';
      notice('Audio reconnected. Some speech during the interruption may be missing.', true); return;
    } catch { if (id !== attempt) return; if (lastIssue) break; }
  }
  if (id !== attempt) return;
  await stopCapture({ cancel: true }); renderStatus({ phase: 'error' });
  notice(lastIssue || 'Could not reconnect after 3 attempts. Choose audio & go live to try again.', true);
}
$('start').addEventListener('click', async () => {
  const id = ++attempt; localPhase = 'selecting'; localMode = 'live'; lastIssue = ''; renderStatus();
  notice('Choose the audio source for live translation.');
  try {
    const selected = await chooseAudio($('source').value, $('device').value);
    if (id !== attempt) { await selected.stop(); return; }
    capture = selected; localPhase = 'connecting'; renderStatus(); $('input-tag').textContent = 'INPUT SELECTED';
    await openCaptureSocket(id, { topic: $('topic').value, context: $('context').value });
    if (id !== attempt) return;
    $('captions').replaceChildren(); renderDraft(null); $('processing').textContent = 'WAITING FOR TRANSCRIPT';
    await selected.connect(buffer => {
      if (id !== attempt || localPhase === 'reconnecting') return;
      if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 128000) { void stopCapture({ cancel: true }); notice('Audio upload fell behind. Capture stopped; check the network.', true); return; }
      socket.send(buffer);
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
$('brand-link').href = (workspacePrefix() || '') + '/';
if (workspacePrefix()) { $('login-kind').textContent = 'PRIVATE WORKSPACE'; $('token-label').textContent = 'Workspace access code'; $('token').placeholder = 'Enter your workspace access code'; }
api('/api/health').then(health => {
  if (health.workspaceSupport && !workspacePrefix()) { $('login-kind').textContent = 'ADMINISTRATOR ACCESS'; $('token-label').textContent = 'Private administrator code'; $('token').placeholder = 'Enter your private administrator code'; }
  if (health.operatorAuthenticated) return openDesk();
}).catch(() => {});
const recoveryTimer = setInterval(recoverCaptions, 2500);
window.addEventListener('pagehide', () => { clearInterval(recoveryTimer); ++attempt; cancelRetry?.(); capture?.stop(); socket?.close(); events?.close(); });
