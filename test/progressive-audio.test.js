import test from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../src/pipeline.js';
import { createLiveProvider } from '../src/http-provider.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
test('one synthesis exposes first bytes early and replays the same audio to multiple listeners',async t=>{
 const hold=gate();let calls=0;const events=[];
 const p=new Pipeline({translate:async()=> '비트코인',speak:async(_text,_signal,{onChunk})=>{calls++;onChunk(Buffer.from('first'),'audio/mpeg');await hold.promise;onChunk(Buffer.from('last'),'audio/mpeg');return {data:Buffer.from('firstlast'),mime:'audio/mpeg'};}});
 t.after(()=>{hold.resolve();p.cancel();});p.on('event',e=>events.push(e));const done=p.submit('Bitcoin');await tick();
 assert.ok(events.some(e=>e.type==='audio'),'First bytes must announce playable audio before synthesis finishes');
 const asset=p.audio.get(1),a=asset.stream().getReader(),b=asset.stream().getReader();
 assert.equal(Buffer.from((await a.read()).value).toString(),'first');assert.equal(Buffer.from((await b.read()).value).toString(),'first');
 hold.resolve();await done;assert.equal(Buffer.from((await a.read()).value).toString(),'last');assert.equal(Buffer.from((await b.read()).value).toString(),'last');assert.equal((await a.read()).done,true);assert.equal(calls,1);assert.equal(p.audioBytes,9);
});
test('upstream failure closes existing readers and revokes recoverable audio',async t=>{
 const hold=gate();const p=new Pipeline({translate:async()=> '번역',speak:async(_t,_s,{onChunk})=>{onChunk(Buffer.from('first'),'audio/mpeg');await hold.promise;throw Error('private-upstream');}});
 t.after(()=>{hold.resolve();p.cancel();});const done=p.submit('Bitcoin');await tick();assert.ok(p.audio.has(1));const r=p.audio.get(1).stream().getReader();await r.read();hold.resolve();await done;
 await assert.rejects(r.read(),e=>!e.message.includes('private-upstream'));assert.equal(p.audio.has(1),false);assert.equal(p.history[0].audioReady,false);assert.equal(p.audioBytes,0);
});
test('cancellation closes a waiting audio reader without another provider request',async t=>{
 const hold=gate();const p=new Pipeline({translate:async()=> '번역',speak:async(_t,_s,{onChunk})=>{onChunk(Buffer.from('first'),'audio/mpeg');await hold.promise;return{data:Buffer.from('first'),mime:'audio/mpeg'};}});
 t.after(()=>{hold.resolve();p.cancel();});const done=p.submit('Bitcoin');await tick();assert.ok(p.audio.has(1));const r=p.audio.get(1).stream().getReader();await r.read();const pending=r.read();p.cancel();await assert.rejects(pending);hold.resolve();await done;assert.equal(p.audioBytes,0);
});
test('HTTP speech forwards bytes before completion and requests xAI low latency',async t=>{
 const hold=gate();let body;t.mock.method(globalThis,'fetch',async(_url,options)=>{body=JSON.parse(options.body);return new Response(new ReadableStream({async start(c){c.enqueue(new Uint8Array([1,2,3]));await hold.promise;c.enqueue(new Uint8Array([4]));c.close();}}),{headers:{'Content-Type':'audio/mpeg'}});});
 const chunks=[];const task=createLiveProvider({xaiKey:'fixture-only',ttsProvider:'xai',voice:'rex',targetLanguage:'ko'}).speak('비트코인',new AbortController().signal,{onChunk:b=>chunks.push(b)});
 try{await tick();assert.equal(chunks.length,1);assert.equal(body.optimize_streaming_latency,2);assert.equal(body.voice_id,'rex');}finally{hold.resolve();}
 assert.equal((await task).data.length,4);
});
