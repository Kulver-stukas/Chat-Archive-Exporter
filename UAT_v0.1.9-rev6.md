# v0.1.9 rev.6 — acceptance checklist

Test the unpacked build in a separate profile or update the same unpacked installation. An unpacked copy has its own extension origin and cannot inherit permissions from the Web Store installation.

- [ ] Existing profile: same Vault, same verified account, unchanged archived paths, prior monitoring policy retained.
- [ ] Fresh Chrome profile, existing Vault: choose folder, verify ChatGPT, explicitly enable Chat monitoring; no repeat export if a matching unmodified indexed chat/configuration exists.
- [ ] Fresh Edge profile: after network failure and recovery, reload ChatGPT if required, confirm verified workspace, then connect the selected Vault.
- [ ] Options tab: refresh statuses, export diagnostics, reconnect ChatGPT, enable/pause monitoring; content scripts cannot call privileged routes.
- [ ] Simulated offline/slow session: status reports a connection problem, never falsely reports monitoring Off or enabled; retry after going online.
- [ ] Stop worker/reload extension: diagnostics are downloadable even if worker fails to respond; no paths, chat text, tokens, or raw account IDs.
- [ ] Empty Vault requires a verified initial chat or configuration snapshot; different workspace IDs and ambiguous indexed directories are rejected.
- [ ] Manual chat and Library export into a previously named directory retain that directory; new chats and project sources are never placed in a duplicate workspace directory.
- [ ] Restart browser; inspect UI/worker/offscreen permission status and manually grant access if requested. Monitoring remains explicit, no automatic permission prompts.
- [ ] Verify unchanged selective Markdown and ZIP export, attachments, Library explicit scanning, local-edit protection, cancel/recovery, and no extra permissions.
- [ ] Do not enable simultaneous writers in Chrome and Edge against one Vault. Web Locks are profile-local; cross-profile mutual exclusion is not implemented.

Use a test Vault or a backup before acceptance testing. This build is not a Chrome Web Store release.
