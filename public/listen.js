const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token');
const audio = $('audio');
const interfaces = [['en', 'English'], ['ko', '한국어'], ['ja', '日本語'], ['es', 'Español'], ['fr', 'Français'], ['zh', '中文']];
const names = { en: 'English', ko: '한국어', ja: '日本語', es: 'Español', fr: 'Français', zh: '中文' };
let locale = 'en';
try { locale = localStorage.getItem('btcpp-ui-language') || navigator.language.split('-')[0]; } catch {}
if (!names[locale]) locale = 'en';
let view = 'translation';
try { view = localStorage.getItem('btcpp-caption-view') || view; } catch {}
if (!['translation', 'en', 'both'].includes(view)) view = 'translation';
let listening = false, playing = false, queue = [], lastAudio = null, target = 'ko', events, timer;
let current = { phase: 'idle', mode: 'idle', stage: 'Main Stage', targetLanguage: 'ko' }, sessionId, live = false;
let lastEventAt = 0, revision = 0, polling = false, closed = false, denied = false, audioCursor = 0, audioGeneration = 0;
const wording = {
  en: { listen: '▶ Listen to translation', pause: 'Ⅱ Pause audio', jump: 'Jump to live', language: 'Menu language', captions: 'Captions', both: 'Both languages', original: 'English original',
    heading: 'Live translation.', intro: 'Live captions and translated audio from the Main Stage.', headphones: 'Use headphones. Tap Listen to enable translated audio.',
    waiting: 'Waiting for the Main Stage to go live. Captions will appear automatically.', live: 'Live translation is running.', sample: 'Rehearsal: fixed Korean captions and a test tone. This is not live speech translation.',
    on: 'LIVE', off: 'WAITING', sampleTag: 'SAMPLE', skipped: 'Skipping delayed audio and returning to live.', pending: 'Translating…',
    failed: 'Tap Listen again to enable audio.', speechFailed: 'Audio is temporarily unavailable. Captions remain available.', reconnect: 'Connection interrupted. Reconnecting automatically.',
    missing: 'Attendee link missing or invalid. Scan the event QR code again.' },
  ko: { listen: '▶ 통역 음성 듣기', pause: 'Ⅱ 음성 일시 정지', jump: '지금부터 듣기', language: '메뉴 언어', captions: '자막', both: '두 언어 모두', original: '영어 원문',
    heading: '실시간 통역', intro: '메인 무대의 실시간 자막과 통역 음성입니다.', headphones: '이어폰을 사용해 주세요. 음성을 들으려면 듣기 버튼을 눌러 주세요.',
    waiting: '메인 무대 시작을 기다리는 중입니다. 시작하면 자막이 자동으로 표시됩니다.', live: '실시간 통역이 진행 중입니다.', sample: '리허설: 고정된 한국어 샘플 자막과 테스트 신호음입니다. 실제 음성 통역이 아닙니다.',
    on: '통역 중', off: '대기 중', sampleTag: '샘플', skipped: '지연된 음성을 건너뛰고 실시간 통역으로 이동합니다.', pending: '번역 중…',
    failed: '음성을 재생하려면 듣기 버튼을 다시 눌러 주세요.', speechFailed: '음성을 일시적으로 사용할 수 없습니다. 자막을 확인해 주세요.', reconnect: '연결이 끊겼습니다. 자동으로 다시 연결합니다.',
    missing: '참가자 링크가 없거나 유효하지 않습니다. 행사 QR 코드를 다시 스캔해 주세요.' },
  ja: { listen: '▶ 通訳音声を聞く', pause: 'Ⅱ 音声を一時停止', jump: 'ライブに戻る', language: 'メニューの言語', captions: '字幕', both: '両方の言語', original: '英語の原文',
    heading: 'ライブ通訳', intro: 'メインステージのライブ字幕と通訳音声です。', headphones: 'イヤホンを使用し、ボタンを押して音声を有効にしてください。',
    waiting: 'メインステージの開始を待っています。字幕は自動で表示されます。', live: 'ライブ通訳中です。', sample: 'リハーサル：固定の韓国語字幕とテスト音です。ライブ通訳ではありません。',
    on: '配信中', off: '待機中', sampleTag: 'サンプル', skipped: '遅れた音声をスキップしてライブに戻ります。', pending: '翻訳中…',
    failed: '音声ボタンをもう一度押してください。', speechFailed: '音声は一時的に利用できません。字幕をご覧ください。', reconnect: '接続が切れました。自動で再接続します。', missing: '参加者リンクが無効です。会場のQRコードを再度読み取ってください。' },
  es: { listen: '▶ Escuchar traducción', pause: 'Ⅱ Pausar audio', jump: 'Volver al directo', language: 'Idioma del menú', captions: 'Subtítulos', both: 'Ambos idiomas', original: 'Original en inglés',
    heading: 'Traducción en directo.', intro: 'Subtítulos y audio traducido en directo del escenario principal.', headphones: 'Usa auriculares. Pulsa Escuchar para activar el audio traducido.',
    waiting: 'Esperando el inicio. Los subtítulos aparecerán automáticamente.', live: 'La traducción está en directo.', sample: 'Ensayo: subtítulos fijos en coreano y un tono de prueba. No es traducción en directo.',
    on: 'EN DIRECTO', off: 'EN ESPERA', sampleTag: 'PRUEBA', skipped: 'Saltando el audio atrasado para volver al directo.', pending: 'Traduciendo…',
    failed: 'Pulsa Escuchar otra vez para activar el audio.', speechFailed: 'Audio no disponible temporalmente. Los subtítulos siguen disponibles.', reconnect: 'Conexión interrumpida. Reconectando automáticamente.', missing: 'Enlace de acceso ausente o no válido. Escanea de nuevo el código QR del evento.' },
  fr: { listen: '▶ Écouter la traduction', pause: 'Ⅱ Couper le son', jump: 'Revenir au direct', language: 'Langue des menus', captions: 'Sous-titres', both: 'Les deux langues', original: 'Original en anglais',
    heading: 'Traduction en direct.', intro: 'Sous-titres et traduction audio en direct de la scène principale.', headphones: 'Utilisez des écouteurs. Appuyez sur Écouter pour activer le son traduit.',
    waiting: 'En attente du début. Les sous-titres apparaîtront automatiquement.', live: 'La traduction est en direct.', sample: 'Répétition : sous-titres coréens fixes et signal sonore. Ce n’est pas une traduction en direct.',
    on: 'EN DIRECT', off: 'EN ATTENTE', sampleTag: 'EXEMPLE', skipped: 'Le son en retard est ignoré pour revenir au direct.', pending: 'Traduction…',
    failed: 'Appuyez à nouveau sur Écouter pour activer le son.', speechFailed: 'Le son est temporairement indisponible. Les sous-titres restent disponibles.', reconnect: 'Connexion interrompue. Reconnexion automatique.', missing: 'Lien absent ou invalide. Scannez à nouveau le code QR de l’événement.' },
  zh: { listen: '▶ 收听翻译', pause: 'Ⅱ 暂停音频', jump: '返回实时', language: '菜单语言', captions: '字幕', both: '双语', original: '英语原文',
    heading: '实时翻译', intro: '主舞台实时字幕和翻译音频。', headphones: '请使用耳机。点击收听以启用翻译音频。',
    waiting: '正在等待主舞台开始。字幕将自动显示。', live: '正在进行实时翻译。', sample: '彩排：固定韩语字幕和测试音。这不是实时语音翻译。',
    on: '直播中', off: '等待中', sampleTag: '示例', skipped: '跳过延迟音频，返回实时翻译。', pending: '翻译中…',
    failed: '请再次点击收听以启用音频。', speechFailed: '音频暂时不可用，字幕仍然可用。', reconnect: '连接已中断，正在自动重新连接。', missing: '观众链接缺失或无效，请重新扫描活动二维码。' }
};
const words = () => wording[locale];
const recognitionDelay = { en: 'Recognition is catching up. Some earlier speech may be missing.', ko: '음성 인식이 지연되어 일부 내용이 누락될 수 있습니다.',
  ja: '音声認識が遅れているため、一部の発言が欠けている可能性があります。', es: 'El reconocimiento se está poniendo al día. Puede faltar parte del discurso anterior.',
  fr: 'La reconnaissance rattrape son retard. Certains propos précédents peuvent manquer.', zh: '语音识别正在追赶进度，之前的部分内容可能缺失。' };
