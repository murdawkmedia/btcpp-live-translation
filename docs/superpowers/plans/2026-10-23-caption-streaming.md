# Caption streaming implementation plan

1. Measure current event timings without retaining speech content; preserve live
   captures. Verify the clean isolated branch and existing test baseline.
2. Add failing provider tests for SSE token delivery, low-effort xAI requests,
   Unicode fragments, incomplete responses and reasoning/error exclusion. Add a
   bounded stream decoder and connect it to `src/http-provider.js`.
3. Add failing draft/pipeline tests for one active request, latest-only pending
   revision, two-second cadence, cancellation, promotion and final-only audio.
   Implement `src/live-draft.js` and integrate provisional final-caption tokens.
4. Connect recognizer partials to the pipeline in both runtimes. Include safe
   drafts in snapshots and clear them on stop. Add fixture regressions before
   changing browser handlers and markup; keep locale and caption choices separate.
5. Run all Node tests, syntax/build and both native Worker suites. Use native
   fixtures and collaborative browser for early draft delivery, reset/recovery,
   owner/event access and phone layout. Review privacy and source diff.
6. Commit exact task files, fast-forward canonical main, deploy only while idle,
   verify actual runtime markers and bytes, measure generated-audio latency,
   publish Nostr first and GitHub second, verify anonymous clones and recovery,
   and update dated project handoff documents. Keep real-input/event limits clear.
