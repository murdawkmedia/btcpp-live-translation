# Cloud and local implementation plan

> Execute inline using the executing-plans workflow. No additional delegated workers.

Goal: deliver one portable local runner, one hosted event service and reviewed
public Nostr/GitHub source.

- [x] Add provider/language configuration tests: local defaults without cloud
  fallback; OpenRouter translation with target-specific glossary instructions;
  ElevenLabs realtime PCM/keyterms/final transcript and local whisper WAV input.
  Run `node --test test/profiles.test.js` before implementing the adapters.
- [x] Implement `src/config.js`, `src/languages.js`, shared HTTP providers,
  streaming recognizer adapters and a local recognizer. Preserve existing xAI
  fixture tests. Run `npm test` and `npm run check`.
- [x] Update the local operator/server and listener protocol for target selection,
  provider status and bounded recovery. Add Windows/Linux setup documentation.
  Verify a local fixture through the real capture socket and phone SSE endpoint.
- [x] Add a Cloudflare Worker and stage Durable Object using shared provider and
  pipeline code. Package only public browser assets. Test the Worker in Wrangler
  with fixture providers and keyless rehearsal, authenticated mutation, capability
  separation and stop/cancellation checks.
- [ ] Verify the Murdawk Media account and existing provider credential pointers.
  Configure scoped Worker secrets privately. Deploy one new named app and verify
  public assets, auth, QR phone rehearsal and a bounded generated-speech live run.
- [x] Sanitize public docs, add MIT and upstream notices, scan every staged file
  and all outgoing Git history. Publish Nostr first under the existing public
  identity, then create/push the Murdawk Media GitHub mirror. Fresh anonymous
  clones must match the reviewed commit/tree and pass tests.
- [ ] Record exact deployment, source URLs, verification and remaining hardware/
  venue limits in the wrapper status and public handoff. Preserve all prior evidence.
