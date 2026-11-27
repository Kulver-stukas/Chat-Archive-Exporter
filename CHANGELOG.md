## v0.2.0 rev.2 — Architecture preview / rev.6–8 integration (2026-11-27)

- Port the cumulative v0.1.9 rev.6, rev.7 and rev.8 fixes while retaining the rev.1 provider contracts, registry, ChatGPT descriptor and RPC facade.
- Resolve existing Vault workspaces by verified immutable account ID; restore portable monitoring/export preferences and reconnect the original directory without resetting active monitoring or accepted jobs.
- Bound and coalesce permission probes, improve diagnostics and download verification, preserve worker recovery and explicit permission requests.
- Serialize cooperative writers across browser instances sharing a local Vault; preserve newer chat revisions and reject stale Library inventory commits. Stale writer claims require safe manual cleanup.
- No new provider, permission, Vault migration or deeper architecture refactor in this revision.

## v0.2.0 rev.1 — Architecture preview (2026-11-26)

- Establish provider contracts, registry, and centralized ChatGPT host/session/route rules; keep user-visible behavior and archive schemas unchanged.
- Route legacy consumers through the registered provider and content RPC facade. Add baseline parity fixtures and architecture checks.
- Retain only ChatGPT; no new permissions, providers or UX features.

## v0.1.9 Beta 2 (2026-11-26)

- Promote tested rev.5 (including rev.4 navigation, loading and layout improvements) to the public beta release.
- Add privacy disclosures, distribution notes and a separate Chrome Web Store package builder. No changes to archival logic or permission scope.
- Label the manifest as BETA; numerical version remains 0.1.9 for the first store submission.

## v0.1.9 rev.5 — Monitor and compact controls

- Remove minimized widget and quick export/refresh controls; retain optional logs, move Settings navigation to Side Panel.
- Add native button tooltips and reduce repetitive explanatory paragraphs; retain operational status, diagnostics and essential prerequisites.
- Add Files shortcut in the current-chat selector, respecting file-category filters.
- Preserve rev.4 navigation, full-height layout and all archival core files.

## v0.1.9 rev.4 — Message selector navigation and layout

- Show indeterminate progress while loading the conversation.
- Debounced refresh of open message selector after verified same-workspace navigation; discard stale replies and preserve workspace boundaries.
- Use remaining panel height for the list and retain accessible export actions.

## v0.1.9 rev.3 (2026-11-25) — Image originals and selector polish

- Recover original references from visible active-branch image-generation outputs, including legacy image file IDs; do not export internal tool text. Preserve the legacy full Vault renderer. Recognized images take part in the ZIP selection, with original bytes and explicit download outcomes.
- Disable the redundant upper action while choosing messages, keep the split menu available, and hide the complete Vault action in that mode. Show the predicted ZIP/MD format when known. Move explanatory paragraphs to tooltips and accessible descriptions.
- Defer individual attachment checkboxes to the UI/UX backlog. All 71 Node tests and focused Chromium selector checks pass. Live authenticated image download is pending user acceptance testing. No new permissions or Vault format migration.

## v0.1.9 rev.2 (2026-11-25) — Compact message selector

- Keep collapsed question/answer rows on one line with ellipsis. Indent answer checkboxes and disclosure controls by 15 px instead of repeating role labels.
- Use the actual normalized user/assistant text as the preview regardless of export-category settings. Do not display Thinking as response text; textless responses show file names or an explicit no-text label.
- Move Thinking availability, eligible file counts and exclusion metadata into expanded details. The expansion retains the full question/response preview and file names.
- Preserve grouping, selection IDs, category eligibility and all export/Vault/job semantics. No new permissions.
- All 70 Node regression suites pass. Focused Chromium rendering/interaction checks pass with 200 rows at 320 px (light) and 400 px (dark). The existing multi-surface browser scenario is blocked by navigation policy in this environment; authorized Chrome/Edge UAT remains required.

## v0.1.9 rev.1 (2026-11-25) — Selective conversation export

- Add a Download MD split button in popup and panel, shared content-category preferences, and an independent Complete conversation switch. All categories and the complete conversation are selected by default.
- Add a side-panel message selector with logical answer grouping, available Thinking, individual checkboxes, bulk All/Questions/Answers/None/Invert, counts and expandable text.
- Export selected uploaded/generated originals, including file-ID and scoped sandbox references, in a ZIP with Markdown and an explicit per-file report. Plain text-only exports remain .md. Preserve original bytes and safe filenames.
- Freeze accepted choices in durable jobs; verify snapshot/output/original checksums, recover completed file staging without repeat transfers, preserve cancellation and delivery semantics.
- Bind selections to workspace/conversation/branch/tab, recheck context before acceptance, preserve upload provenance across assistant references, and reject stale or empty selections.
- Serialize preference patches with persisted revisions so independent extension pages do not overwrite each other or regress to stale storage events.
- Remove the legacy page export button. Full Vault/batch/background archival behavior and browser permission scope remain unchanged.
- Add eight Node suites (70 total passing), a new browser UI suite pending an available browser, updated UAT and an actionable UI/UX TODO. Native authenticated Chrome/Edge UAT has not been executed in this session.

