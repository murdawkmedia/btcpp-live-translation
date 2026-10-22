# Development handoff

One repository contains a Node 22+ Windows/Linux runner and a Cloudflare
Worker/Durable Object deployment. Local processing is the runner default;
cloud stages are explicit and never an automatic fallback. The hosted profile
uses Workers AI or separately configured ElevenLabs/OpenRouter/xAI credentials.

The app broadcasts one target language per session. English to Korean is the
first event setting; Japanese, Spanish, French and Chinese are selectable between
sessions. Main Stage, phone captions and voice, QR access, no screen overlay.
Keep provider keys and operator capability private. Attendee links are read-only.

Both runtimes share glossary, translation, speech, recognition and pipeline code.
Node uses native HTTP/WebSocket adapters; Cloudflare uses a Durable Object and
Workers assets. The browser protocol is the same. Do not conflate configuration
presence with working credentials or models. Keyless rehearsal uses fixed Korean
captions and a tone.

Run npm test, npm run check and npm run build:cloud. Verify the real local Worker
through scripts/verify-service.js before deployment. Live cloud quality and latency
need a separate generated-speech check and a Korean-speaking reviewer. Windows
capture, physical iOS/Android playback, phone screen lock and venue load remain
hardware/event acceptance checks. No event readiness claim follows from fixtures.

Captions/audio remain bounded and in memory. No raw recordings or transcript
journals are persisted. Provider policies may differ. Stop before deployments;
reconnect buffering is bounded and does not guarantee gapless source recovery.
Nostr source publication, GitHub mirroring and Cloudflare deployment are separate
operations whose actual URLs/receipts must be verified independently.
