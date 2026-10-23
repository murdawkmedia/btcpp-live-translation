# Bitcoin++ live translation

English speech to translated captions and spoken audio on attendees' phones.
One operator captures stage audio; listeners scan a QR code and tap Listen.
Bitcoin terminology guides recognition and translation. The first event setting
is English to Korean, with selectable Japanese, Spanish, French and Chinese.
One target language is broadcast per session; stop before changing it.

The attendee link opens without an operator login. Phones wait until the stage
goes live and join automatically; captions and audio clear when the session ends.
Captions can show the translation, the live English original, or both. English
appears as soon as the recognizer sends a partial transcript. A labelled **Live
draft** revises the newest translated line as more speech arrives. Completed
captions stay stable; voice uses only completed translations. Everyone
receives one shared stream per workspace. The separate menu language selector supports English,
Korean, Japanese, Spanish, French and Chinese; it never changes the stage target.
Both pages use a dark theme by default. Voice still needs a tap on Listen.

Source: [Nostr primary](https://gitworkshop.dev/npub17j3f7cuhcvjqnf7d80x6rt9hmkkhdguwg4l2th0h4qnhqketr63s6xakwv/relay.ngit.dev/btcpp-live-translation)
· [GitHub mirror](https://github.com/murdawkmedia/btcpp-live-translation).
See [source maintenance](docs/source-hosting.md) for publication order.

One repository supports two operating profiles:

- **Local runner on Windows or Linux:** local model endpoints by default, with
  optional server-side API keys. No automatic cloud fallback.
- **Hosted event service:** a Cloudflare Worker serves the browser app and one
  Durable Object coordinates capture, captions and shared audio. Workers AI can
  supply recognition, translation and speech without separate vendor keys.

This is an early release. The protocols have fixture and local Worker validation.
Live model quality, actual Windows/vMix input, physical phone playback and venue
load require a rehearsal before event use. Korean terminology preferences remain
unreviewed. Nostr source hosting does not imply Nostr login or payments in the app.

## Local setup

Install Node 22 or newer, then run from the repository directory:

```sh
npm ci
npm start
```

Open `http://localhost:4317`. Enter the operator capability stored privately in
`.runtime/operator-token`. This is an app access token, separate from provider
keys. Attendee links have a separate read-only capability.

**Run local rehearsal** sends fixed Korean sample captions and a test tone. It
uses no models and does not demonstrate Korean voice quality. **Check audio
input** runs a level meter on the capture device without uploading audio.

To use real local models, copy `.env.example` to `.env` and configure:

1. A [whisper.cpp server](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)
   at `LOCAL_STT_URL`; its `/inference` endpoint receives short PCM WAV utterances.
2. A local [Ollama-compatible endpoint](https://docs.ollama.com/api/openai-compatibility)
   and an installed multilingual `TRANSLATION_MODEL` that handles the target well.
3. A local OpenAI-compatible `/v1/audio/speech` endpoint, plus its exact
   `LOCAL_TTS_MODEL` and `LOCAL_TTS_VOICE`. It must support the selected target
   and return playable audio. The repository does not bundle or install a model.

Model names, voice names and model licenses belong to the service being used.
The live button requires all three stages to be configured; actual availability
is checked when requests run. Unavailable local services fail visibly.

See [Linux setup](docs/linux.md) and [Windows/vMix setup](docs/windows-vmix.md).
The default localhost QR is for browser rehearsal. For physical phones, configure
`PUBLIC_BASE_URL` and an HTTPS proxy that forwards WebSockets and SSE, or use the
hosted event service. The local runner remains on loopback by default.

## Optional cloud services

Choose each stage explicitly in the server environment:

| Stage | Provider | Required configuration |
|---|---|---|
| Recognition | `elevenlabs` | `ELEVENLABS_API_KEY` |
| Recognition | `xai` | `XAI_API_KEY` |
| Translation | `openrouter` | `OPENROUTER_API_KEY`, `TRANSLATION_MODEL`, and `TRANSLATION_BASE_URL=https://openrouter.ai/api/v1` |
| Translation | `xai` | `XAI_API_KEY`, `TRANSLATION_MODEL`, and `TRANSLATION_BASE_URL=https://api.x.ai/v1` |
| Speech | `elevenlabs` | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |
| Speech | `xai` | `XAI_API_KEY`, optional `XAI_VOICE` |

Use `STT_PROVIDER`, `TRANSLATION_PROVIDER` and `TTS_PROVIDER` for these choices.
Restart after environment changes. Keys never go into the browser or public assets. Workspace owners can also use
**Connect OpenRouter** under Providers: the official S256 PKCE flow saves an
account-specific key encrypted on the server, without copying it through the
browser. This connects translation using the owner’s OpenRouter credits; it does
not change the selected model/provider. Pending connections expire after ten
minutes or a service restart. xAI and ElevenLabs retain API-key setup; their
first-party CLI/MCP login is not reused as this app’s delegated speech login.
Cloud providers receive the audio/text needed for their selected stage and apply
their own retention policies. The hosted `PROFILE=cloud` defaults to Workers AI
when vendor keys are absent; see [Cloudflare deployment](docs/cloudflare.md).

## Recognition and delivery

Browser capture sends mono PCM16 at 16 kHz. Windows Chromium can share system
sound when offered by the chooser. Linux Chromium can share tab audio; desktop
sound may require a monitor/loopback audio source. Video is not uploaded. A
speech-only vMix bus avoids music, notifications and translated-playback feedback.

Streaming ElevenLabs/xAI recognition uses bounded reconnect attempts and up to
three seconds of newly received audio buffering during a disconnect. Audio that
was already in flight may be lost; the app does not claim gapless recovery.
Local recognition uses pause-aware chunks of up to five seconds. Workers AI
recognition starts a window at five seconds, then refreshes every three seconds
with up to ten seconds of preceding audio context. Word timing suppresses
overlap; complete sentences are preferred, with a four-second fallback for
longer phrases. The final 0.6 seconds wait for more context. A 0.7-second pause or Stop
flushes the tail. This trades additional recognition work for better continuity
around technical terms; it is not word-by-word simultaneous interpretation.

The 478-entry terminology reference covers 13 Bitcoin, Lightning, ecash, Nostr,
cryptography, AI, people and organization categories, plus a Seoul main-stage
preset. Hints favor the chosen topic and talk context, within
provider count/length limits. Translation sees relevant terms and two prior
captions for context. Unreviewed glossary drafts never become mandatory rules.

Choose **Seoul main stage** for its public main-stage speakers, eight sponsors/media
partners and selected technical terms (48 references, reviewed October 23, 2026).
The full library includes 28 unique names from the public Seoul lineup, other
Bitcoin++ speakers and selected Bitcoin/AI organizations and researchers. Event
affiliations are vocabulary references, not additional sponsor claims. Before
starting, enter the current speaker, title and key names to prioritize them even
with another topic selected. Names retain their supplied spellings in translation;
they are never fuzzy replacements for arbitrary speech. Ambiguous words/handles
such as Brink, Spiral, Meta and Jin need matching context in the same sentence.
Short provider hints are explicitly authored rather than truncated names. This
adds no model request; live recognition and native Korean name review remain
separate from dictionary/fixture checks. Sources are recorded with each entry and
in `data/recognition-packs.json`; refresh the preset as the agenda changes.

Select the AI topic for local-model/agent talks, and put proposal numbers or model
names in the talk context before starting. Recognition hints include BIP 54,
BIP 30, UASF and URSF; these last two are distinct and never interchanged.
Utreexo and UTXO also have separate entries and are never interchanged.
English drafts and finals normalize explicit BIP spellings, retaining the same
digits. The known `Bit54` error becomes `BIP 54` only in nearby proposal/UTXO
context, with bitfield, identifier, URL and sentence-boundary guards. Ambiguous
numbers and unverified phrases stay unchanged. This adds no model request.

ElevenLabs and xAI streaming recognition supply partial transcripts before a
segment is committed. Local/OpenRouter/xAI translation streams answer tokens
into a revising draft, with one preview request active and starts at least two
seconds apart. New partials coalesce into the latest pending input; obsolete
utterances are cancelled. These extra preview requests use the configured
translation provider's credits, once per workspace rather than per attendee.
Workers AI does not make extra preview calls; its recognition and completed
translation keep the existing bounded-window behavior.

Final translations also stream while being generated, then become stable on
successful completion. Incomplete or failed answers never become final captions
or voice. Compatible xAI models use low reasoning effort for translation. A
completed draft with exactly matching English can be reused at recognition
commit. Streaming reduces app-side waiting; network, recognition and model
latency still apply. English and Korean word order also means drafts can change.

HTTP voice audio is available from its first bytes, through one shared bounded
stream and cache. Supported browsers feed MP3 frames to Media Source playback;
others use their normal audio element and may buffer longer. xAI speech requests
use latency optimization level 2. Set the speech provider to xAI/Grok and choose a
voice such as `rex`; check the provider before a live session. Captions never wait
for voice. Spoken text still waits for a completed translation, so faster synthesis
does not eliminate recognition/translation latency or make drafts safe to speak.

Translation and synthesis happen once per stage/target, shared by listeners.
The hosted default uses Whisper large v3 turbo, Qwen3 with /no_think for
translation, and MeloTTS for optional listening. Explicit model choices remain
supported. Cloud translation protects Bitcoin units with temporary identifiers,
restores their exact spellings and rejects missing or duplicated identifiers.
A failed cloud translation is retried once; persistent failure is reported.

Cloud recognition coalesces overlapping pending windows during a slowdown instead
of closing capture when its small FIFO fills. Pending source audio stays bounded
to 30 seconds; longer delays can skip speech and produce a visible warning.

Captions have their own ordered queue. Speech runs separately and cannot hold
back the next caption; queued voice is bounded and older audio is skipped if it
falls behind. Queues, caption history and audio memory are bounded. Text remains
available if speech fails. Phones explicitly enable playback, skip stale audio and reconnect
for current captions. Raw source audio and transcripts are not persisted by the
app. Hosted sessions stop after six hours and can be restarted.

## Development and deployment

```sh
npm test
npm run check
npm run build:cloud
npm run dev:cloud
```

See [verification](docs/verification.md), [handoff](docs/handoff.md) and
[upstream references](docs/upstream-reuse.md). The application is MIT licensed;
provider services and optional models have separate terms and licenses.

Unexpected live transport resets automatically reconnect with the selected audio
input, with three attempts per interruption. Stop cancels recovery. Explicit
provider failures remain visible and require a manual restart. Speech during
reconnect may be missing; source audio is not recorded or replayed.

## Private provider settings

After operator login, open **05 / Providers**. Choose transcription, translation
and optional voice independently. Enter your ElevenLabs, OpenRouter or xAI API
keys into the password fields and save. Blank fields keep existing keys; Remove
saved key deletes an app override and reveals any server environment credential
again. Keys are never returned to the browser or sent to attendees. Save does not
call a provider. Stop the session before changing settings.

For English-to-Korean captions with your own services, choose **ElevenLabs**
transcription, **OpenRouter** translation and **Off · captions only** voice. The
translation model ID is editable; ensure it is available to your account. Enable
ElevenLabs voice with a voice ID, or xAI voice with your xAI key when desired.
One xAI key can serve all three stages when each is explicitly selected.

The check buttons use saved settings and may consume credits. Streaming
transcription checks authenticate the connection without sending audio; they do
not measure word accuracy. Translation and voice use short fixed sample text.
Passing checks do not establish sustained, Korean or event acceptance.

The local runner encrypts settings under ignored `.runtime/`, with a separate
private wrapping-key file and restrictive file permissions. Protect the directory
with OS permissions on Windows; do not copy it into source packages. Hosted
settings use encrypted Durable Object storage and a separate Worker secret; see
[Cloudflare setup](docs/cloudflare.md). Keep the encryption key stable and recover
it together with encrypted settings. Missing or corrupt stored settings block live
capture visibly rather than silently choosing a different provider.

## Separate browser workspaces

The hosted administrator can create private operator/event workspaces under
**06 / Workspaces & access**. Each has its own login code, provider keys, session
and attendee QR link. New workspaces cannot fall back to the default desk's
API keys or Cloudflare AI allocation. Owners may explicitly grant revocable
seven-day event access using their workspace budget. See [workspace setup and
permissions](docs/workspaces.md). Operators and attendees use a browser; no local
installation is needed for the hosted version. Keep the main administrator code
private. The existing default stage and attendee link remain usable.
