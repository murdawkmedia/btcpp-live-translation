export class LiveDraft {
  constructor(provider, { emit, previous, intervalMs = 2000 }) {
    Object.assign(this, { provider, emit, previous, intervalMs });
    this.value = null; this.pending = null; this.inFlight = null; this.timer = null;
    this.sequence = 0; this.generation = 0; this.lastStart = -Infinity; this.cache = null;
  }
  snapshot() { return this.value ? { ...this.value } : null; }
  update(input) {
    const text = String(input || '').trim().slice(0, 4000);
    if (!text) { this.clear(); return; }
    if (this.value?.english === text) return;
    this.value ||= { id: ++this.sequence, revision: 0, translationRevision: 0, english: '', translated: '', language: this.provider.targetLanguage || 'ko', createdAt: Date.now() };
    this.value.english = text; this.value.revision++; this.emit(this.snapshot());
    if (!this.provider.draftEnabled) return;
    this.pending = { id: this.value.id, revision: this.value.revision, text, generation: this.generation };
    this.schedule();
  }
  schedule() {
    if (this.inFlight || this.timer || !this.pending) return;
    const delay = Math.max(0, this.intervalMs - (Date.now() - this.lastStart));
    if (delay) this.timer = setTimeout(() => { this.timer = null; void this.start(); }, delay);
    else void this.start();
  }
  async start() {
    if (this.inFlight || !this.pending) return;
    const job = { ...this.pending, controller: new AbortController(), lastEmit: -Infinity };
    this.pending = null; this.inFlight = job; this.lastStart = Date.now();
    const current = () => !job.controller.signal.aborted && this.generation === job.generation && this.value?.id === job.id;
    const publish = (text, complete = false) => {
      if (!current() || job.revision < this.value.translationRevision) return;
      this.value.translated = text; this.value.translationRevision = job.revision;
      if (complete || Date.now() - job.lastEmit >= 80) { job.lastEmit = Date.now(); this.emit(this.snapshot()); }
    };
    try {
      const translated = await this.provider.translate(job.text, job.controller.signal, this.previous(), { draft: true, onDelta: text => publish(text) });
      if (current()) { this.cache = { id: job.id, english: job.text, translated }; publish(translated, true); }
    } catch {
      if (current() && this.value.translationRevision === job.revision) { this.value.translated = ''; this.emit(this.snapshot()); }
    } finally { if (this.inFlight === job) this.inFlight = null; this.schedule(); }
  }
  commit(text) {
    const translated = this.cache?.id === this.value?.id && this.cache?.english === text ? this.cache.translated : undefined;
    this.clear(); return translated;
  }
  clear() {
    const visible = this.value !== null;
    this.generation++; this.inFlight?.controller.abort(); clearTimeout(this.timer);
    this.timer = null; this.pending = null; this.cache = null; this.value = null;
    if (visible) this.emit(null);
  }
}
