# Private Provider Settings Implementation Plan

> Execute inline with executing-plans; no delegated workers requested.

**Goal:** Allow an operator to select providers and privately supply keys without
redeploying, while supporting captions-only sessions.

**Architecture:** Shared validated configuration manager with encrypted storage
adapters; operator-only HTTP endpoints in both runtimes; password-input panel.
**Tech Stack:** Node, browser modules, Web Crypto AES-GCM, Cloudflare Durable Objects.

## 1. Shared settings and captions-only pipeline

- [x] Add test/provider-settings.test.js for encrypted round-trip, no plaintext,
  tamper rejection, atomic failed saves, key preservation/removal, provider/model
  validation and readiness without speech. Add pipeline regression for zero speech
  calls when disabled. Run node --test test/provider-settings.test.js and observe red.
- [x] Implement src/provider-settings.js: ready initialization, validated update,
  encrypted persistence before apply, withLock, config and safe snapshot. Keep
  provider defaults in src/config.js; allow none only for speech. Pipeline resolves
  captions immediately when provider.speechEnabled is false. Run focused tests.

## 2. Runtime endpoints and checks

- [x] Add HTTP tests for operator/origin restrictions, key absence in all responses,
  idle-only changes and busy capture exclusion. Add fixture check-provider tests
  for success, auth/rate-limit errors and timeout socket cleanup. Observe red.
- [x] Add src/provider-check.js with one fixed input per check, safe bounded errors
  and streaming connection cleanup. Add GET/POST /api/providers and POST
  /api/providers/test in src/server.js and cloudflare/worker.js. Authenticate first;
  use withLock and reject busy/live capture, rehearsal and language mutation.
- [x] Add local encrypted file adapter in src/main.js with 0600 key and atomic
  ciphertext writes; Worker uses storage plus PROVIDER_SETTINGS_KEY secret.
  Run npm test and npm run test:worker.

## 3. Operator form

- [x] Add a VM/browser regression proving blank keys stay private, save clears
  submitted password fields, failure leaves retry input available, active sessions
  disable mutation and test buttons report only safe server responses. Observe red.
- [x] Add public/provider-settings.js and panel in public/index.html. Integrate
  with public/app.js status and selected provider summary. Update static allowlist
  and styles for small screens. Explicit check buttons mention possible API usage.
- [x] Run npm test, npm run check, npm run build:cloud, npm run test:worker. Use
  real browser with fixture credentials only; inspect desktop and phone width.

## 4. Release and recovery

- [ ] Review exact diff and public privacy patterns. Update README, env example,
  cloud/local docs and handoff with key entry, persistence and test limits.
- [ ] Verify idle stage, configure new private wrapping secret without printing it,
  deploy, and read back code/assets/API permissions. No billing changes.
- [ ] Publish reviewed source through existing Nostr workflow then GitHub mirror.
  Verify remote heads and source recovery. Update project STATUS/README and private
  operation checkpoint, including any missing live-key acceptance.
