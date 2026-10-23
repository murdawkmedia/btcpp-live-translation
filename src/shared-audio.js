// One bounded audio buffer; every reader replays it and follows newly added bytes.
export class SharedAudio {
 constructor(mime) { this.mime = mime; this.chunks = []; this.byteLength = 0; this.complete = false; this.failed = false; this.waiters = new Set(); this.readers = 0; }
 wake() { for (const resolve of this.waiters) resolve(); this.waiters.clear(); }
 append(chunk) {
  if (this.complete || this.failed) throw Error('Audio stream unavailable');
  const copy = new Uint8Array(chunk); if (!copy.byteLength) return;
  this.chunks.push(copy); this.byteLength += copy.byteLength; this.wake();
 }
 finish() { this.complete = true; this.wake(); }
 fail() { this.failed = true; this.chunks = []; this.wake(); }
 stream() {
  if (this.readers >= 500) throw Object.assign(Error('Audio listener capacity reached'), { status: 503 });
  this.readers++; let index = 0, closed = false, wake;
  const release = () => { if (closed) return; closed = true; this.readers--; if (wake) { this.waiters.delete(wake); wake(); wake = null; } };
  return new ReadableStream({
   pull: async controller => {
    while (!closed) {
     if (this.failed) { release(); controller.error(Error('Audio unavailable')); return; }
     if (index < this.chunks.length) { controller.enqueue(this.chunks[index++]); return; }
     if (this.complete) { release(); controller.close(); return; }
     await new Promise(resolve => { wake = resolve; this.waiters.add(resolve); });
     wake = null;
    }
   }, cancel: release
  });
 }
}
