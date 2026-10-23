// Feed MP3 frames directly to supported browsers instead of waiting for file sniffing.
export function startVoicePlayback(audio, url) {
 const Media = globalThis.MediaSource;
 if (!Media?.isTypeSupported?.('audio/mpeg')) { audio.src = url; return { playing: audio.play(), stop() {} }; }
 const controller = new AbortController(), media = new Media(), blob = URL.createObjectURL(media);
 let stopped = false, resolvePlaying, rejectPlaying;
 const playing = new Promise((resolve, reject) => { resolvePlaying = resolve; rejectPlaying = reject; });
 const stop = () => { if (stopped) return; stopped = true; controller.abort(); URL.revokeObjectURL(blob); rejectPlaying(Error('Playback stopped')); };
 const wait = (target, name, errorName) => new Promise((resolve, reject) => {
  const cleanup = () => { target.removeEventListener(name, success); if (errorName) target.removeEventListener(errorName, error); controller.signal.removeEventListener('abort', error); };
  const success = () => { cleanup(); resolve(); }, error = () => { cleanup(); reject(Error('Voice stream unavailable')); };
  if (controller.signal.aborted) return error();
  target.addEventListener(name, success, { once: true }); if (errorName) target.addEventListener(errorName, error, { once: true }); controller.signal.addEventListener('abort', error, { once: true });
 });
 const opened = wait(media, 'sourceopen', 'sourceclose');
 audio.src = blob;
 // Call play synchronously so the attendee's tap can unlock browser audio.
 const play = () => Promise.resolve(audio.play()).then(resolvePlaying, error => { if (error?.name !== 'AbortError') rejectPlaying(Error('Voice playback unavailable')); });
 void play();
 void (async () => {
  let reader;
  try {
   await opened;
   const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
   if (!response.ok) { await response.body?.cancel(); throw Error('Voice stream unavailable'); }
   if (!response.headers.get('content-type')?.startsWith('audio/mpeg')) {
    await response.body?.cancel(); URL.revokeObjectURL(blob); audio.src = url; await play(); return;
   }
   const buffer = media.addSourceBuffer('audio/mpeg'); reader = response.body.getReader(); let bytes = 0;
   while (!stopped) {
    const chunk = await reader.read(); if (chunk.done) break;
    if ((bytes += chunk.value.byteLength) > 6 * 1024 * 1024) throw Error('Voice stream too large');
    buffer.appendBuffer(chunk.value); await wait(buffer, 'updateend', 'error');
   }
   if (!stopped && media.readyState === 'open') media.endOfStream();
  } catch {
   if (!stopped) {
    rejectPlaying(Error('Voice stream unavailable'));
    try { if (media.readyState === 'open') media.endOfStream('network'); } catch {}
    audio.dispatchEvent(new Event('error'));
   }
  } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
 })();
 return { playing, stop };
}
