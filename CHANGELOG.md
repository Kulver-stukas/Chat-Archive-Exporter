## v0.1.6.9 — Schedules inventory and Vault metadata consistency (2026-11-15)

- Added **read-only Schedules / Automations** inventory to the current-scope `_workspace_configuration.json`: scheduled, paused, and finished lists from `/backend-api/automations?filter=...&limit=25`, with cursor pagination, full returned prompts, original RRULE / VEVENT schedule, timezone, enabled state, notifications, source chat ID, and available timing/executor settings. Suggested automations and run histories are excluded. Each request is bound to a freshly verified active account; there is no sibling-account enumeration or Memory request.
- Integrated Schedules into the durable initial manual configuration snapshot and the opt-in periodic background configuration refresh. A complete empty inventory can reflect a verified deletion. Partial or failed inventories cannot erase a previously complete list. A recurring scan skips an unchanged root configuration rather than replacing it just to refresh the timestamp.
- **Every initial manual Vault / multi-chat ZIP export**, including a single selected conversation or an empty Project, now includes accessible current-workspace configuration, Projects/Sources *inventory*, personalization and Schedules. Binary Project Sources remain restricted to explicitly selected Projects unless the user chose full workspace export. Direct one-chat `.md` download remains chat-only.
- Added YAML / workspace-index `archived` and `project_id` fields; updates to archive status, project assignment, GPT label and conversation title are detected even when the server list update timestamp has not changed. Disk chat paths remain fixed, including when moving into/out of Projects or archiving a chat.
- Background creation waits for a stable title before first-saving a new untracked `New chat` / `Untitled chat`, avoiding permanent placeholder filenames. Previously created files are not renamed; their YAML/index metadata can be updated.
- GPT group labels in the chat-selection UI are resolved from **current-workspace-only** `gizmos/bootstrap`, with limited metadata-only fallback for observed GPT IDs; no hidden instructions or GPT Knowledge are saved.
- Background opt-in also accepts a **verified, indexed configuration-only Vault seed** (e.g. an empty Project export), without permitting unverified directory adoption or automatic old-history backfill.
- No new browser permissions. Schedules and the initial configuration requirement are covered by simulated API/Chromium/Vault tests; native authenticated-browser UAT remains necessary.

## v0.1.6.8 — Scoped current-configuration snapshot (2026-11-14)

- Added a **metadata-only Snapshot to Vault** manual action, accepted by the durable v0.1.6.6 job controller independently of background sync; no chat-body or binary Source downloads.
- Added a **24-hour opt-in background configuration refresh** with durable stages (current identity → GPT bootstrap → installed GLOBAL/WORKSPACE Plugins → guarded root commit → personalization); requires available Vault permission. Existing chat capture/buffering remains unchanged.
- The root `_workspace_configuration.json` now records verified active scope, available current identity, Project inventory, *partial* current-scope custom GPT names, **explicit user-installed Plugins only** and bundled Skill metadata, with scope provenance, completeness and error states. No standalone Skill content, full Plugin manifests, OAuth-provider metadata or remote datasets.
- Per-endpoint fail-closed scope gates; no sibling account traversal, no account-switcher API and no account or Project Memory requests. Manual conversation listing also verifies current scope before each backend page.
- Complete historical sections are preserved on failed/partial refresh. Local edits, existing Vault paths, staged captures and original source protection remain unchanged.
- Added real-sample **normalization-only** verification (7 user plugins/57 bundled Skills in one sample; 1/1 in the other). These user samples are **not bundled** with the extension.

---

## v0.1.6.7 - Container classification and idle recovery (2026-11-12)

