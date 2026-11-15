# Chat Archive Exporter v0.1.6.9 — Schedules and chat metadata (test build)

## Behaviour in v0.1.6.9

This is still a **technology demonstrator**, not the production UX. Keep the installed extension and its local data; update unpacked files in place and use **Reload** in `chrome://extensions` or `edge://extensions`.

**First export / Vault enrollment.** For each new ChatGPT account or workspace, the user explicitly performs an initial manual export (all chats, selected chats, or an empty Project). This creates the stable Vault path and writes a current-scope configuration snapshot automatically. The snapshot includes available account identity, all discoverable Project metadata and Source inventories, current-scope GPT labels, explicitly installed Plugins / bundled Skills, user-authored personalization, and now Schedules. Choosing only some chats does **not** authorize downloading binary Sources from other Projects. The selected chat set does not silently enroll preexisting unselected history. After a verified first export, background monitoring can be enabled separately and remains off by default. A verified indexed configuration-only seed is valid even if there are no chats yet.

**Schedules.** `_workspace_configuration.json` now has `schedules` with `status`, `complete`, `buckets` and `items`. The client requests `scheduled`, `paused`, and `finished` from `/backend-api/automations?filter=<bucket>&limit=25` and follows returned cursors (bounded). Captured settings include the full returned prompt (within a safe archival size limit), unmodified iCalendar schedule string, timezone, enable/status, timing and executor, notification preferences, and linked conversation ID. It never asks for suggested automations, execution payloads, Memory, OAuth destinations, or adjacent accounts. Failed or incomplete Schedules queries do not clear an earlier full section. API shape and access are subject to ChatGPT changes; missing sections are explicitly marked incomplete, never assumed empty.

**Continuous configuration updates.** When the user explicitly enables background monitoring after the initial export, the controller checks current-workspace configuration approximately daily and records observed changes. It does not guarantee catching a setting installed and removed between polls. A configuration with no meaningful changes is not rewritten merely to update `captured_at`. The temporary **Snapshot to Vault** diagnostic button remains in the demonstrator and is planned for Settings in the production UI; it is not required for normal archival operation.

**Chats.** `archived` (boolean) and `project_id` are written to Markdown front matter and the workspace index. A change in archive state, Project membership, or GPT name updates metadata without moving existing files. Archived chats are **not** placed in a separate physical folder, consistent with the stable Vault-path policy. Newly detected background chats with placeholder titles `New chat` / `Untitled chat` wait for a stable title; manual explicit export can still save such a chat. Existing placeholder filenames stay unchanged, while their content and index receive corrected titles. The selection panel resolves observed GPT labels through verified metadata requests for the active workspace only.

**Strict boundaries.** No account or Project Memory is requested, stored, or included in configuration. There are no sibling-workspace requests, no account switching, and no tokens or signed Source URLs in the archive. Local modifications are never silently overwritten. Vault folder names, chat file paths and original-source byte transfer retain the existing v0.1.6.8 structure.

## Acceptance checks for v0.1.6.9

1. Update the existing unpacked extension in place and **Reload**, preserving IndexedDB, chosen Vault and prior permissions. Confirm v0.1.6.9 appears in the popup.
2. On an account with Schedules, run a *selected-chat* manual Vault export and inspect `ChatGPT/<existing workspace folder>/_workspace_configuration.json`. Confirm the expected `schedules.items` (full prompt and RRULE), installed Plugins/Skills and personalization. Check that Project Sources from non-selected Projects are inventoried but **not downloaded**.
3. Change or pause a Schedule. With background monitoring explicitly enabled, use the diagnostic **Snapshot to Vault** for an immediate refresh, or allow the periodic configuration scan. Confirm a real change is recorded; a failed API request must not delete prior data.
4. Archive/unarchive a tracked chat, move it in/out of a Project, and rename it. Confirm `archived`, `project_id`, `title`, `gpt` / `gpt_name` in Markdown/index update without changing the file path. Confirm local edits remain protected.
5. Create a new chat that initially says `New chat`; check that background monitoring does not prematurely create a generic filename and that later discovery saves it under the actual title. Old `New chat` paths are not migrated.
6. Check GPT group titles in the selection list, switching only among tabs of the **same authenticated workspace**. Verify a session/workspace switch interrupts the original job without writing neighbor data.
7. Confirm unchanged background settings do not produce a new configuration write, and a first empty-Project export can seed opt-in monitoring without any chat files.

