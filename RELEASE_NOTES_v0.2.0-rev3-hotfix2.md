# v0.2.0 rev.3 hotfix 2

Manifest 0.2.0.5. Fix cross-profile Workspace views independently of restored monitoring preferences.

- Existing `_Library/_inventory.json` is adopted on connection/opening Files. Retain baseline and archive eligibility; no network scan required to display the saved list. If older than five minutes, opening Files schedules one existing incremental metadata check (no original downloads or auto-enrollment). Refresh inventory remains available for a full manual refresh.
- `.activity-manual.json` and `.activity-library.json` contain only terminal operation summaries, dates, destination type and counts. A manual browser download is labeled as completed in the originating browser. Local active/resumable jobs, raw logs, paths, download IDs, buffers, permissions and monitoring flags are not shared. Existing Library reports are readable even before an old profile publishes a new receipt. A manual download that was never recorded in the shared Vault cannot be reconstructed from disk; open the originating upgraded profile to publish its retained history.
- Visible persistent panels refresh shared metadata about every 30 seconds; widget uses a short history cache. Reads require the same verified Workspace/Vault and do not take a writer lock. Receipt publication uses existing protection and cannot replace newer receipts.

No new permissions. No existing index-format migration. Actual authorized Chrome/Edge cross-profile UAT is still required.
