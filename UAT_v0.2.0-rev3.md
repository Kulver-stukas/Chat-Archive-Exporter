# v0.2.0 rev.3 acceptance tests

Use the existing unpacked rev.2 directory and a backup/test Vault. Reload the extension and refresh the ChatGPT page. Manifest version must read `0.2.0.3`. Do not clear extension storage. No new permissions should be requested.

- Verify the correct workspace, existing Vault path, restored policies, enrollment date and pending jobs. No new archive directory or unsolicited inventory.
- Compare complete chat Markdown with rev.2 for existing chats with visible Thinking, math, web citations and uploaded/generated files. Check titles, model/date headers and local file links. Selected-message ZIP members, attachment bytes and export report must agree for unchanged source data.
- Test Library metadata inventory, image gallery, project-source placement, selected originals, configuration snapshot and schedules. No Memory export or automatic download of originals.
- Test account/workspace switching during an export and expired or denied original requests; no foreign-workspace export, false successful file or credential leak. Test source cancellation, rate limits and recovery.
- Test missing/reinjected content bridge, popup/panel/settings, widget state, restart and monitoring. Repeat existing rev.2 UAT, including same-folder recovery and cooperative writer guard in a test Vault.
- Verify both Chrome and Edge in authenticated sessions. Keep older guard-less writers out of the same Vault. No release or store publication of this preview.
