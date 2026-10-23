# Faster shared voice and provider connections

Keep English/Korean caption drafts and completed captions independent of voice.
For HTTP speech providers, publish the first validated audio bytes while the
remaining response is generated. One bounded in-memory audio object per caption
replays bytes to late joiners and follows new bytes for listeners already playing.
Slow or cancelled listeners never trigger another synthesis request. Preserve
24 MiB aggregate cache, bounded speech queue and per-response limit; cancellation,
eviction and upstream failure terminate readers and never leak raw errors.
Use xAI's documented latency optimization for speech; keep existing model, keys
and voice selections unless the owner explicitly changes them. Voice still uses
completed translations, not revising drafts. This removes audio buffering delay,
not recognition commit or translation time. MP3 uses Media Source playback where supported to bypass file sniffing; other
engines/types retain normal audio playback. Browser buffering needs real testing.

Add Connect OpenRouter using official S256 PKCE. Store verifier/state only on the
server for ten minutes, scoped to the authenticated owner and workspace, bounded
to four attempts. Consume state once, reject mismatched/expired attempts or settings
changes, exchange at the fixed official endpoint and encrypt the resulting API key
through existing provider storage. The browser receives status only and removes
callback parameters. No passwords, API keys or verifier enter browser storage.
Event operators/attendees cannot connect providers. Stop capture before connecting;
restarts invalidate pending logins safely. Connecting does not switch the selected
translation model/provider or inherit another workspace's credits.

xAI and ElevenLabs retain documented API-key integration. CLI/MCP login support
alone does not establish a public delegated speech-API flow; do not reuse another
application's OAuth client. Add visible GitWorkshop source links on both pages.

Verify early bytes, shared replay, failures/limits/cancellation, real Node/Worker
routes and workspace isolation; verify PKCE/CSRF/replay/owner boundaries with fixture
exchange only. Provider checks may test a supported speech override without saving
it. An explicitly authorized owner can switch to Grok/rex only after a passing
Korean speech check. No billing upgrade, paid fallback or hidden model change.