- Distinguish true Project IDs (`g-p-` with a 32-hex identity) from custom GPT gizmo IDs (`g-...`). Project-only APIs never receive a GPT ID; old invalid `project_chats` / connector jobs are removed safely from the durable queue.
- Show GPT conversations in their own `GPT` groups in All conversations. Archive newly selected GPT chats beneath `_GPTs/<displayed name> [id suffix]` and label them `container_type: gpt` in Markdown and with `gpt_id` / `gpt_name` in `.workspace.json`. Existing archived paths are not moved or renamed automatically.
- Enumerate empty Projects as first-class selectable objects; manual export can archive their available metadata and original Sources without inventing a chat.
- Produce `_workspace_configuration.json` in the workspace root. Record Projects, GPT identities observed in conversations, and project connector scopes. Mark Plugins and Skills as `not_enumerated_no_verified_client_api` with null items rather than falsely recording an empty installed list. Full owned/installed GPT, Plugin and Skill configuration/content export is deferred.
- Treat a suspended/timeout ChatGPT API connection as a recoverable waiting state, preserving the queue, verified account binding, enrollment cutoff and prior captured updates. The browser can later reactivate its verified ChatGPT tab; no full-history polling or extra host permissions.
- Preserve all v0.1.6.6 rev 1 manual job, permission, buffer, conflict and other safety rules. This is an experimental build pending native acceptance.

---

## v0.1.6.6 rev 1 — 2026-11-12 (panel-only test hotfix)

- Restore background-sync status while the active browser tab is not ChatGPT. Keep the last verified workspace in per-window `chrome.storage.session`, with a read-only view outside ChatGPT.
- Ignore stale status replies from a previously active workspace; do not allow off-site changes to sync settings.
- Keep existing archive, source, manual-job and background controller implementations unchanged.

# v0.1.6.6 - Autonomous manual exports (test candidate)

- Move manual current-chat, selected-chat Vault and bounded ZIP execution from
  panel.js to a durable workspace-bound controller in lib/manual-jobs.js.
- Add separate IndexedDB job/staging/handle/cancellation storage, immutable item
  checkpoints, short serialized passes, restart recovery and shared writer locking.
- Use offscreen only for retained manual handles and bounded Blob/ZIP preparation;
  the worker remains the controller/Vault writer and downloads API caller.
- Add downloads permission, final manager completion tracking, persisted delivery
  intent and a non-duplicating ambiguous-delivery state with explicit retry.
- Restore accepted progress and the frozen Vault binding on panel reopening.
  Stop does not depend on the initiating port; a stopped collecting ZIP is partial.
- Route popup and in-page current-chat saves through one quick manual command.
  Their destination remains a downloaded .md; no implicit Vault enrollment.
- Propagate API cooldown/auth failures from project snapshot reads, preserve
  source transport error types, and recover identical interrupted metadata commits.
- Keep 0.1.6.5 automatic buffer/mirror, local-edit protection, no-Memory scope,
  source byte fidelity and existing disk indexes. No REC badge or selection of
  individual Prompt/Response messages in this build.

---

## Historical changes (earlier builds)

# v0.1.6.5 — IndexedDB background capture and Vault reconciliation

- Added `lib/sync-spool.js`: versioned, workspace-scoped IndexedDB mirror and bounded, atomic full-Markdown captures; only verified Vault contents establish tracked-object eligibility. No Memory, credentials or binary Source bodies are stored.
- Split background sync into API capture and Vault-delivery stages; loss of write grant no longer blocks eligible completed-chat capture after the mirror has been seeded. Retains the source/account scope checks, cooldown handling and enrollment cutoffs.
- Buffered delivery validates hashes, reconciles against the authoritative real disk ledger and protects local edits. Exact-match recovery supports crashes between the file write and ledger update.
- Adds conservative buffer limits, conflict retention, safe reference to the original Vault, status counts, and rebuild of Source inventories after a Vault permission interruption.
- Preserves v0.1.6.4 rev 1 content-script hotfix and Chrome/Edge offscreen handle retention. No additional extension permissions.

---

## 0.1.6.4 rev 1 — Existing-tab bridge recovery (test revision)

