# Source maintenance

The authoritative source is the
[Murdawk Nostr repository](https://gitworkshop.dev/npub17j3f7cuhcvjqnf7d80x6rt9hmkkhdguwg4l2th0h4qnhqketr63s6xakwv/relay.ngit.dev/btcpp-live-translation).
[GitHub](https://github.com/murdawkmedia/btcpp-live-translation) mirrors its
reviewed public commits. The application is MIT licensed on both hosts.

With the [ngit remote helper](https://ngit.dev/install) installed:

```sh
git clone nostr://npub17j3f7cuhcvjqnf7d80x6rt9hmkkhdguwg4l2th0h4qnhqketr63s6xakwv/relay.ngit.dev/btcpp-live-translation
```

HTTPS GitHub clones work with ordinary Git. For maintainer updates, run tests
and the Worker build, inspect the exact outgoing diff/history for private content,
then push Nostr first and mirror the same commit to GitHub. Verify anonymous
clones have the same commit, tree and reachable objects. Configure signing through
ngit's own account tooling; never place a signing key in this repository.

Source publication does not deploy the application. Cloudflare deployment needs
its own account authentication, private access capabilities, build verification
and runtime acceptance. Stop the active capture session before deployment.
This repository does not install a recurring mirror or deployment job.
