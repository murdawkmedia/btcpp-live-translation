const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token');
const audio = $('audio');
let listening = false, playing = false, queue = [], lastAudio = null, target = 'ko', events;
const wording = {
  ko: { listen: '▶ 한국어 음성 듣기', pause: 'Ⅱ 음성 일시정지', jump: '지금부터 듣기', original: '영어 원문 보기',
    heading: '당신의 언어로, 함께 듣다.', intro: '메인 무대의 한국어 자막과 음성 통역', headphones: '이어폰을 사용해 주세요. 음성을 들으려면 위 버튼을 눌러 주세요.',
    waiting: '통역이 시작될 때까지 기다려 주세요.', live: '실시간 한국어 통역이 진행 중입니다.', sample: '리허설: 샘플 자막과 테스트 신호음입니다. 실제 음성 통역이 아닙니다.',
    on: '통역 중', off: '대기 중', sampleTag: '샘플', skipped: '지연된 음성을 건너뛰고 실시간 통역으로 이동합니다.',
    failed: '음성을 재생하려면 듣기 버튼을 다시 눌러 주세요.', speechFailed: '음성을 일시적으로 사용할 수 없습니다. 자막을 확인해 주세요.',
    reconnect: '연결이 끊겼습니다. 자동으로 다시 연결합니다.', missing: '참가자 링크가 없습니다. 행사 QR 코드를 다시 스캔해 주세요.' },
  en: { listen: '▶ Listen to translation', pause: 'Ⅱ Pause audio', jump: 'Jump to live', original: 'Show English original',
    heading: 'Listen in your language.', intro: 'Main Stage translated captions and audio', headphones: 'Use headphones. Tap Listen to enable audio.',
    waiting: 'Waiting for the session to start.', live: 'Live translation is running.', sample: 'Rehearsal: fixed Korean captions and a test tone. This is not live speech translation.',
    on: 'LIVE', off: 'WAITING', sampleTag: 'SAMPLE', skipped: 'Skipping delayed audio and returning to live.',
    failed: 'Tap Listen again to enable audio.', speechFailed: 'Audio is temporarily unavailable. Captions remain available.',
    reconnect: 'Connection interrupted. Reconnecting automatically.', missing: 'Attendee link missing. Scan the event QR code again.' }
};
const words = () => wording[target === 'ko' ? 'ko' : 'en'];
const notice = (text, warning = false) => { $('notice').textContent = text; $('notice').classList.toggle('warning', warning); };
const button = () => { $('listen').textContent = words()[listening ? 'pause' : 'listen']; };
function caption(segment) {
  document.body.classList.add('has-captions');
  if ($('captions').querySelector('.empty')) $('captions').replaceChildren();
  if ($('captions').querySelector(`[data-id="${Number(segment.id)}"]`)) return;
  const article = document.createElement('article'); article.className = 'phone-caption'; article.dataset.id = segment.id;
  for (const [text, cls, lang] of [[segment.translated || segment.korean, 'ko', segment.language || 'ko'], [segment.english, 'en', 'en']]) {
    const p = document.createElement('p'); p.className = cls; p.lang = lang; p.textContent = text; article.append(p);
  }
  $('captions').prepend(article); while ($('captions').children.length > 10) $('captions').lastElementChild.remove();
}
function state(event) {
  target = event.targetLanguage || 'ko'; const ui = words(), sample = event.mode === 'rehearsal';
  document.documentElement.lang = target === 'ko' ? 'ko' : 'en';
  document.querySelector('h1').textContent = ui.heading;
  document.querySelector('.listener-intro').textContent = `${ui.intro} · ${event.direction}`;
  document.querySelector('.eyebrow').textContent = `${event.stage} / ${event.direction}`;
  $('jump').textContent = ui.jump; $('original-label').textContent = ui.original; $('headphones-note').textContent = ui.headphones; button();
  $('status').textContent = event.phase === 'live' ? (sample ? ui.sampleTag : ui.on) : ui.off;
  $('status').classList.toggle('live', event.phase === 'live');
  notice(sample ? ui.sample : event.phase === 'live' ? ui.live : ui.waiting);
}
async function playNext() {
  if (!listening || playing || !queue.length) return;
  const next = queue.shift();
  if (Date.now() - next.createdAt > 20000) { notice(words().skipped, true); return playNext(); }
  playing = true; audio.src = `/api/audio/${next.id}?token=${encodeURIComponent(token)}`;
  try { await audio.play(); }
  catch { listening = false; playing = false; button(); notice(words().failed, true); }
}
audio.onended = () => { playing = false; void playNext(); };
audio.onerror = () => { playing = false; notice(words().speechFailed, true); void playNext(); };
function resetAudio() { queue = []; playing = false; audio.pause(); audio.removeAttribute('src'); audio.load(); }
function silence() {
  const buffer = new ArrayBuffer(364), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 356, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 320, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
$('listen').addEventListener('click', async () => {
  if (listening) { listening = false; resetAudio(); button(); return; }
  listening = true; button();
  if (lastAudio && Date.now() - lastAudio.createdAt < 10000) { queue.push(lastAudio); void playNext(); }
  else {
    const url = silence(); audio.src = url; playing = true;
    try { await audio.play(); } catch { listening = false; playing = false; button(); notice(words().failed, true); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
});
$('jump').addEventListener('click', () => { resetAudio(); lastAudio = null; notice(words().skipped); });
$('show-english').addEventListener('change', () => document.body.classList.toggle('show-english', $('show-english').checked));
if (!token) notice(words().missing, true);
else {
  events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.type === 'snapshot') { resetAudio(); $('captions').replaceChildren(); for (const s of event.history) caption(s); state(event); lastAudio = event.history.filter(s => s.audioReady).at(-1) || null; }
    if (event.type === 'reset') { resetAudio(); lastAudio = null; $('captions').replaceChildren(); }
    if (event.type === 'caption') caption(event.segment);
    if (event.type === 'status') state(event);
    if (event.type === 'audio') {
      lastAudio = event;
      if (listening) { if (queue.length >= 3) { queue = []; notice(words().skipped, true); } queue.push(event); void playNext(); }
    }
    if (event.type === 'issue') notice(event.stage === 'speech' ? words().speechFailed : words().reconnect, true);
  };
  events.onerror = () => { resetAudio(); lastAudio = null; notice(words().reconnect, true); };
}
window.addEventListener('pagehide', () => { events?.close(); resetAudio(); });