**Known constraints:** Internal ChatGPT endpoints are not a stable public API. Paging across more than 25 Schedules was simulated, not confirmed on a live account. Scheduled changes are observed at polling intervals, not recorded as a complete event history. Native installed-extension testing with authenticated ChatGPT/Chrome Downloads/File System Access remains necessary. More detailed UX/settings belong to v0.1.7; Library/Spaces/Images file inventories are postponed to v0.1.6.10.

---

## Historical release notes (v0.1.6.8 and earlier; superseded where behavior differs)

The following checklists document previous demonstrator builds. For current v0.1.6.9 functionality and acceptance steps, use the first section of this README.

# Chat Archive Exporter v0.1.6.8 — Scoped configuration snapshot (test build)

**Purpose.** This is the final technology-demonstrator iteration before the v0.1.7 UI/UX phase. This version adds an active-workspace configuration snapshot to the existing archive workflow. It does not migrate or rename any existing Vault folder or chat filename.

## Scope and privacy invariants

- Read **only the currently verified ChatGPT account/workspace**. Bind all configuration requests to the observed `account_id`; reject a switch or response containing an inconsistent `workspace_id` before committing. Never loop across accounts, use an account switcher, or call `/backend-api/accounts/check/v4-2023-04-27`.
- **Never request or archive Account Memory or Project Memory.** User-authored personalization via `/backend-api/user_system_messages` and user-authored Project instructions remain in scope; these are not Memory.
- Store an allowlisted read-only list of **explicitly installed** Plugins, distinguished by `GLOBAL` (user-scoped) and `WORKSPACE` (active workspace-scoped). Exclude built-in `INSTALLED_BY_DEFAULT` Plugins and available-but-not-installed catalog entries. Preserve plugin version, installation date, enabled status, developer and bundled Skills (names, IDs, short descriptions). Never copy full Plugin manifests, secrets, Skill source, OAuth links, remote GitHub repositories, Vercel projects or provider destinations. An installed/ENABLED plugin is **not** proof of OAuth authorization.
- Scope metadata failures become partial/error states, not empty lists; previous complete snapshots are retained where necessary. Custom GPT bootstrap is explicitly a **partial** inventory, not an owned-GPT catalog. No personal GPT data or Project data is inferred from another workspace.

## New manual action: Snapshot to Vault

From an active, verified ChatGPT tab open the side panel, choose/authorize the previously used Vault and click **Snapshot to Vault** in *Account configuration*. The autonomous manual controller accepts a durable metadata-only job. The panel may close after acceptance. The job writes the current workspace's `_workspace_configuration.json`, `_personalization.md`, Project `_project.md` and `_sources.md` inventories, and an archive report via existing guarded writers. **It does not download conversation bodies, binary Source files, custom GPT instructions or Plugin/Skill files.** Permission prompts still require a real click and a verified current workspace.

A regular full-workspace manual export may also include this configuration snapshot in its existing metadata. Existing manual partial selections are not relabeled as full inventories.

## Background configuration refresh

If background sync was **explicitly enabled** for the active workspace and the Vault writer has `granted` access, a separate durable configuration inventory is scheduled approximately every **24 hours**. Each stage uses bounded, read-only current-scope requests and the same locked Vault writer. Permission loss defers configuration requests; eligible chat captures can still use the independent v0.1.6.5 IndexedDB buffer. A closed/discarded ChatGPT tab defers requests until an authenticated tab in the same workspace is available. Failed/partial Plugin responses never silently erase a previously complete inventory. Project scans keep the root configuration index current.

