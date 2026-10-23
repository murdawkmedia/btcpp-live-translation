# Live caption drafts

Live translated text is the primary output. Show English as recognition produces
it and Korean as the translator produces it, without waiting for a long spoken
segment or voice synthesis. The most recent draft may revise; label it clearly.
Keep the shared one-stream-per-workspace, optional English view, independent menu
languages, browser-only workflow and final-only voice behavior.

## Decision

Retain the configured recognizer and translator. ElevenLabs already sends partial
transcripts, while its VAD finalization can wait for a speaker pause. Repeated
forced commits risk recognition quality. Instead use partial text for a separate
bounded draft lane. Stream answer text from compatible HTTP translation APIs.
Request low reasoning effort on supported xAI models, retaining the selected
model, provider and key. Do not silently switch models or providers.

English-only partial display would leave Korean latency unchanged. Short forced
recognition windows would trade away context. Revising translated drafts plus
streamed final captions best meet the low-latency goal.

## Boundaries

- One draft translation in flight and one coalesced latest revision, at most one
  new draft request every two seconds per workspace, shared by all attendees.
- Preserve ordered final captions and an independently bounded voice queue.
- Clear/cancel a draft at recognition commit, stop, reset or failure. Late results
  cannot overwrite a newer utterance or session. Promote a completed exact-match
  draft at commit; never synthesize provisional text.
- Stream only assistant answer content. Ignore reasoning/tool fields, hide think
  blocks, bound UTF-8/SSE buffering, and require a complete valid response before
  marking a caption final. Interrupted output remains provisional and is cleared
  on failure. Never return raw provider errors or credentials.
- Include current drafts and pending caption tokens in safe on-air recovery
  snapshots. Off-air attendee state contains neither drafts nor transcript history.
- Both views update existing rows as tokens arrive. Finishing an older caption
  must not erase a newer English/Korean draft. Localized draft labels follow menu
  language; caption language remains the shared target.
- Drafts add bounded translation requests on the configured provider. No calls per
  attendee, automatic paid fallback, key inheritance, billing upgrade or transcript
  journaling. Keep local/cloud runtimes in the same repository.

## Acceptance

Red/green regressions cover answer deltas before completion, privacy/bounds and
UTF-8 parsing, draft coalescing and stale cancellation, exact-match promotion,
snapshot recovery, final-only voice and both browser views. Native Worker fixtures
must prove draft delivery and workspace isolation. Browser fixtures test actual
rendering and narrow screens. Benchmark with generated audio only while the stage
is idle, recording timings and counts, not human transcripts. Verify active outer
Worker/stage behavior as well as uploaded bytes before claiming a hosted release.
Existing API keys/settings, access, namespaces and default stage remain intact.
