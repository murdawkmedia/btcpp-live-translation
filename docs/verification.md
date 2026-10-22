# Verification scope

Automated Node tests use real fixture HTTP/WebSocket/SSE servers. They cover
provider credential separation, local-only endpoints, selected language and
Bitcoin vocabulary, ElevenLabs PCM/commit protocol, xAI transcript reconciliation,
ordered delivery, stop flushing, cancellation, queue/history/audio bounds, auth,
request origins and read-only attendee access. A local fixture test proves that
two listener downloads share one recognition/translation/synthesis operation.

The local Cloudflare Worker verification script exercises actual Workers assets,
Durable Object HTTP, cookie login, invalid/busy language settings, SSE sample
captions, shared playable WAV tone, read-only capability separation and stop.
Build verification uses Wrangler's dry-run bundle and public-asset allowlist.

Fixture outputs are not real transcription or Korean speech. Browser checks
should include desktop controls, QR access and a phone-sized listener. Physical
phones, screen lock, Windows/vMix and Linux monitor routing, long technical-talk
latency, bilingual quality and expected audience load require separate checks.
Provider/model availability and account limits are deployment-specific.

No private screenshots, credentials, transcripts, device identifiers or local
machine paths are included in this source repository.
