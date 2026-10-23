# Operator Workspaces Implementation Plan

> Execute inline with executing-plans; no delegated work requested.

**Goal:** Separate operator API budgets while retaining browser-only event use.
**Architecture:** Per-workspace capability authentication and Durable Objects,
independently derived encryption/capability material, scoped browser paths.
**Tech Stack:** Existing Node/browser modules, Web Crypto/Node crypto, Workers.

1. [x] Add failing access/config tests in test/workspace-access.test.js. Implement
   src/workspace-access.js for hashed owner/operator codes, role checks, unique
   derived settings keys, expiry/revocation and environment credential exclusion.
2. [x] Add failing Worker workspace integration checks, then cloudflare/workspace.js
   for initialization/login/logout, forwarding only authorized requests, safe
   role metadata, invite/recovery endpoints and revocation of active capture.
3. [x] Add administrator catalog/create/recover endpoints in the existing stage
   and register WorkspaceStage binding/migration. Preserve the stable legacy stage.
4. [x] Add scoped-path regressions; implement public/workspace.js, login/owner/admin
   controls, capture/listener prefix propagation and disabled provider controls
   for event operators. Existing Node runner stays single-stage and compatible.
5. [x] Run npm test, npm run check, npm run build:cloud, npm run test:worker and
   the new Workspace Worker fixture suite. Browser-check two isolated owners and
   an invited operator, then revoke active access and confirm attendee scoping.
6. [ ] Review exact public diff/credentials, deploy idle-only, verify code/assets
   and permissions, publish Nostr then GitHub, verify fresh clones and recovery.
   Update dated project handoff, README/STATUS and decisions in force.
