# Open-source references

The implementation adapts useful patterns from these projects. There is no
upstream Git commit cherry-picked into this repository and no copied upstream
implementation in this release; their codebases and runtime stacks differ.

- [sichengchen/live-translate](https://github.com/sichengchen/live-translate),
  MIT, reviewed at `90b141e5cc2c13e8e167d3a53778a34030709d85`: attendee QR
  rooms, one processing stream per target language and separate host/listener
  responsibilities. This release retains its own shared audio-segment protocol.
- [Sebzdead/livetranslate](https://github.com/Sebzdead/livetranslate), MIT,
  reviewed at `a9ba61554c74634dbe2ee97d91fbb7a0648c494d`: prioritized bounded
  recognition vocabulary, translation context, provider recovery and phone
  reading behavior. This release adds bounded reconnect buffering but does not
  implement that project's disk resume or overlapping audio replay.
- [Pipecat multi-translation](https://github.com/pipecat-ai/pipecat-examples/tree/main/daily-multi-translation),
  BSD-2-Clause: translated audio shared by language, with audience language
  selection as a future multi-broadcast pattern. This release supports one
  selected target at a time and does not depend on Daily or Pipecat.
- [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit), Apache-2.0:
  local speech services and incremental recognition are useful future engine
  options. This release's local adapter uses whisper.cpp's HTTP protocol.

Recognition API wire formats were checked against current vendor documentation.
ElevenLabs keyterms are repeated query parameters, with provider-bounded lists;
final committed transcripts are processed once. A committed transcript's optional
second timestamp event is not interpreted as another utterance.

Retain upstream copyright and license notices if actual code is imported later.
The MIT license here covers this repository's original code. Optional models,
providers and tools retain their own licenses.
