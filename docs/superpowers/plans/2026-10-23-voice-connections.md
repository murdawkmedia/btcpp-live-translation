# Voice and connections implementation plan

Goal: reduce voice buffering, connect a user's OpenRouter account and expose source.
Architecture: bounded shared audio streams plus existing owner-only encrypted settings.
Tech stack: Node HTTP, Cloudflare Durable Objects, Web Streams, browser modules.

1. In test/provider-connect.test.js, fail official S256/state, encrypted key-only
   storage, mismatched owner, replay, expiry, changed settings and sanitized errors.
   Implement src/provider-connect.js and wire the same POST route into both runtimes.
   Extend provider UI with a locked Connect OpenRouter button, callback cleanup and
   safe status. Source links are ordinary fixed HTTPS anchors on both pages.
2. In test/progressive-audio.test.js, hold synthesis after its first bytes, assert
   an early audio event and two readers receiving identical shared audio with one
   provider call. Test cancellation, response/cache limits, reader cancellation and
   generic upstream failure. Implement src/shared-audio.js, chunk callbacks in the
   HTTP provider, pipeline cache accounting and streamed Node/Worker audio routes.
3. Add xAI latency option and safe speech-check override with first-byte timing.
   Verify Korean/rex with the saved key only under explicit owner authorization;
   switch speech provider/voice only on success, preserving all other settings.
4. Run Node tests, syntax, build and both native Worker suites. Browser fixtures
   verify provider controls, callback status, visible source links and audio start
   before response completion. Review privacy, preserve active captures, commit
   exact source, deploy while idle and verify actual Worker/stage code and assets.
5. Publish Nostr first, GitHub mirror second; verify independent clones and source
   recovery. Update project STATUS/README and private handoff with observed timing,
   pending manual provider consent and real device/event acceptance limits.
