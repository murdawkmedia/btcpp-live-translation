# Private operator provider settings

Approved scope: operator-supplied ElevenLabs, OpenRouter and xAI keys; independent
recognition, translation and optional speech choices. Keep one shared stage,
English-to-Korean initially, with no attendee provider/key controls.

## Configuration and storage

Add an authenticated Providers panel. Blank password inputs preserve existing
keys; an explicit clear control removes a saved override. Responses expose only
key presence and source, never values or suffixes. Provider and model selection
are explicit, with no automatic paid fallback. Saving does not call providers.

Store overrides as AES-256-GCM ciphertext with a fresh IV on every write.
Cloudflare stores ciphertext in the stage Durable Object; its wrapping key is a
separate Worker secret. The local runner stores ciphertext and a separate private
wrapping-key file under ignored .runtime, using restrictive file permissions.
Environment credentials remain supported. Missing/corrupt storage fails visibly
and prevents live capture rather than silently choosing another provider.

Settings updates and checks require operator authentication, same-origin POST,
bounded validated JSON, and an idle stage. A shared busy guard prevents capture
from starting while settings are being committed or tested. Persistence succeeds
before new configuration takes effect. No arbitrary remote endpoint editing.

## Provider checks

Explicit test buttons check the saved configuration; requests may consume provider
credits. Streaming recognition checks authentication/handshake with no audio; it
is not a transcription accuracy test. Translation checks one fixed Bitcoin
sentence, speech checks one fixed short target-language phrase. Results contain
only stage/status/elapsed time and safe messages. Abort/timeout closes sockets.
Never return upstream error bodies. Real long-running accuracy remains separate.

## Captions only

Speech can be disabled. Readiness then requires only recognition and translation,
and caption processing never enqueues/calls speech. Existing caption fanout and
English originals stay unchanged. Settings are fixed during a live session.

## Validation and release

Test encryption/restore/tamper, validation, atomic failures, authenticated access,
no credential leakage, concurrent capture exclusion, provider contract checks and
zero speech calls when disabled. Run all existing tests, syntax, Worker build and
local Worker integration. Browser-check private fields, saving, tests and mobile
layout with fixtures. Deploy only while idle; keep stable stage name. Publish
reviewed public source to Nostr then GitHub. Keys enter the deployed HTTPS operator
form or private deployment secrets; no real keys in source, URLs, chat or receipts.