## v0.1.8 rev.1 (2026-11-22) — Project Sources and Vault integrity

- Project Source membership is now contextual evidence, **not** evidence that an original is already in the Vault. A Library original can be selected unless a matching archived Source file is verified by on-disk size and SHA-256. Modified copies produce conflicts without overwrite.
- Files linked to Project Sources but absent from Library/Images remain **Source-only reference** records, never invented downloadable Library files. Correlate `conversation_id`/`message_id` when supplied; unknown message authors and absent UI URLs remain explicit unknowns.
- Source filenames blocked by File System Access/Chromium are mapped to deterministic inert on-disk aliases; preserve `original_filename`, `stored_filename`, file ID and SHA-256 in the index. Browser `Name is not allowed` retries once with an alias; repeat failures produce a concrete error, not an infinite task retry.
- Add a pending Source index receipt and staged hash checkpoint; after interrupted writes, reuse verified bytes only when the complete size and SHA-256 match, without redownloading or overwriting conflicts. Guard source paths by the active workspace.
- Incremental Library polling now writes newly discovered Project Source placements and Source-only promotions to the Vault even when no new Library file was created; unchanged polling does not rewrite the snapshot.
- Existing v0.1.7 UX/UI and manual browser Save cancellation behavior are preserved. Chrome permissions and host permissions unchanged. Real Chrome/Edge permission UAT remains required.
- Selective per-Prompt/Thinking/Response export moved to P2, no implementation in this revision.

## v0.1.7 rev.5 (2026-11-19) - Browser Save cancellation semantics

- User-canceled native browser Save dialogs for one chat (Markdown) or selected chats (ZIP) now finish as `completed_not_saved`, with `deliveryOutcome=user_cancelled_save`. No completed file is claimed, and staging is released.
- Distinguish this from extension Stop (`cancelled`), successful browser delivery (`completed`), and external interruption (`download_failed`, retained for deliberate retry).
- Migrate old pending `download_failed` jobs whose latest error is `USER_CANCELED` when the extension worker starts.
- Manual Vault export and its permission/recovery behavior are unchanged. One explicitly requested narrow maintenance change to `lib/manual-jobs.js` is exempt from the v0.1.6.11 core freeze; all other archive modules remain frozen.

## v0.1.7 rev.4 (2026-11-19)

- UI: allow saved and live Chat lists even when a manual download is retained after the user cancels Save.
- UI: keep chat-list refresh enabled during retained delivery; no change to job processing or Vault.

## v0.1.7 rev.3 — UX/UI recovery and cached Chats
- The optional widget now re-verifies its workspace automatically when MV3 worker bindings expire or are lost, and refreshes visible monitor state every 45 seconds without starting scans or exports.
- Short/long widget uses a more compact layout; each log can scroll independently and the outer widget does not scroll in a standard 720px viewport.
- Chats shows the last workspace-scoped UI metadata cache immediately, optionally hydrating from existing read-only Vault `.workspace.json` or verified background mirror; the provider chat list refreshes afterward without blocking selection. On failure the saved list stays visible and is marked stale.
- Selection survives list refresh by chat ID; workspace switches still discard old in-memory rows/selections. No Vault migration, new permissions, or frozen core changes.
- Project Source rows no longer imply that the original is already archived: the UI explicitly distinguishes Source management from verified Vault contents.

## v0.1.7 rev.2 — UX/UI correction build
- Native toolbar badges REC / IDLE / WARN; canceled user Save is neutral.
- Side Panel Settings / Tools are local views; explicit settings tab is reused.
- Legacy in-page ↓ MD button permanently hidden even with widget disabled.
- Vault UI distinguishes per-document permission confirmation from background writer access.
- Short/long monitoring widget, three log views, explicit widget toggle and persistent-setting synchronization.
- Frozen v0.1.6.11 archive core; no new permissions.

# v0.1.7 rev.1

- Popup-first operational UI with separate settings and service tools.
- Shared checkbox lists with filters, scope-safe selection and explicit archive acceptance.
- Optional in-page monitor and floppy status icons.
- Core freeze verified by SHA-256; no extra host/Chrome permissions or Vault migration.

