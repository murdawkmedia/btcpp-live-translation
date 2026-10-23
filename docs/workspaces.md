# Browser workspaces and separate API budgets

Hosted operators need only a browser and their audio source. The Cloudflare
backend processes one shared stream per workspace. Attendees use that workspace's
QR link, with no account, installation or API key. Personal workspaces are a
hosted feature; the optional local Node runner remains a single private desk.

## Set up the team

1. Sign in to the main desk with the existing administrator code. Keep it private.
2. Open **06 / Workspaces & access** and create a named workspace for each operator
   or event. Up to 50 workspaces can be created on this instance.
3. Copy its owner code when shown and give that operator the workspace URL and
   code privately. The code is shown once and is never included in the URL.
4. The operator opens that URL, signs in and configures their own provider keys
   under **05 / Providers**. New workspaces have no API keys.

Workspace creation and administration never copy keys from the default desk.
The existing default stage, saved keys, administrator code and attendee link
continue to work. For shared event operations, create an event workspace, configure
its providers and share event operator access below. Do not hand out the main
administrator code or a workspace owner code for ordinary event operation.

## Share an event deliberately

The workspace owner can confirm permission to use that workspace's API credits
and issue up to eight event operator codes. Each lasts seven days. The operator
receives the workspace link and their code, enters it in the browser, and can
run/stop translation and change the target language between sessions. They cannot
change keys, run provider checks, create workspaces, issue codes or recover owners.

Revoking a code immediately blocks further controls and stops audio currently
supplied by that code. Expiry stops a session that reaches the expiry deadline.
The attendee link stays read-only and separate; anyone already given that link
can continue watching as an attendee. Revocation does not withdraw public captions.

The administrator can explicitly reset a lost workspace owner code. This stops
that workspace's session and invalidates old owner and event codes, while retaining
its encrypted provider keys. A replacement code is shown once. Sign-out clears
only the selected workspace or admin desk cookie, as labeled by the button.

## Server boundaries

Public random workspace IDs are not authorization. The server checks a private
owner/operator capability for each workspace. Code hashes are persisted; raw
codes are returned only at creation/reset. Session cookies are HttpOnly,
SameSite=Strict and scoped to the workspace path. A root admin cookie alone does
not authorize a private workspace; administration requires the explicit root API.

Each workspace has a distinct Durable Object, encrypted provider settings and
independently derived wrapping, internal operator and viewer secrets. New rooms
inherit no default API keys, default provider endpoints or Cloudflare AI binding.
Missing personal keys cannot trigger spending on the administrator's services.
The Cloudflare hosting account still hosts all workspaces and its own resource
usage is shared; provider API budgets are separated by workspace credentials.

Optional administrator-controlled `WORKSPACE_STT_URL`,
`WORKSPACE_TRANSLATION_BASE_URL` and `WORKSPACE_XAI_BASE_URL` explicitly configure
workspace provider endpoints, for example trusted fixture services. They are not
browser settings and never cause default desk credentials to be injected.

Preserve `PROVIDER_SETTINGS_KEY` and workspace storage together for recovery.
Changing that secret breaks existing derived access and encrypted settings.
Keep the existing StageSession migration, binding and stable stage name. Adding
WorkspaceStage is an additive SQLite namespace migration, without deletion,
renaming or transfer of the legacy stage. No provider calls or billing upgrade
are part of provisioning a workspace.
