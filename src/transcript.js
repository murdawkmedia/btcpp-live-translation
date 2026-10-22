// xAI utterance finals stitch earlier chunk finals. Emit each time span once.
export class TranscriptAssembler {
  end = 0;
  committed = '';
  accept(event) {
    if (event.type !== 'transcript.partial' || !event.is_final || !event.text?.trim()) return null;
    const start = Number(event.start || 0);
    const end = start + Number(event.duration || 0);
    if (end && end <= this.end + 0.001) {
      if (event.speech_final) this.committed = '';
      return null;
    }
    let text = event.text.trim();
    if (start < this.end - 0.01) {
      if (event.words?.length) {
        text = event.words.filter(word => word.start >= this.end - 0.01).map(word => word.text).join(' ');
      } else if (this.committed && text.startsWith(this.committed)) {
        text = text.slice(this.committed.length).trim();
      } else {
        // Ambiguous overlap cannot safely be spoken twice.
        if (event.speech_final) this.committed = '';
        return null;
      }
    }
    this.end = Math.max(this.end, end);
    this.committed = event.speech_final ? '' : `${this.committed} ${text}`.trim();
    return text || null;
  }
}

// Buffered recognition revisits audio around window boundaries. Publish only
// stable words and use their absolute audio positions to suppress overlap.
export class TimedTranscriptAssembler {
  end = -Infinity;
  lastWord = '';
  constructor({ preferSentences = false } = {}) { this.preferSentences = preferSentences; }
  accept(words, offset = 0, stableUntil = Infinity) {
    const output = [];
    if (this.preferSentences && Number.isFinite(stableUntil)) {
      const stable = words.filter(word => Number(word.end) + offset <= stableUntil + 0.001 && Number(word.end) + offset > this.end + 0.001);
      const boundary = stable.findLastIndex(word => /[.!?]["')\]]?$/.test(String(word.word || '').trim()));
      if (boundary >= 0) stableUntil = Number(stable[boundary].end) + offset;
      else if (!stable.length || Number(stable.at(-1).end) + offset - Math.max(Number(stable[0].start) + offset, Number.isFinite(this.end) ? this.end : 0) < 4) return '';
    }
    for (const word of words) {
      const start = Number(word.start) + offset, end = Number(word.end) + offset;
      const text = String(word.word || '').trim(), key = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start || start < 0 || end > stableUntil + 0.001) continue;
      if (end <= this.end + 0.001 || start < this.end - 0.12) continue;
      if (start < this.end - 0.01 && key === this.lastWord) continue;
      output.push(text); this.end = end; this.lastWord = key;
    }
    return output.join(' ').replace(/\s+([,.;:!?])/g, '$1');
  }
}
