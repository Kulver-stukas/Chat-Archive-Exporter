# Upgrade and acceptance checklist — v0.2.0 rev.2

Back up the Vault and extension directory. For an unpacked installation, replace the files in the same folder, keeping the extension ID; reload the extension and refresh ChatGPT. Do not clear extension storage. A separately installed copy may have a different browser-local identity and permissions. Test using a copy of the Vault before concurrent production use.

- Verify recognized account/workspace, existing path and retained portable settings. No duplicate workspace tree should be created.
- Export a complete chat and a selected-message ZIP with original image files; check existing paths and local edits.
- With monitoring enabled, simulate a lost directory permission, open persistent Settings and reselect the original folder. Confirm monitoring remains enabled, enrollment date and pending work are preserved; a different folder is refused.
- Check access diagnostics download and Copy diagnostics.
- On Chrome and Edge running guard-enabled versions, try simultaneous archive operations against the same local test Vault. Check the index remains valid, new revisions survive and deferred work retries. A stale claim is only removed manually after all writers stop.
- Confirm normal Library inventory, background monitoring, account switching, selection and cancellation behavior. No new provider is enabled.

This revision is a local architecture preview, not a Web Store release. Do not use an old guard-less build concurrently on the same Vault.
