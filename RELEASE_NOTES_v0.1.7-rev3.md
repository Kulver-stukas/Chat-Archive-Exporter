# Chat Archive Exporter v0.1.7 rev.3 — UX/UI fixes (test build)

The archive core is frozen at **v0.1.6.11 rev.1**. This revision updates only the UI, presentation-state observer, and browser-local UI metadata cache. It neither migrates nor writes new formats to Vault.

## Changes

1. **Widget self-recovery.** The widget's status request now re-verifies the ChatGPT tab after the MV3 Service Worker is suspended, restarted, or has lost a five-minute transient binding. A single re-verification per tab is shared across concurrent requests; normal cached status requests do not re-query the provider. The widget polls cached job states every 45 seconds while visible and refreshes on tab focus/visibility. Temporary offline conditions display an explicit reconnecting state rather than erasing the last good summary. It never owns a job or downloads files.
2. **Compact widget.** Summary spacing and log heights are reduced, avoiding outer scrolling in the tested 720px-high browser viewport. Individual logs scroll independently, with an internal fallback for shorter browser windows.
3. **Chats: cache before API.** The Side Panel displays any saved workspace-scoped list of chat metadata first, using a UI metadata cache and, when readable without a permission prompt, the existing Vault `.workspace.json` index or background mirror. A normal `CAE_LIST` query then replaces it with the authoritative current list. The cache is per Workspace, is never used across accounts, and stores no chat bodies or access credentials. The user can select cached chats while the list refreshes; an API failure leaves the saved list visible and clearly marked as unavailable to refresh. Export still uses the unchanged v0.1.6.11 job controller.
4. **Project Sources wording.** Sources that also occur in Library are still listed once. A Source is not assumed to have a verified copy in Vault merely because it is linked to a Project; the interface now notes that Vault archival of that Source is not verified.

## Important limitation — Project Sources

The frozen Library policy continues to exclude Project Source-linked files from the Library original-download route. If a Project's Sources have not been archived, those files may therefore be absent from Vault. As a temporary workflow, export the Project with Sources enabled. A future archive-engine maintenance patch should check actual archived Source identity and verified local content before applying an exclusion, otherwise offer explicit Library archival; this is not an automatic change in v0.1.7.

## Testing and installation

Install over the same unpacked-extension directory and press Reload in `chrome://extensions`. Refresh any open ChatGPT tab once to replace the old widget content script. Do not uninstall or delete the existing Vault index.

Synthetic automated validation covers the worker rebinding, a 720px compact widget, the cached Chats-before-API workflow, selection retention, offline refresh fallback, and previous Popup/Side Panel regressions. Authenticated Chrome testing remains necessary. No new permissions, background task algorithms, source-fetching logic, or existing Vault layout changes are included.
