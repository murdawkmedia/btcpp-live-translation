# Private operator workspaces

Approved: separate operators' keys and sessions, explicit event sharing, one
shared attendee stream per workspace, browser-only setup with no new installation.

## Approach

Retain capability-code login already used by the app, scoped per workspace. An
email account system adds a delivery service, while browser-only key storage
does not enforce server-side spending boundaries. Private workspace access codes
fit the existing deployment and work in ordinary browsers without extensions.
The current root operator code becomes administrator-only; do not share it.

The administrator creates named workspaces and receives a private owner access
code once, to hand to that operator privately. Catalog lists contain only IDs,
labels and dates. Each owner configures their own providers. New workspaces start
without API keys, without environment-key fallback, and without account-wide
Cloudflare AI access. Existing default stage, keys, access and attendee URL remain
intact. Workspace creation is administrator-only and bounded to 50 entries.

## Isolation and sharing

A new WorkspaceStage Durable Object class holds one workspace's access metadata
and inherited stage pipeline. Random public IDs select objects; access is always
verified by the server. Provider wrapping keys, internal operator capabilities
and attendee capabilities are derived independently per object. Owner and event
operator access codes are stored as hashes. Cookies are HttpOnly, SameSite=Strict
and scoped to the workspace path. Root cookies do not authorize a personal
workspace; one workspace's code never authorizes another workspace.

Owners may issue and revoke up to eight seven-day event operator codes. Granting
access explicitly allows using that workspace's API budget. Event operators can
run/stop sessions and select target language but cannot change keys, create
workspaces, issue invitations or manage owner access. Revoking the operator
currently supplying audio stops that owned session. Owners can revoke all invites
without rotating attendee links or revealing existing codes. Losing an owner code
requires administrator recovery: issue a replacement, invalidate old owner
sessions and halt that workspace's active capture; provider keys stay encrypted.

All scoped HTTP, SSE, WebSocket and audio paths retain their workspace prefix.
Attendee tokens authorize reads only and are unique per workspace. The public
legacy attendee route continues serving the original default stage.

## UI and verification

Add a Workspaces panel for administrator creation, owner access-code display once,
workspace links, and explicit owner event invitations. Add logout. Workspace
owners use the same provider/capture desk; event operators see provider controls
as unavailable. Private codes are never put in URLs or storage readable by page
scripts. API responses return a new code only at explicit creation/reset. No codes
or keys are included in public artifacts. Never send invitations automatically.

Test owner/operator/attendee authorization, cross-workspace forged routes/cookies,
root-key fallback removal, unique encryption context, active revocation, restart
recovery, links/streams/audio scoping, and legacy compatibility. Use fixture keys
and generated audio only. Run full tests, syntax, build and local Worker/browser
verification; deploy only if the actual stage is idle. Publish reviewed Nostr
source first, then the GitHub mirror. Keep billing unchanged.
