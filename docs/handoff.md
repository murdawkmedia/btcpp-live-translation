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

## Text-first delivery

Live translated text is the primary output. Voice may lag. Keep translation and
synthesis queues independent; never wait for speech before starting the next
caption. The default speech backlog is three waiting segments, and speech older
than 20 seconds is skipped. Normal Stop drains both queues; cancellation ignores
late results.

The cloud recognizer retains bounded audio context across three-second refreshes
after its first five-second window. Word timestamps select new stable words.
The cloud translation default is Qwen3 with /no_think. Bitcoin unit tokens
are protected and restored exactly; a missing/duplicated marker fails validation.
One retry handles cloud provider or output failures. GPT-OSS remains an explicit
option using Responses input/output and low reasoning effort. Only final message
text may be published; incomplete responses and reasoning never reach listeners.

Technical hints are short, topic/context-specific spelling references. Do not
blindly replace ordinary words such as cash/cashew with project names. Human
Korean review and real talk/venue tests remain required before event acceptance.

## Browser capture controls

Local selection, soundcheck, connection and live capture keep Stop enabled
independently of SSE status. Cancellation invalidates late chooser/connection
results, and a connecting WebSocket has a 12-second timeout. Soundcheck is visibly
local-only. A 2.5-second operator recovery timer fetches an authenticated snapshot
when no event has arrived for five seconds during live/finishing; requests are
bounded to one in flight with a 10-second timeout. Caption IDs suppress duplicate
SSE/snapshot rows.

## Attendee delivery

The read-only `/api/listener` snapshot uses the attendee capability, with no
operator login, provider configuration or credential payload. It returns at most
ten caption/transcript rows while on air, and no history while idle/connecting/error.
The attendee page fetches on open and every 2.5 seconds when its event stream has
been silent for five seconds. One request may be in flight, with a ten-second
timeout; newer events invalidate older responses. Session IDs prevent reused
caption/audio IDs from mixing after a missed reset. Off-air audio requests fail.
Reconnecting and finishing remain on air so the final captions can drain; the
operator's explicitly started sample rehearsal remains visibly labeled SAMPLE.

English transcripts are published before translation and merged into the same
caption ID when translated text arrives. Transcript/history memory stays bounded.
The attendee can display the translation, English or both without changing any
server setting or adding provider calls. Interface language is independent, saved
locally, and supports English plus the five target languages. One shared translated
caption/audio stream still serves everyone. Both pages default to dark colors.

## Recognition failure recovery

A cloud recognition window gets at most two attempts, including a retry for
missing word timestamps before overlap assembly mutates its state. Authentication
and invalid-request failures are not retried when the provider supplies their HTTP
status. Cancellation prevents further attempts; local processing remains a single
attempt. Repeated inference failure still stops capture visibly. Cloud pending audio windows
coalesce when recognition falls behind: overlapping samples are submitted once
in a merged window, with at most three pending windows and 30 seconds of source
span. A temporary stall can catch up without closing the source socket. A longer
stall discards older pending audio with a visible warning; this is not gapless
recovery. Local recognition keeps its existing bounded FIFO/overflow behavior.
Operator snapshots expose only timing/queue counters for recognition diagnostics.

The capture ready message includes its session ID. Application failures send a
safe issue message on the capture WebSocket before closing with code 1011. The
operator-only configuration snapshot retains the last capture issue in memory,
scoped to the session; new sessions clear it. The desk uses that reason even when
SSE is absent, with one bounded five-second snapshot request after an abrupt close.
Fallback messages include the close code. Do not expose raw upstream exception
text, credentials or transcript payloads through diagnostics. Attendee snapshots
exclude the retained operator issue. No transcript journal is created.

The hosted STAGE_INSTANCE selects the legacy default stage Durable Object name. Keep it stable
during a session; changing it starts fresh in-memory stage state for everyone.
The catch-up release uses a fresh instance after runtime probes showed the prior
instance still answered the old protocol despite uploaded-byte/version readback.
Never rotate this key during an active capture or use it as a substitute for a
storage migration. Verify new runtime fields before accepting a deployment.

## Live transport recovery

An unexpected live socket close (1006, 1012 or 1013) retains the chosen audio
input and retries the connection three times, after one, two and four seconds.
Each handshake has a 12-second deadline. Stop cancels pending retries and releases
the input; a late handshake cannot revive a stopped session. Explicit application
failures and normal closes are not automatically restarted. Secondary voice or
recognition warnings never become terminal capture failures.

A server reset starts a new shared caption session. Old rows are cleared before
new IDs can be reused. Speech captured during reconnect is discarded with a
visible possible-gap notice; it is not recorded or replayed. This recovery does
not establish the cause of a platform reset or promise gapless delivery. After
three unsuccessful attempts the input is released and a manual retry is offered.

A native Workers AI daily-free-allocation error stops without an immediate retry.
The operator sees an explicit exhausted-allowance message and the daily 00:00 UTC
reset/Workers Paid options. Do not treat quota exhaustion as a transport failure
or silently change account billing. A Free-plan long test cannot continue after
its daily allowance is exhausted; provider acceptance remains pending until reset
or an explicitly authorized billing change.

## Private provider controls

Operator-only GET/POST `/api/providers` exposes safe choices and key presence;
POST `/api/providers/test` checks saved settings with bounded sample requests.
All mutations require the operator cookie and same-origin POST. An idle/busy
guard prevents provider changes/checks overlapping live capture. No attendee
endpoint, event or diagnostic contains credentials. Arbitrary API base URLs
remain server configuration, not browser-editable settings.

AES-GCM overrides persist before activation. Cloudflare uses the stable stage's
`provider-settings-v1` record plus `PROVIDER_SETTINGS_KEY`; the local runner uses
private ignored `.runtime` files. Preserve the wrapping key for recovery. Missing
or corrupt stored settings fail closed. Clearing app keys reveals any environment
keys; it does not delete deployment secrets. No paid provider fallback is automatic.

`ttsProvider=none` makes speech optional for readiness and skips synthesis queues.
Translation model defaults follow the selected provider, avoiding Cloudflare or
local model IDs/endpoints leaking into an external provider selection.

## Hosted operator workspaces

The root operator capability is administrator-only. Root GET/POST `/api/workspaces`
lists/creates private rooms or explicitly resets owner access. It does not return
provider keys or previously issued access codes. WorkspaceStage is a separate
SQLite-backed Durable Object class selected by a random `/w/<id>/` route.

`workspaceFetch` authenticates owner/event codes before forwarding to the stage.
It removes public cookies and supplies only a derived internal operator token
after authorization. Bootstrap headers are stripped at the public Worker boundary.
Attendee tokens are unique, authorize reads only, and never grant operator APIs.
Every browser HTTP/SSE/WebSocket/audio path retains its workspace prefix.

New workspaces explicitly strip default credentials, provider endpoints, voices
and the account AI binding, using dedicated workspace endpoint variables only
when the administrator configures them. Per-object wrapping keys are derived
from the existing protected master key; settings and access survive restarts.

Event operators cannot manage provider keys/checks or access. Their codes expire
in seven days and can be revoked. Revocation stops their active source. Owner
recovery invalidates owner/invites and stops that workspace's source, preserving
encrypted settings; it is excluded while provider settings are being saved.
The original StageSession namespace and default attendee capability are retained.
See docs/workspaces.md for browser setup and the exact permission boundaries.
