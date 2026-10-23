import { EventEmitter } from 'node:events';
import { LiveDraft } from './live-draft.js';

export class Pipeline extends EventEmitter {
  constructor(provider, { maxQueue = 6, maxSpeechQueue = 3, maxHistory = 80, maxAudioBytes = 24 * 1024 * 1024, draftIntervalMs = 2000 } = {}) {
    if (!Number.isInteger(maxSpeechQueue) || maxSpeechQueue < 1) throw Error('Invalid voice queue capacity');
    super(); Object.assign(this, { provider, maxQueue, maxSpeechQueue, maxHistory, maxAudioBytes });
    this.history = []; this.transcripts = []; this.audio = new Map(); this.audioBytes = 0;
    this.queue = []; this.sequence = 0; this.generation = 0; this.running = false;
    this.speechQueue = []; this.speechRunning = false;
    this.controller = new AbortController();
    this.currentTranslation = null;
    this.liveDraft = new LiveDraft(provider, { intervalMs: draftIntervalMs, previous: () => this.history.slice(-2), emit: draft => this.event({ type: 'draft', draft }) });
  }
  get draft() { return this.liveDraft.snapshot(); }
  preview(text) { this.liveDraft.update(text); }
  clearPreview() { this.liveDraft.clear(); }
  submit(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw Error('Invalid transcript segment');
    if (this.queue.length >= this.maxQueue) throw Error('Translation queue reached capacity; stop and restart capture.');
    const pretranslated = this.liveDraft.commit(text);
    const transcript = { id: ++this.sequence, english: text, createdAt: Date.now(), audioReady: false };
    this.transcripts.push(transcript);
    while (this.transcripts.length > this.maxHistory) this.transcripts.shift();
    this.event({ type: 'transcript', segment: { ...transcript } });
    return new Promise(resolve => {
      this.queue.push({ text, transcript, pretranslated, generation: this.generation, receivedAt: Date.now(), resolve });
      this.run();
    });
  }
  cancel() {
    this.liveDraft.clear(); this.currentTranslation = null;
    this.generation++; this.controller.abort(); this.controller = new AbortController();
    for (const item of this.queue.splice(0)) item.resolve(false);
    for (const { item } of this.speechQueue.splice(0)) item.resolve(false);
  }
  event(value) { this.emit('event', value); }
  async drain() {
    if (!this.running && !this.queue.length && !this.speechRunning && !this.speechQueue.length) return;
    await new Promise(resolve => this.once('idle', resolve));
  }
  async run() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const item = this.queue.shift();
      const signal = this.controller.signal;
      const current = () => item.generation === this.generation && !signal.aborted;
      try {
        let lastEmit = -Infinity;
        const translated = item.pretranslated ?? await this.provider.translate(item.text, signal, this.history.slice(-2), { onDelta: translated => {
          if (!current()) return;
          this.currentTranslation = { ...item.transcript, translated, language: this.provider.targetLanguage || 'ko', provisional: true };
          if (Date.now() - lastEmit >= 80) { lastEmit = Date.now(); this.event({ type: 'caption-draft', segment: { ...this.currentTranslation } }); }
        } });
        if (!current()) { item.resolve(false); continue; }
        this.currentTranslation = null;
        const language = this.provider.targetLanguage || 'ko';
        const segment = { id: item.transcript.id, english: item.text, translated, language,
          ...(language === 'ko' ? { korean: translated } : {}),
          createdAt: Date.now(), processingMs: Date.now() - item.receivedAt, audioReady: false };
        this.history.push(segment);
        while (this.history.length > this.maxHistory) this.removeAudio(this.history.shift().id);
        this.event({ type: 'caption', segment: { ...segment } });
        if (this.provider.speechEnabled === false) { item.resolve(true); continue; }
        while (this.speechQueue.length >= this.maxSpeechQueue) {
          const skipped = this.speechQueue.shift(); skipped.item.resolve(true);
          this.event({ type: 'issue', stage: 'speech', message: 'Voice is falling behind; older audio skipped. Captions remain available.' });
        }
        this.speechQueue.push({ segment, item, signal }); void this.runSpeech();
      } catch {
        if (current()) {
          this.currentTranslation = null; item.transcript.failed = true;
          this.event({ type: 'caption-draft', segment: { ...item.transcript } });
          this.event({ type: 'issue', stage: 'translation', message: 'Translation failed for a segment. Check the provider and restart if this persists.' });
        }
        item.resolve(false);
      }
    }
    this.running = false;
    this.checkIdle();
  }
  async runSpeech() {
    if (this.speechRunning) return;
    this.speechRunning = true;
    while (this.speechQueue.length) {
      const { segment, item, signal } = this.speechQueue.shift();
      const current = () => item.generation === this.generation && !signal.aborted;
      if (!current()) { item.resolve(false); continue; }
      if (!this.history.includes(segment) || Date.now() - segment.createdAt > 20000) { item.resolve(true); continue; }
      try {
        const audio = await this.provider.speak(segment.translated, signal);
        if (!current()) { item.resolve(false); continue; }
        if (!this.history.includes(segment)) { item.resolve(true); continue; }
        if (!audio?.data?.length || audio.data.length > this.maxAudioBytes) throw Error('Audio size invalid');
        while (this.audioBytes + audio.data.length > this.maxAudioBytes && this.audio.size) this.removeAudio(this.audio.keys().next().value);
        this.audio.set(segment.id, audio); this.audioBytes += audio.data.length;
        segment.audioReady = true;
        this.event({ type: 'audio', id: segment.id, createdAt: segment.createdAt });
      } catch {
        if (current()) this.event({ type: 'issue', stage: 'speech', message: 'Audio unavailable for this caption; text remains available.' });
      }
      item.resolve(current());
    }
    this.speechRunning = false; this.checkIdle();
  }
  checkIdle() {
    if (!this.running && !this.queue.length && !this.speechRunning && !this.speechQueue.length) this.emit('idle');
  }
  removeAudio(id) {
    const audio = this.audio.get(id);
    if (audio) this.audioBytes -= audio.data.length;
    this.audio.delete(id);
    const segment = this.history.find(s => s.id === id);
    if (segment) segment.audioReady = false;
  }
  listenerHistory(limit = 10) {
    const translated = new Map(this.history.map(segment => [segment.id, segment]));
    if (this.currentTranslation) translated.set(this.currentTranslation.id, this.currentTranslation);
    return this.transcripts.slice(-limit).map(segment => translated.get(segment.id) || segment);
  }
}
