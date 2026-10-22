# Bitcoin++ live translation

English speech to translated captions and spoken audio on attendees' phones.
One operator captures stage audio; listeners scan a QR code and tap Listen.
Bitcoin terminology guides recognition and translation. The first event setting
is English to Korean, with selectable Japanese, Spanish, French and Chinese.
One target language is broadcast per session; stop before changing it.

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
Restart after environment changes. Keys never go into the browser or public assets.
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
Local/Workers AI recognition uses pause-aware short chunks, with a five-second
maximum before processing. A long uninterrupted phrase may span chunks.

The 345-entry terminology reference covers 10 Bitcoin, Lightning, ecash, Nostr
and cryptography topics. Hints favor the chosen topic and talk context, within
provider count/length limits. Translation sees relevant terms and two prior
captions for context. Unreviewed glossary drafts never become mandatory rules.

Translation and synthesis happen once per stage/target, shared by listeners.
Queues, caption history and audio memory are bounded. Text remains available if
speech fails. Phones explicitly enable playback, skip stale audio and reconnect
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
