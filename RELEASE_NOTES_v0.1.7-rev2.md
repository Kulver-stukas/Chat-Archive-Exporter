# Chat Archive Exporter v0.1.7 rev.2 — UI corrections (test build)

Functional baseline remains **v0.1.6.11 rev.1**. This is an unpacked Chrome extension test build; it does not change export engines, API parsing, Vault formats or background checkpoint semantics.

## UI changes

1. Chrome toolbar status now uses a **native, larger color badge** on the floppy-disk icon: red `REC` when a job is executing, green `IDLE` when idle, neutral `CHECK` for genuinely actionable unresolved failures. A canceled Save dialog (`USER_CANCELED`) is not a failure and does not cause `CHECK`.
2. **Side Panel Settings and Tools** open locally in that panel. `Back` returns to the earlier panel view. Only explicit Vault folder selection from the small Popup opens the persistent settings tab; an already open settings tab is reused.
3. The former floating `↓ MD` button is suppressed on every ChatGPT page, whether or not the optional widget is enabled. Quick export remains available in Popup and in the widget's expanded controls.
4. Vault access labels distinguish a document-local browser `prompt` from an existing granted background writer. The UI does not claim that a canceled browser download changed File System Access permissions. `Reconnect Vault` remains available when needed.
5. The in-page widget has a **compact summary** (workspace, activity, chat/Library/monitor statuses, Vault), and optional **Show logs** mode with Export/Inventory/Monitoring logs. The widget no longer routes its monitor button to Side Panel. Logs are scoped to the verified Workspace and bounded/redacted before passing to the page.
6. Closing a widget with `×` also clears the persistent visibility checkbox; **Show / hide widget** in Popup Activity is an explicit toggle. The legacy floating export button stays hidden on dismissal.
7. Toolbar status `REC` reflects active processing, not merely enabled monitoring. Retrying a canceled Save is optional; the retained manual job can also be stopped using existing actions.

## Restrictions and testing

- **No changes to v0.1.6.11 archive core.** No Vault migration, new permissions, sibling Workspace access, Memory capture or new provider endpoints.
- Tests: all 55 Node.js suites, 10 Chromium Popup/Side Panel DOM scenarios and in-page widget DOM tests with synthetic worker/FS fixtures.
- Native user-authenticated Chrome acceptance is still required for browser badges, real File System Access permission changes, long-running monitoring and provider-specific states. In particular, the underlying browser may report `prompt` in one extension document while another background context retains a grant. The UI now describes this distinction but cannot override browser permission decisions.

## Update

Unpack over the **same extension directory**, use Chrome Extensions → Reload, then reload the existing ChatGPT tab once so that the old content script is replaced. Do not delete extension storage or reset the Vault.

For testing, cancel a Download ZIP dialog, observe a neutral status rather than `Needs attention`, then check Settings/Tools directly inside Side Panel and toggle the widget via Activity and the `×` button.
