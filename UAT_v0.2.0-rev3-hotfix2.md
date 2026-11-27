# Cross-profile acceptance

Use backup/test Vault. Both profiles should run this build or corresponding stable candidate.

1. In browser A, use an existing Workspace with saved Library inventory and a completed manual export. Open Monitor after update, so local retained history is published. Confirm the two small `.activity-*.json` files in the workspace folder.
2. In clean browser B verify the same Workspace, select same Vault. Open Files. Existing rows must appear before the API update; no new initial inventory or original downloads. If snapshot is recent, no redundant scan. With older snapshot, expect one incremental metadata refresh; confirm cutoff, existing archive markings, and local Library monitoring unchanged.
3. Open Monitor and widget; verify historical manual/Library summaries. Browser downloads are historical, not files downloaded into B. Local active tasks must take precedence, no new Resume/Stop for foreign receipts.
4. While B remains open, complete an operation in A. After shared metadata refresh, verify latest completed receipt and refreshed catalog. Simulate API outage; saved inventory should stay visible.
5. Switch account or Vault, check history/catalog isolation. Cancel/stop a local job; ensure no cross-profile queue adoption. Repeat writer-claim recovery UAT from hotfix 1.