## API probes / proven data

`/api/auth/session` and `/backend-api/me` for current identity; `/backend-api/gizmos/snorlax/sidebar` and scoped Project details for Projects; `/backend-api/gizmos/bootstrap` for available current-scope GPT names; `/backend-api/user_system_messages` for user-authored settings; `/backend-api/ps/plugins/installed?scope=GLOBAL|WORKSPACE` for installed Plugin inventories and bundled Skills from their release metadata. These are ChatGPT web-client endpoints, not a stable public API. Page-token pagination remains an experimental protocol and is explicitly marked partial on error or unexpected schema.

In the supplied two-account browser samples the normalizer selects 7 explicit installations containing 57 bundled Skills in the Business sample, and 1 explicit installation containing 1 bundled Skill in the single-personal-account sample. Other platform defaults are not included. These are **fixtures for testing normalization**, not data stored in or shipped with the extension.

## Native acceptance checklist

1. Replace the files in the **same unpacked extension directory** and click Reload. Do not uninstall the existing extension or clear its IndexedDB, which can contain buffered chats and pending manual jobs. Reauthorize the existing Vault if the browser asks.
2. In each account/profile separately, open its **verified ChatGPT tab**. Trigger **Snapshot to Vault**, close the side panel, reopen it and check job completion. Verify the existing root `_workspace_configuration.json` contains only the current `active_scope.account_id`, `identity`, relevant `projects`, current-scope `custom_gpts`, explicitly installed `plugins`, bundled `skills` and statuses. Check Project Sources inventory and user-authored personalization; no Memory.
3. With opt-in Background update enabled and Vault granted, verify the root configuration refresh is eventually performed (first cycle after upgrading and then daily). With Vault permission missing, the config job should not fetch endpoint data; ordinary eligible chat capture may still buffer locally.
4. Test a local edit to `_workspace_configuration.json`; it must be preserved as a conflict. Verify a failed or partial Plugin request does not convert previously complete saved entries into an empty installed list.
5. Switch to a different ChatGPT account **while a request is pending**; the old workspace job must defer/fail without querying or writing the new account. Verify no sibling account or Memory endpoints are requested.
6. Confirm the previous Vault directories, Markdown filenames, `.workspace.json`, chat updates and Sources preservation behave exactly as in v0.1.6.7.

**Verification limits:** Node and mocked Chromium UI tests have been run. This environment cannot perform a live signed-in Chrome/Edge test with real ChatGPT APIs, actual OAuth/grant behavior or native file permissions. The on-device checklist is required before considering this implementation production-ready.

---

# Chat Archive Exporter v0.1.6.7 - Test Build

## Classification and configuration snapshot

This experimental Chrome/Edge MV3 extension distinguishes Projects from custom GPT chat groups. A GPT is **not** a Project, so its identifier must not enter any Project-only chat, connector or Source API call. All conversations shows `GPT - Name`, `Project - Name`, and ungrouped conversations separately. Projects with zero conversations are selectable and exportable as metadata/Sources-only objects.

Fresh GPT exports use `ChatGPT/<Workspace>/_GPTs/<GPT name> [id suffix]/<Chat>.md`. Markdown includes the GPT container type and ID, and the durable workspace chat index stores `gpt_id` / `gpt_name`. For previously exported chats, the **existing indexed path wins**; there is no automatic folder migration or overwrite of user edits.

Each metadata snapshot creates `ChatGPT/<Workspace>/_workspace_configuration.json` with available Projects, GPTs observed in conversation listings, and **project-linked** connector scopes. Partial manual selections are explicitly marked as partial, not a complete account inventory. The Plugin and Skill inventory currently has `items: null` and an explicit **not enumerated** status: no trustworthy installed-list browser endpoint is established. This is different from zero installed Plugins or Skills. Downloading owned custom GPT, Plugin or Skill definitions/content is deferred to TODO; no account or Project Memory is collected.

