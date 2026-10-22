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
