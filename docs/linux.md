# Linux runner

The same Node application and repository run on Linux and Windows. No desktop
extension, root service or separate Linux fork is required.

Install Node 22+, run `npm ci`, then `npm start`. The server opens on loopback
port 4317. Copy `.env.example` to `.env` and connect separately installed local
recognition, translation and speech services as described in the main README.
Use explicit cloud provider settings if desired; missing local models never
activate cloud requests automatically.

For a browser video, choose Shared desktop / browser tab, select that tab and
enable audio sharing. A window/screen choice may not provide an audio track on
Linux. The app detects that and asks for another source rather than sending silence.

For system or mixer audio, choose an audio input. PipeWire/PulseAudio setups can
route a sink monitor to the browser recording stream using their audio control
panel or a deliberately created virtual input. Keep translated playback out of
that route. The app makes no audio-service, device, desktop or routing changes.

Run Check audio input first: play speech, watch the meter, then stop. This uploads
nothing. Start real translation only once the chosen model services are ready.
For remote attendees use a reachable HTTPS proxy or the hosted event service.

Physical input, Bluetooth, system-monitor routing, screen lock and long-session
latency are device-specific acceptance checks, separate from fixture tests.