## Idle and account safety

After a long interval outside the browser, a suspended/discarded ChatGPT tab or an API RPC timeout now leaves background jobs in a recoverable `waiting_for_tab` state. Jobs and captured Markdown persist. Activating a verified tab for the **same workspace** permits resumption, subject to API cooldown. A timed-out request is not evidence of lost Vault write access. Legacy queued Project tasks with non-Project gizmo identifiers are rejected locally rather than retried against invalid Project endpoints.

No additional Chrome permissions are requested by 0.1.6.7. The 0.1.6.6 rev 1 controller-owned manual exports, v0.1.6.5 offline buffer, and local-file conflict checks remain in place. Do not uninstall the extension or clear its IndexedDB while exports or captured updates are pending.

## Native test checklist

1. Replace the unpacked extension files and use Reload in chrome://extensions or edge://extensions. The manifest numeric version is `0.1.6.7`. Already-open ChatGPT tabs should reconnect without a full page reload. File System Access write permission may still need user confirmation after Reload.
2. Open All conversations. Verify that a custom GPT conversation is grouped as `GPT - <name>` rather than `Unknown project`; a Project with zero chats appears as a selectable group. Select only that Project, export to Vault, and inspect `_project.md` and `_sources.md` without an invented chat.
3. Export a GPT conversation. Check its new `_GPTs` folder, GPT YAML frontmatter, and `gpt_id` / `gpt_name` in `.workspace.json`. If that conversation was previously exported, confirm the existing path remains unchanged.
4. Examine `_workspace_configuration.json`. Verify `plugins.items = null`, `skills.items = null` and the explicit unknown/incomplete statuses. A Project connector is not asserted to be an installed Plugin.
5. Leave the browser unfocused until a timed-out request would previously occur. On reactivation, verify that background waiting/queued status recovers without repeating `Invalid project ID`; Vault access remains independent. Inspect pending and local conflict counts.
6. Check a manual ZIP or Vault export while closing/reopening side panel, and verify no duplicate delivery or overwritten local edits. Test multiple workspaces independently.

These are acceptance tests for the user's installed Chrome and Edge. The local test environment used simulated browser and ChatGPT APIs, not a live authenticated workspace or native permission/download manager.

---

# v0.1.6.6 rev 1 — Panel background-status continuity (test hotfix)

This revision changes **only the panel view**, not the background synchronization, manual job execution, enrollment rules, source handling or filesystem write path.

- Switching to an unrelated website disables the **current chat** connection but retains the status of the **last verified workspace in this browser window**. The background status continues to show `idle`/`queued`/`buffered`, the archived-chat count and Vault state rather than `Connect to a verified ChatGPT workspace first.`
- A recreated side panel restores that last verified workspace from `chrome.storage.session` and reads the actual state from the background controller. This is a **read-only status view** on a non-ChatGPT tab; Apply, Pause and settings controls require an active, verified ChatGPT workspace.
- Switching to a verified ChatGPT tab for a different workspace replaces the remembered workspace instead of mixing their statuses. No ChatGPT tab is opened, refreshed or contacted merely to display existing background state.
- `storage.session` is not a permanent cross-restart account selector: after a full extension reload or browser restart with no verified ChatGPT tab, the panel may have no last workspace until it reconnects. A multi-workspace status selector remains a separate UI item.

The numeric manifest version remains **0.1.6.6**; `version_name` distinguishes **rev 1 test** for unpacked-extension testing. Web Store publication needs a subsequent version bump.

---

# Chat Archive Exporter v0.1.6.6 - Autonomous manual exports

Experimental Chrome/Edge MV3 build based on the user's tested **v0.1.6.5**.
Background capture, local-edit protection, workspace isolation and the existing
Vault formats are retained. This iteration changes **manual job ownership**, not
the project-source formats or background enrollment rules.

## What's new

