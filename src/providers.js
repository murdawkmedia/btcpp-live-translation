import WebSocket from 'ws';
import { connectStreamingTranscriber } from './streaming-stt.js';
import { connectBufferedTranscriber } from './buffered-stt.js';
export { createLiveProvider } from './http-provider.js';

export function connectTranscriber(config, callbacks) {
  if (['local', 'workers-ai'].includes(config.sttProvider)) return connectBufferedTranscriber(config, callbacks);
  return connectStreamingTranscriber(config, callbacks, (url, headers) =>
    new WebSocket(url, { headers, handshakeTimeout: 10000, maxPayload: 512000 }));
}
