# Linux runner

The same Node application and repository run on Linux and Windows. No desktop
extension, root service or separate Linux fork is required.

Install Node 22+, run `npm ci`, then `npm start`. The server opens on loopback
port 4317. Copy `.env.example` to `.env` and connect separately installed local
recognition, translation and speech services as described in the main README.
Use explicit cloud provider settings if desired; missing local models never
activate cloud requests automatically.

For a browser video, open both the video and translation desk in Chromium.
Choose Shared desktop / browser tab, select the video tab and enable tab audio.
On Linux this does not capture sound from a separate Firefox window. Firefox
screen sharing does not supply an audio track; use an audio input/monitor when
keeping playback in Firefox. See the [browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/MediaDevices.json).

For system or mixer audio, choose an audio input. PipeWire/PulseAudio setups can
route a sink monitor to the browser recording stream using their audio control
panel or a deliberately created virtual input. Keep translated playback out of
that route. The app makes no audio-service, device, desktop or routing changes.

Run Check audio input first: play speech, watch the meter, then Stop session.
This is a local-only soundcheck and does not translate. Next choose audio & go
live with the same working source. ON AIR indicates an open live capture; allow
a few seconds of English speech before the first caption. Stop stays available
while choosing/connecting/capturing, even if server status is delayed. The operator
desk recovers captions from periodic snapshots when its event stream is interrupted.
Start real translation only once the chosen model services are ready.
For remote attendees use a reachable HTTPS proxy or the hosted event service.

Physical input, Bluetooth, system-monitor routing, screen lock and long-session
latency are device-specific acceptance checks, separate from fixture tests.