A manual export is now accepted into an IndexedDB job queue owned by the extension
controller. The side panel only submits the selection and displays its progress.
**After `Manual export accepted`, the panel or popup may close.** Reopening attaches
to the same job; it does not submit another export.

Supported destinations:

| Action | Execution and delivery |
| --- | --- |
| Current chat, Download | Controller receives the chat; offscreen creates a Markdown Blob; browser Downloads saves it |
| Selected chats, Download | Controller stages chats, project metadata and bounded binary Sources; offscreen assembles the ZIP; browser Downloads saves it |
| Current/selected chats, Vault | Controller writes through the existing protected incremental Vault writer |
| Popup `Export current chat` / in-page down-arrow MD | One quick-save command, queues a single **downloaded .md**, without opening the side panel |

Quick-save does not implicitly choose a Vault or enable automatic synchronization.
Choose Vault output in the side panel for a manual Vault job. A partial selection
in All conversations includes metadata/Sources for its represented projects;
global personalization is included only for a full-workspace selection. Current
chat mode remains chat-only. A direct current-chat save fetches the current
server version; unchanged bulk Vault chats still use the indexed preflight skip.

**New permission: `downloads`.** It delivers accepted .md/ZIP jobs after the panel
closes and observes actual browser completion. It does not grant arbitrary disk
read/write access. Existing host permissions are unchanged and remain limited to
ChatGPT domains. Browser policies/security checks can still interrupt a download.

## Accepted jobs and recovery

- One active manual job per extension profile, with a fixed workspace, selected
  conversation IDs and (for Vault output) a per-job directory binding. Changing
  the selected browser tab or another directory selector cannot retarget the job.
- Selections, phase, per-item progress, cancellation and staged bytes persist in
  **`cae-manual-exports-v1` IndexedDB**. This is separate from the 0.1.6.5 capture
  buffer. Neither job cancellation nor cleanup deletes buffered background edits.
- Item checkpoints permit restart after MV3 worker suspension or extension reload.
  A chat already captured for an interrupted Vault write can be delivered from
  staging; an existing identical file can repair its interrupted index commit.
  A newer indexed Vault revision is never replaced by an older staged revision.
- Background and manual writers share the same Web Lock. Transfers are sequential.
  The controller yields between short batches. No keepalive heartbeat, broad DOM
  observer, fetch hook, hidden background page, or new perpetual list poll is added.
- A live authenticated ChatGPT tab in the original workspace is required while
  remote content is still needed. Missing/discarded tabs or an account switch
  produce a waiting state. Completed local delivery need not contact ChatGPT.
- Vault permission loss pauses the manual job. Already staged text is retained;
  other manual items wait. The independently opted-in background capture continues
  using its existing mirror/buffer when eligible. Permission can be restored from
  a real user action in the panel; the extension cannot synthesize that permission.
- API cooldown preserves the job and honors the delay, including a shared pause
  for automatic requests. An ordinary tab activation does not clear the cooldown.
- A source interrupted by a worker/browser termination restarts from its beginning;
  byte-range resume is not implemented. Worst-case transfer reservations persist,
  so repeated interruptions can exhaust an operation budget conservatively.

### Download completion and duplicate safety

Prepared is not the same as downloaded. Staged payloads remain until the browser
reports `complete`. An interrupted download shows **Retry delivery / step** and
reuses the already staged bytes, without receiving all chats again.

The job records its delivery intent and extension-owned Blob URL before calling
`chrome.downloads.download`. On restart it reconciles that attempt with browser
download history. If the result cannot be determined, it shows
`delivery_uncertain` and does **not** blindly start another download. Check browser
Downloads, then explicitly retry or stop. This is not a claim of transactional
exactly-once delivery across every browser crash or cleared download history.

Stop preserves completed Vault files. For a ZIP job still collecting files, Stop
packages the already prepared subset with a partial-export report, without further
provider requests. If download delivery already started, Stop cancels that browser
download instead. Stopping an uncertain delivery does not create another file.

## Bounds and safety