- Restore a missing or version-stale ChatGPT content-script receiver on already-open tabs after unpacked extension Reload or a Web Store update. Prefer a versioned ping, otherwise inject the exact packaged content-script files in order in the ISOLATED world, without tab reload.
- One-time install/update scan, bounded activation checks, in-flight deduplication and failure backoff. Only ChatGPT host pages; no change to API/background polling.
- Panel requests controlled recovery after a missing-receiver Port disconnect; successful injection resets the reconnect backoff.
- Avoid duplicate content/watch listeners and replace old in-page buttons with invalidated click handlers.
- Add `scripting` permission. Numeric manifest version remains 0.1.6.4 in this unpacked test package; Web Store distribution needs a new numeric version.

# v0.1.6.4 - Vault handle retention and access diagnostics (2026-11-11)

- Persistent offscreen Map per enabled workspace; restore all handles on worker/browser startup; explicit rebind acknowledgement after recovery; release on Pause.
- Typed passive permission results; worker remains writer; do not claim an offscreen grant authorizes the worker.
- Coalesced, bounded 240-event permission timeline stored outside Vault, with aliased JSON export and no chat text/paths/tokens.
- Preserve queue, original enrollment dates and network cooldown on recovery. Do not consume ordinary task retries for permission errors.
- Added last access observation and Export access diagnostics to existing panel; other UI behavior unchanged.
- No new permissions/endpoints/automatic grant calls; no Downloads/OPFS buffer or source format changes.
- 24 Node suites and 2 mocked Chromium UI tests passed. Native Windows Chrome/Edge persistence remains unverified; see TEST_REPORT.md.

---

# v0.1.6.3 — Closed-panel Vault context and automatic controls

- Automatically connect/reconnect only the active ChatGPT tab with event-driven, bounded retry; keep manual Reconnect as recovery.
- Automatically load All conversations when selected, with per-workspace five-minute cache and explicit force Refresh.
- Restore the existing Vault directory name and workspace binding, present Change Vault, passively recheck permissions without triggering a prompt, and recover permission-blocked jobs when access returns.
- Keep Background Apply disabled for unchanged settings, preserve unsaved edits across status refreshes, and enable the button only for actual changes.
- Add opt-in offscreen Blob/File-System context while background sync is enabled, to avoid tying the extension-origin filesystem context to the side-panel lifetime. It cannot override browser permission prompts. Use the `offscreen` manifest permission.
- No changes to Markdown normalization, account/Memory access, the enrollment cutoff, source bytes, per-workspace indexes, or long-running manual export behavior.

---

# v0.1.6.2 — Active-chat background trigger hotfix

- Restore tab bindings from the durable workspace state after MV3 service worker termination, with authenticated account verification and support for previously active pending tabs.
- Recognize additional ChatGPT last-turn selectors; infer pending-response completion after a bounded stability interval when the Stop button is not discoverable.
- Retry a rejected watcher message at a bounded rate; never silently accept a missing worker binding as successful delivery.
- Mark accepted chat-completion events as queued and reconcile one stale conversation-list update after ~20 seconds; at most one subsequent content verification is permitted for an already archived chat.
- Preserve unchanged Markdown, including the original YAML `exported` time, during an event-forced no-op verification.
- Prevent a wake event from being lost when another background tick is already running.
- Retain the v0.1.6.1 Port-disconnect fix. No new permissions, timers before opt-in, Memory access, UI changes, or general DOM observers.

# v0.1.6.1 — Port disconnect diagnostic hotfix

- Read `chrome.runtime.lastError` synchronously in all three Port `onDisconnect` handlers: side panel, content script, and background RPC. This acknowledges asynchronous failures such as `Could not establish connection. Receiving end does not exist.` without suppressing the disconnect state.
- Side panel displays a recoverable connection-unavailable status when the ChatGPT receiver was never present or was unloaded. Background RPC retains the failure reason for pending requests.
- No API, Vault, synchronization policy, UI layout, or new permissions are changed.

Previous v0.1.6 changes remain unchanged.