const notice = (text, warning = false) => { $('notice').textContent = text; $('notice').classList.toggle('warning', warning); };
const button = () => { $('listen').textContent = words()[listening ? 'pause' : 'listen']; };
function renderInterface() {
  const ui = words(); document.documentElement.lang = locale;
  document.querySelector('h1').textContent = ui.heading;
  document.querySelector('.listener-intro').textContent = ui.intro;
  document.querySelector('.eyebrow').textContent = `${current.stage} / English → ${names[target] || target}`;
  $('ui-language').value = locale; $('ui-language-label').textContent = ui.language;
  $('caption-view-label').textContent = ui.captions;
  $('caption-translation').textContent = names[target] || target;
  $('caption-original').textContent = ui.original; $('caption-both').textContent = ui.both;
  $('caption-view').value = view;
  document.body.classList.toggle('show-english', view === 'both'); document.body.classList.toggle('english-only', view === 'en');
  $('jump').textContent = ui.jump; $('headphones-note').textContent = ui.headphones; button();
  $('listen').disabled = !live; $('jump').disabled = !live;
  $('status').textContent = live ? (current.mode === 'rehearsal' ? ui.sampleTag : ui.on) : ui.off;
  $('status').classList.toggle('live', live);
  notice(denied || !token ? ui.missing : live ? current.mode === 'rehearsal' ? ui.sample : ui.live : ui.waiting, denied || !token);
  for (const row of $('captions').children) if (row.dataset.pending) row.children[0].textContent = ui.pending;
}
function emptyCaptions() {
  $('captions').replaceChildren(); document.body.classList.remove('has-captions'); $('english-partial').textContent = '';
  const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = words().waiting; $('captions').append(empty);
}
function caption(segment) {
  if (!live) return;
  document.body.classList.add('has-captions');
  if ($('captions').querySelector('.empty')) $('captions').replaceChildren();
  let article = $('captions').querySelector(`[data-id="${Number(segment.id)}"]`);
  if (!article) {
    article = document.createElement('article'); article.className = 'phone-caption'; article.dataset.id = segment.id;
    const translated = document.createElement('p'); translated.className = 'ko'; article.append(translated);
    const english = document.createElement('p'); english.className = 'en'; english.lang = 'en'; article.append(english);
    $('captions').prepend(article);
  }
  const translated = segment.translated || segment.korean;
  if (translated) { article.children[0].textContent = translated; article.children[0].lang = segment.language || target; delete article.dataset.pending; }
  else if (!article.children[0].textContent) { article.children[0].textContent = words().pending; article.dataset.pending = 'true'; }
  article.children[1].textContent = segment.english;
  while ($('captions').children.length > 10) $('captions').lastElementChild.remove();
}
function resetAudio() { audioGeneration++; queue = []; playing = false; audio.pause(); audio.removeAttribute('src'); audio.load(); }
function resetSession(id) { resetAudio(); lastAudio = null; audioCursor = 0; sessionId = id; emptyCaptions(); }
function state(event) {
  if (event.sessionId && event.sessionId !== sessionId) resetSession(event.sessionId);
  current = { ...current, ...event }; target = current.targetLanguage || 'ko';
  live = !denied && ['live', 'reconnecting', 'finishing'].includes(current.phase);
  if (!live) { listening = false; resetAudio(); lastAudio = null; emptyCaptions(); }
  renderInterface();
}
function acceptAudio(segment) {
  if (!live || segment.id <= audioCursor) return;
  audioCursor = segment.id; lastAudio = segment;
  if (listening && Date.now() - segment.createdAt < 20000) {
    if (queue.length >= 3) { queue = []; notice(words().skipped, true); }
    queue.push(segment); void playNext();
  }
}
async function playNext() {
  if (!live || !listening || playing || !queue.length) return;
  const next = queue.shift();
  if (Date.now() - next.createdAt > 20000) { notice(words().skipped, true); return playNext(); }
  const generation = audioGeneration; playing = true;
  audio.src = `/api/audio/${next.id}?token=${encodeURIComponent(token)}&session=${encodeURIComponent(sessionId || '')}`;
  try { await audio.play(); }
  catch { if (generation === audioGeneration) { listening = false; playing = false; button(); notice(words().failed, true); } }
}
audio.onended = () => { playing = false; void playNext(); };
audio.onerror = () => { if (!live || !listening) return; playing = false; notice(words().speechFailed, true); void playNext(); };
function snapshot(event) {
  state(event); if (!live) return;
  for (const segment of event.history || []) { caption(segment); if (segment.audioReady) acceptAudio(segment); }
}
async function recover() {
  if (closed || denied || polling || Date.now() - lastEventAt < 5000) return;
  polling = true; const version = revision;
  try {
    const response = await fetch(`/api/listener?token=${encodeURIComponent(token)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (closed || version !== revision) return;
    if (response.status === 401) { denied = true; events?.close(); state({ phase: 'idle' }); return; }
    if (!response.ok) throw Error('Caption connection unavailable');
    const value = await response.json();
    if (!closed && version === revision) snapshot(value);
  } catch { if (!closed && version === revision) notice(words().reconnect, true); }
  finally { polling = false; }
}
function silence() {
  const buffer = new ArrayBuffer(364), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 356, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 320, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
$('listen').addEventListener('click', async () => {
  if (!live) return;
  if (listening) { listening = false; resetAudio(); button(); return; }
  listening = true; button();
  if (lastAudio && Date.now() - lastAudio.createdAt < 10000) { queue.push(lastAudio); void playNext(); }
  else {
    const generation = audioGeneration, url = silence(); audio.src = url; playing = true;
    try { await audio.play(); }
    catch { if (generation === audioGeneration) { listening = false; playing = false; button(); notice(words().failed, true); } }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
});
$('jump').addEventListener('click', () => { resetAudio(); lastAudio = null; notice(words().skipped); });
$('ui-language').replaceChildren(...interfaces.map(([code, name]) => { const option = document.createElement('option'); option.value = code; option.textContent = name; return option; }));
$('ui-language').addEventListener('change', () => {
  locale = names[$('ui-language').value] ? $('ui-language').value : 'en';
  try { localStorage.setItem('btcpp-ui-language', locale); } catch {}
  renderInterface(); if (!live) emptyCaptions();
});
$('caption-view').addEventListener('change', () => {
  view = $('caption-view').value;
  try { localStorage.setItem('btcpp-caption-view', view); } catch {}
  renderInterface();
});
emptyCaptions(); renderInterface();
if (token) {
  events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.onmessage = ({ data }) => {
    if (closed || denied) return;
    const event = JSON.parse(data); lastEventAt = Date.now(); revision++;
    if (event.type === 'snapshot') snapshot(event);
    if (event.type === 'reset') resetSession(event.sessionId);
    if (event.type === 'status') state(event);
    if (event.sessionId && event.sessionId !== sessionId) return;
    if (event.type === 'caption' || event.type === 'transcript') { caption(event.segment); $('english-partial').textContent = ''; }
    if (event.type === 'partial' && live) $('english-partial').textContent = event.text;
    if (event.type === 'audio') acceptAudio(event);
    if (event.type === 'issue' && live) notice(event.stage === 'speech' ? words().speechFailed : event.stage === 'recognition' ? recognitionDelay[locale] : words().reconnect, true);
  };
  events.onerror = () => { if (closed || denied) return; lastEventAt = 0; notice(words().reconnect, true); void recover(); };
  void recover(); timer = setInterval(recover, 2500);
}
window.addEventListener('pagehide', () => { closed = true; revision++; clearInterval(timer); events?.close(); resetAudio(); });
