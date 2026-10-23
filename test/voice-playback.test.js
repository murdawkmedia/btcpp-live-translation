import test from 'node:test';
import assert from 'node:assert/strict';
import { startVoicePlayback } from '../public/voice-playback.js';
const tick=()=>new Promise(r=>setImmediate(r));
function media(t) {
 const prior=Object.getOwnPropertyDescriptor(globalThis,'MediaSource');const seen=[];
 class Source extends EventTarget {
  static isTypeSupported(type){return type==='audio/mpeg';}
  constructor(){super();this.readyState='closed';queueMicrotask(()=>{this.readyState='open';this.dispatchEvent(new Event('sourceopen'));});}
  addSourceBuffer(){const b=new EventTarget();b.appendBuffer=chunk=>{seen.push([...chunk]);queueMicrotask(()=>b.dispatchEvent(new Event('updateend')));};return b;}
  endOfStream(){this.readyState='ended';}
 }
 Object.defineProperty(globalThis,'MediaSource',{value:Source,configurable:true});t.after(()=>{if(prior)Object.defineProperty(globalThis,'MediaSource',prior);else delete globalThis.MediaSource;});
 t.mock.method(URL,'createObjectURL',()=> 'blob:fixture');t.mock.method(URL,'revokeObjectURL',()=>{});return seen;
}
test('MP3 bytes feed MediaSource before the HTTP response ends',async t=>{
 const seen=media(t);let release;const gate=new Promise(r=>{release=r;});t.after(release);
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({async start(c){c.enqueue(new Uint8Array([1,2]));await gate;c.enqueue(new Uint8Array([3]));c.close();}}),{headers:{'Content-Type':'audio/mpeg'}}));
 const audio={play:async()=>{},dispatchEvent(){}};const playback=startVoicePlayback(audio,'/api/audio/1');await tick();assert.equal(audio.src,'blob:fixture');assert.deepEqual(seen,[[1,2]]);
 release();await tick();assert.deepEqual(seen,[[1,2],[3]]);await playback.playing;playback.stop();
});
test('non-MP3 fallback survives the initial MediaSource play cancellation',async t=>{
 media(t);let plays=0;t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([1]),{headers:{'Content-Type':'audio/wav'}}));
 const audio={play:()=>++plays===1?Promise.reject(Object.assign(Error(),{name:'AbortError'})):Promise.resolve(),dispatchEvent(){}};
 const playback=startVoicePlayback(audio,'/api/audio/2');await playback.playing;assert.equal(audio.src,'/api/audio/2');assert.equal(plays,2);playback.stop();
});
