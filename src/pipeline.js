import { EventEmitter } from 'node:events';

export class Pipeline extends EventEmitter {
  constructor(provider, { maxQueue = 6, maxHistory = 80, maxAudioBytes = 24 * 1024 * 1024 } = {}) {
    super(); Object.assign(this, { provider, maxQueue, maxHistory, maxAudioBytes });
    this.history = []; this.audio = new Map(); this.audioBytes = 0;
    this.queue = []; this.sequence = 0; this.generation = 0; this.running = false;
    this.controller = new AbortController();
  }
  submit(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw Error('Invalid transcript segment');
    if (this.queue.length >= this.maxQueue) throw Error('Translation queue reached capacity; stop and restart capture.');
    return new Promise(resolve => {
      this.queue.push({ text, generation: this.generation, receivedAt: Date.now(), resolve });
      this.run();
    });
  }
  cancel() {
    this.generation++; this.controller.abort(); this.controller = new AbortController();
    for (const item of this.queue.splice(0)) item.resolve(false);
  }
  event(value) { this.emit('event', value); }
  async drain() {
    if (!this.running && !this.queue.length) return;
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
        const translated = await this.provider.translate(item.text, signal, this.history.slice(-2));
        if (!current()) { item.resolve(false); continue; }
        const language = this.provider.targetLanguage || 'ko';
        const segment = { id: ++this.sequence, english: item.text, translated, language,
          ...(language === 'ko' ? { korean: translated } : {}),
          createdAt: Date.now(), processingMs: Date.now() - item.receivedAt, audioReady: false };
        this.history.push(segment);
        while (this.history.length > this.maxHistory) this.removeAudio(this.history.shift().id);
        this.event({ type: 'caption', segment: { ...segment } });
        try {
          const audio = await this.provider.speak(translated, signal);
          if (!current()) { item.resolve(false); continue; }
          if (!audio?.data?.length || audio.data.length > this.maxAudioBytes) throw Error('Audio size invalid');
          while (this.audioBytes + audio.data.length > this.maxAudioBytes && this.audio.size) this.removeAudio(this.audio.keys().next().value);
          this.audio.set(segment.id, audio); this.audioBytes += audio.data.length;
          segment.audioReady = true;
          this.event({ type: 'audio', id: segment.id, createdAt: segment.createdAt });
        } catch {
          if (current()) this.event({ type: 'issue', stage: 'speech', message: 'Audio unavailable for this caption; text remains available.' });
        }
        item.resolve(current());
      } catch {
        if (current()) this.event({ type: 'issue', stage: 'translation', message: 'Translation failed for a segment. Check the provider and restart if this persists.' });
        item.resolve(false);
      }
    }
    this.running = false;
    this.emit('idle');
  }
  removeAudio(id) {
    const audio = this.audio.get(id);
    if (audio) this.audioBytes -= audio.data.length;
    this.audio.delete(id);
    const segment = this.history.find(s => s.id === id);
    if (segment) segment.audioReady = false;
  }
}
