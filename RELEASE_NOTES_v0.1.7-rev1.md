# Chat Archive Exporter v0.1.7 rev.1

UX/UI test build over the frozen **v0.1.6.11 rev.1** archive core. Not published to GitHub or the Web Store.

## Popup-first workflow

- **Export**: Download MD or Save to Vault for the complete current conversation. Open the conversations or Library/Images selector. Explicit Start inventory; never a full Library scan on opening/focusing the UI.
- **Activity**: independent manual-export, Library and chat-monitor states; stop/pause/resume controls and folded logs. Open a persistent Side Panel monitor or an optional in-page widget.
- **Settings**: Vault connection, existing chat-monitor settings, existing Library monitoring options, theme, auto-close and widget preference.
- **Tools** (wrench in header): workspace configuration snapshot to Vault, cached Library catalog JSON, permission diagnostics, reconnect ChatGPT, reconnect Vault, refresh cached status and explicitly refresh the chat list.
- Reconnect Vault is also exposed beside the connection status when needed. Choosing/changing a folder from the toolbar popup opens a persistent extension settings tab; click Choose Vault there. This avoids owning the directory picker inside a dismissible popup. Existing workspace bindings and indexes are retained.

## Side Panel

- Current / Chats / Files / Monitor. No permanently open panel is required.
- Shared selectable-group component, indeterminate parent checkboxes, search and facets, stable selection through filtering, counts for selections hidden by filters.
- A parent checkbox selects the entire eligible group (including filtered-out members). Select visible acts on filter matches. Disabled/unavailable or Project-managed originals remain visible with explanations.
- The list has its own scroll area and does not overlap the export action.
- Auto-close defaults to enabled and is attempted only after durable export acceptance. Keep panel open overrides it. Rejected submissions remain open. If `sidePanel.close` is absent or Chrome refuses closing, the job is still accepted and the panel remains in Monitor view.
- Whole-chat export only: no pretend partial Prompt/Thinking/Response export and no new extraction API. The detailed per-block selector remains deferred.

## Optional widget and icon

- Activity -> Show widget displays a collapsible, draggable monitor on the active ChatGPT tab. Settings -> Show monitoring widget enables it on ChatGPT pages. Off by default.
- Lightweight cached job state, verified/bound workspace, Vault access, quick full-chat Markdown export, open chat/file selector or settings/monitor.
- Keyboard reposition: focus the widget title and use arrow keys. Dismiss hides it for that loaded tab. No token, raw job payload or file content is inserted into the page.
- Showing/focusing or explicitly refreshing the widget uses the existing scope verification call. Repeated status updates read cached extension state, not Library descriptors. A stale scope is labelled as last verified; reverify before quick export.
- Toolbar floppy: red record plaque for queued/running work, green pause for idle/waiting. Neutral base icon indicates a condition requiring attention; tooltip explains. Monitoring enabled while waiting is not shown as active writing.

## Technical boundary

All 31 archive-core files in `lib/`, `content.js`, `sync-watch.js`, and `offscreen.*` are byte-identical to v0.1.6.11 rev.1. The original worker body is intact; a separate UI-only observer/routing module is appended. No new Chrome permissions, host access, export formats, database schema, Vault migration, API routes, archive scheduling, limits, or retry policies.

## Install

Replace files in the **same unpacked extension directory** and Reload at `chrome://extensions`. Do not uninstall, clear storage, or choose a different folder solely for this update. Refresh an already-open ChatGPT tab once to load the new widget script; the existing bridge can otherwise reconnect in place. Close old extension popups/panels before testing the update.

## Validation and limitations

See `TEST_REPORT_v0.1.7-rev1.md`. Automated tests use synthetic data. Real signed-in Free/Business Chrome acceptance testing is still required. No authenticated user API or disk archive was accessed in this build environment.

For future publication, package the new **ui/** and **icons/** directories as well as **lib/**. The older release workflow that copied only lib/ is insufficient. Use `python tools/package_extension.py dist/chat-archive-exporter-v0.1.7.zip`.
