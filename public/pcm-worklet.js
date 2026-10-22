import { PcmFramer } from './audio-core.js';
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.framer = new PcmFramer(sampleRate); this.ticks = 0; }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const channels = inputs[0]; if (!channels?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    let peak = 0; for (const value of mono) peak = Math.max(peak, Math.abs(value));
    for (const buffer of this.framer.push(mono)) this.port.postMessage({ type: 'pcm', buffer }, [buffer]);
    if (++this.ticks % 25 === 0) this.port.postMessage({ type: 'level', value: peak });
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
