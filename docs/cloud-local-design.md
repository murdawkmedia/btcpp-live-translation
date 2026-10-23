# Cloud and local translation

One repository provides a hosted conference service and a Windows/Linux local
runner. The hosted service uses Cloudflare Workers assets plus a Durable Object
for each workspace stage session. The original default stage remains private to
the administrator. The local runner retains Node 22+, browser audio capture
and the same phone protocol. English to Korean is the initial event setting.
The operator may select another supported target between sessions.

Local processing is the runner's default: whisper.cpp HTTP transcription,
an Ollama-compatible text endpoint and an OpenAI-compatible local speech
endpoint. Models are installed and operated separately. Missing local services
fail visibly; they never trigger a paid cloud fallback. Cloud profiles explicitly
select ElevenLabs/xAI recognition, OpenRouter/xAI/Workers AI translation, and
ElevenLabs/xAI speech. Keys remain in server environment/Worker secrets or encrypted workspace storage.

The hosted operator captures desktop/tab or a selected audio input. Windows
supports shared system audio when the browser offers it. Linux uses a shared
browser tab or a PipeWire/PulseAudio monitor exposed as an input; whole-desktop
audio availability depends on the browser. The application changes no OS routing.

Attendees scan a read-only link, receive captions and tap to play shared audio.
An independent operator capability controls capture and session changes. Streaming
recognition has bounded buffering and reconnect attempts; completed transcripts
are translated in order. History, queues and cached audio are bounded. Captions
survive speech failures. History is session-scoped and remains in memory.

Bitcoin vocabulary stays broad locally, while provider-specific hint lists stay
within API limits. Reviewed target terms guide translation; unreviewed drafts do
not become mandatory rules. Target language, provider profile and topic are
fixed for the duration of a capture session.

Public source uses MIT and records architectural references and copied-code
notices where applicable. Nostr is the source authority; a GitHub repository
mirrors reviewed public commits. Private deployment evidence, credentials, team
messages, local paths and attendee capabilities remain outside published source.
The hosted deployment targets Cloudflare. Nsite/GitHub Pages would require an
additional backend-origin/CORS configuration layer for the current client.

Validation covers real fixture HTTP/WebSocket contracts, isolated local endpoint
selection, language propagation, cancellation, bounded reconnect behavior, Worker
HTTP/WebSocket/SSE rehearsal, and desktop/phone browser flows. Live cloud provider
checks use generated test speech only. Hardware, Korean review and venue-scale
load remain separate acceptance checks.
