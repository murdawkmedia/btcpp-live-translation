# Cloudflare deployment

The hosted service uses Workers assets plus a stage Durable Object. It needs no
laptop backend, tunnel, separate VPS or attendee provider keys. The operator still
needs a browser, a clean audio source and internet access.

Install dependencies, authenticate Wrangler with the intended account, and run:

```sh
npm ci
npm test
npm run check
npm run build:cloud
npx wrangler secret put OPERATOR_TOKEN
npx wrangler secret put VIEWER_TOKEN
npx wrangler secret put PROVIDER_SETTINGS_KEY
npm run deploy
```

Generate two distinct cryptographically random capabilities privately. The
operator capability grants capture/control and hosted workspace administration;
keep it private and issue separate workspace codes to teammates. The attendee capability grants only
captions/audio. Enter the operator token on the hosted desk; share the QR link
from that desk. Keep token values out of source, command arguments and logs.
Set `CLOUDFLARE_ACCOUNT_ID` in the deployment environment when multiple accounts
are available. No account-specific identifier or domain is embedded in source.

`PROFILE=cloud` uses Workers AI Whisper large-v3-turbo, Qwen3 and MeloTTS when
vendor keys are absent. Cloudflare bills according to account usage/plan limits.
The selected model's language support and quality must be checked before an event.

To select ElevenLabs recognition/speech, configure the provider variables and
put `ELEVENLABS_API_KEY` into Worker secrets, with `ELEVENLABS_VOICE_ID` in
private deployment configuration. To select OpenRouter translation, configure
`TRANSLATION_PROVIDER=openrouter`, an available `TRANSLATION_MODEL` and put
`OPENROUTER_API_KEY` into Worker secrets. xAI is also supported. Custom endpoints
are configured by the server operator, never by attendee requests.

A local simulation is available through `npm run dev:cloud`. For keyless rehearsal
without connecting an AI binding, use a local Wrangler configuration that omits
`ai`, with explicit fixture capabilities. Run `scripts/verify-service.js` with
`VERIFY_ORIGIN` and a privately supplied `VERIFY_OPERATOR_TOKEN` to test the desk,
origin protection, language changes, caption SSE, shared audio and stop behavior.

The runtime uses memory for its bounded caption/audio history; deployments and
object restarts can interrupt a session and discard that history. Stop capture
before deploying. Active outbound recognition and audience connections consume
runtime resources; stop sessions during breaks. A six-hour alarm bounds a single
hosted capture session. No scheduled deployment or mirroring job is installed.

Nsite/GitHub Pages are possible future static-client hosts, but this release
uses same-origin API connections and is deployed as a complete Cloudflare app.

## Operator-entered provider keys

Generate `PROVIDER_SETTINGS_KEY` privately as 32 random bytes encoded in 64 hex
characters, enter it through Wrangler's secret prompt, and retain it in your
private credential store. This is a wrapping key for AES-256-GCM, not an API key
or operator login token. Never put its value in vars, source, shell arguments or
logs. Do not regenerate it on every deployment.

The operator Providers panel saves encrypted settings to the existing stage
Durable Object. Only ciphertext, random IV and version are persisted; the
wrapping key stays in Worker secrets. Keys are not retrievable through the app.
Provider selection and credentials survive object restarts and deployments while
the wrapping key and STAGE_INSTANCE remain stable. Caption history stays in memory.

Environment keys remain supported as the base configuration. Clearing a saved
override falls back to the environment key, if any; remove an environment key
through private deployment configuration when it must no longer be available.

To avoid the Workers AI allowance entirely, select external recognition and
translation, and either disable voice or select an external voice provider too.
An OpenRouter translation key by itself does not replace this app's transcription
provider. Saving configuration does not upgrade Cloudflare billing or buy credits.

## Workspace namespace

The same Worker also exports WorkspaceStage through the WORKSPACE_STAGE binding.
The v2-workspaces migration adds its SQLite namespace alongside the original
StageSession. Retain the existing v1 migration and stable STAGE_INSTANCE; do not
rename or delete the existing namespace to enable workspaces. The existing
PROVIDER_SETTINGS_KEY is also the master for per-object derived settings keys.
Never replace it on deployment. See [workspace operations](workspaces.md).
