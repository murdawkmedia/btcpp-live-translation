// Average input samples into 16 kHz mono; preserve phase across callbacks.
export class PcmFramer {
  constructor(inputRate, frameSamples = 1600) {
    if (inputRate < 16000) throw new Error('Audio input must support at least 16 kHz');
    this.ratio = inputRate / 16000;
    this.frameSamples = frameSamples;
    this.frame = new ArrayBuffer(frameSamples * 2);
    this.view = new DataView(this.frame);
    this.offset = 0; this.phase = 0; this.sum = 0; this.count = 0;
  }
  push(samples) {
    const result = [];
    for (const sample of samples) {
      this.sum += sample; this.count++; this.phase++;
      if (this.phase + 1e-8 < this.ratio) continue;
      const value = Math.max(-1, Math.min(1, this.sum / this.count));
      this.view.setInt16(this.offset * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      this.offset++; this.phase -= this.ratio; this.sum = 0; this.count = 0;
      if (this.offset === this.frameSamples) {
        result.push(this.frame);
        this.frame = new ArrayBuffer(this.frameSamples * 2);
        this.view = new DataView(this.frame); this.offset = 0;
      }
    }
    return result;
  }
}