| Resource | Limit |
| --- | ---: |
| Concurrent manual jobs | 1 per extension profile |
| Selected chats per manual job | 10,000 |
| Individual staged chat Markdown | 12 MiB |
| Total manual staged payload / uncompressed test ZIP | 128 MiB |
| ZIP Source file / aggregate source transfer | 25 MiB / 100 MiB |
| Vault Source file / aggregate source transfer | 512 MiB / 1 GiB |
| Terminal job summaries | 8 |
| Diagnostic lines per manual job | 100 |

64 KiB of the manual staging budget is reserved for a cancellation report.
The ZIP is still a bounded Blob, not a streaming archive writer. Its 128 MiB bound
is **not** a total Chrome process-memory guarantee. Vault Sources stream in bounded
chunks without collecting the complete file in JavaScript. One immutable staged
chat is retained until its file and index are committed, then it is removed.

Original Sources remain exact bytes with their original extensions. No conversion,
MIME sniffing or Saved response citation rewriting is introduced. Unknown Sources
remain eligible by ID; remote-changed existing Sources are reported, not silently
overwritten. Local Markdown edits and metadata edits are preserved as conflicts.
No account or project Memory is extracted. Tokens and signed download URLs remain
in the verified content-script transport, not in durable jobs or UI messages.

## Existing automatic background behavior

Automatic sync remains **disabled by default**, enabled separately per workspace
only after a verified initial Vault export. Archived-only and archived-plus-new
policies retain the original creation cutoff. Manual explicitly selected exports
are separate from those automatic eligibility rules.

The 0.1.6.5 mirror and latest-complete Markdown buffer remain unchanged: 12 MiB/chat,
64 MiB/workspace and 250 captures/workspace. When Vault access is unavailable,
eligible automatic updates can buffer; when access returns they drain with local
hash checks. Sources do not enter this background text buffer. Existing disk
`.workspace.json`, `.sync.json` and `ChatGPT/.chat-archive/index.json` remain compatible.
The new manual queue does not require reinitializing them.

## Upgrade and first test

1. Finish or safely retain pending work. Replace files **in the same installed
   extension directory**; press Reload in Chrome/Edge Extensions and confirm
   **0.1.6.6** and the new downloads permission. Do not uninstall or clear storage.
2. Existing ChatGPT tabs should reconnect through the existing bootstrap mechanism.
   Restore Vault permission if the browser requires it after reload. Use the same
   Vault; no indexes should be deleted or recreated.
3. With automatic sync paused (to isolate this feature), choose All conversations,
   select several chats from one small project, choose Vault output and export.
   After the acceptance message, close the panel. Verify files/indexes are written.
4. Reopen the panel: it should show the original job's progress/result. Repeat with
   ZIP output, closing the panel after acceptance; the ZIP should arrive through
   browser Downloads. Check Sources and `_archive_report.md`.
5. Test extension Reload during a multi-chat operation. Completed items should not
   be fetched repeatedly. A permission or tab wait is legitimate; a lost selection
   or silently completed incomplete job is not. An interrupted source may restart.
6. Test a local Markdown edit, missing ChatGPT tab, lost write grant, cooldown,
   cancellation and Retry delivery separately. Never test destructive edits on the
   only copy of an important file.

Do not operate two independent installed copies/profiles against one Vault at the
same time; the Web Lock coordinates only this extension instance/profile. Chrome
must be running to execute tasks. Uninstalling/clearing extension storage can erase
accepted manual jobs and pending background captures. Manual conflicts are reported
and the local file kept; a reconciliation/diff UI remains deferred.

## Validation boundary

Local regression tests and mocked Chromium UI tests are described in TEST_REPORT.md.
The container's managed Chromium blocks real extension/local-origin integration;
**this build has not been tested against an authenticated ChatGPT account with
native Windows Chrome/Edge file permissions or the real download manager.**
The included browser-manual.html harness is for an unrestricted test browser; it
uses real browser IndexedDB/OPFS but mocked provider/extension APIs.
