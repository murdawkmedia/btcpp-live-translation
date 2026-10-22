export async function chooseAudio(kind, deviceId) {
  if (!window.isSecureContext || !navigator.mediaDevices) throw Error('Audio capture needs HTTPS or localhost.');
  const stream = kind === 'desktop'
    ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include', selfBrowserSurface: 'exclude' })
    : await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach(track => track.stop());
    throw Error('No audio was shared. Choose a screen/tab with audio and enable Share audio, or select an audio input.');
  }
  let context, processor, source, stopped = false;
  return { label: stream.getAudioTracks()[0].label,
    async connect(onFrame, onLevel, onEnded) {
      stream.getTracks().forEach(track => track.addEventListener('ended', onEnded, { once: true }));
      context = new AudioContext({ sampleRate: 16000 });
      await context.audioWorklet.addModule('/pcm-worklet.js'); await context.resume();
      source = context.createMediaStreamSource(stream); processor = new AudioWorkletNode(context, 'pcm-capture');
      processor.port.onmessage = ({ data }) => { if (!stopped) data.type === 'pcm' ? onFrame(data.buffer) : onLevel(data.value); };
      source.connect(processor); processor.connect(context.destination);
    },
    async stop() {
      if (stopped) return; stopped = true;
      stream.getTracks().forEach(track => track.stop()); processor?.disconnect(); source?.disconnect();
      if (context && context.state !== 'closed') await context.close();
    }
  };
}