## v0.1.6.11 rev.1 - 2026-11-16 (test build)

- Remove implicit full Library rescans on section entry, reconnect, tab activation and cache expiry; explicit Start and durable Stop/pause instead.
- Add worker-owned, checkpointed Library jobs with per-workspace IDB state, Vault binding, alarm recovery, rate-limit persistence and independent panel navigation.
- Commit the initial inventory to `_Library/_inventory.json`; preserve its baseline and optionally monitor only new post-baseline file IDs. Reuse known descriptor metadata; no automatic retries of older unknowns or descriptor backfill.
- Exclude verified Project Sources from enrichment/Library original archival while keeping their references; do not infer Source membership from names, folder names or `use_case:gizmo`.
- Add selection checkboxes and explicit streamed original archival, grouping by origin and Images/Files, deterministic ID-suffixed paths, per-file reports, SHA-256 verification and local-edit protection.
- Recover a completed original from a staged checksum receipt if its index commit was interrupted. Do not retry HTTP 415 automatically. Respect API cooldowns and 512 MiB/file, 1 GiB/run caps.
- No new permissions; no native Page/Space content, Memory, external provider content, remote mutations or automatic original downloads.
- Tests: 52 Node.js suites and six Chromium UI smoke suites passed. Two local-HTTP browser suites and the installed-MV3 end-to-end attempt were blocked/unavailable in the managed test browser; live authorized Chrome UAT remains required.

---

## v0.1.6.10 rev.2 — File provenance vs. placements (test build, 2026-11-16)

- Model one Library/Images physical file by `file_id`, with separate, potentially many-to-many `placements`: Library directory, verified Project Source, observed conversation/message reference and generated Images gallery. Do **not** invent a direct UI URL or a message role. An unresolved UI URL is `null` with `url_status: not_observed`.
- Correlate Project Source file references from verified current-workspace Project detail APIs by exact `file_id` or `library_file_id`; never by folder or filename. Unmatched source references remain in `unmatched_project_refs` instead of becoming fictitious Library originals.
- A file's origin (Uploaded / Generated / Unknown) is not its placement. A `gizmo` Project Source, `codex` pipeline, or `upload_source:user` transport field does not prove content authorship. `caas` is tentatively generated/inferred. Keep conflicts and unknowns explicit.
- Separate `status` (Library + Images enumeration) from `classification_status` (descriptor availability) and `links_status` (Project Source resolution), with independent diagnostics.
- Increase descriptor safety limit to 1,200 and check two descriptors concurrently; retain account verification for every backend request, cooldown handling, and foreground cancellation. Normalize Unix gallery timestamps to ISO 8601.
- Add a File context filter (Library, Project Sources, Conversation references, Gallery); existing six origin/media groups remain. The feature is still **read-only**: no original downloads, Vault writes, Pages, Memory, or automatic background Library jobs.
- Exact prompt-vs-assistant-output role and Work-specific sandbox attachment classification require message/workflow evidence not provided by Library nodes. No assertion is made about a future Chat/Work UI merge.
- Rev.1 was authenticated on three test account contexts. Rev.2 has local simulated tests only and requires an authenticated recheck, especially the new Project detail join and throughput.

## v0.1.6.10 rev.1 — Read-only Library and Images catalog (2026-11-16)

- New **Library / Images** side-panel mode: on-demand read-only metadata list, with search and six origin/media groups (Uploaded, Generated, Unknown × Images, Other files). It does not request or save original file content.
- Enumerate Library nodes and the separate generated Images gallery in the **verified current workspace only**. Cursor paging, guarded recursive folder scans, gallery `s_...` vs physical `file_...` distinction, deduplication by physical file ID, and completeness/warning reporting.
- Enrich eligible Library files via `GET /backend-api/files/{file_id}` (bounded, with rate-limit handling); classify using explicit `use_case` or verified gallery membership. Unknown/conflicting signals remain visible rather than being silently forced into Uploaded/Generated.
- Manual **Catalog JSON** export contains only allowlisted metadata and diagnostic status; no signed URLs, auth credentials, original bytes, Memory, Pages or external source data. The feature is foreground-only; disconnect cancels the scan. No new permissions or changes to existing Vault data.
- Added tests for provenance, nested directories, gallery-only images, conflicting evidence, ID and signed-URL safety, workspace switching, and Chromium panel behavior.
- Live authenticated tests of directory recursion and per-file metadata throughput remain pending; this is a testing revision, not a public stable release.

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
