# Agent guide

This repository contains a Node 22+ local runner and a Cloudflare Worker/Durable
Object deployment. Read README.md, docs/cloud-local-design.md and docs/handoff.md.

Run npm test, npm run check and npm run build:cloud before claiming a release.
Use fixture services for automated tests; paid provider checks require explicit
operator authorization. Keep credentials, capabilities, recordings, transcripts,
logs, deployment evidence, model weights and machine-specific configuration out
of Git. Local defaults must never silently fall back to a paid cloud provider.

Keep Windows/Linux in the same source tree. Preserve provider hint limits,
operator/attendee separation, bounded queues/history/audio, ordered captions and
stop/cancellation behavior. Source publication is separate from deployed runtime
acceptance. Hardware, physical phones and venue load require their own evidence.
