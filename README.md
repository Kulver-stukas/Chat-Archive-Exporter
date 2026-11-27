# Chat Archive Exporter

[![Install from Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-4285F4)](https://chromewebstore.google.com/detail/chat-archive-exporter-bet/jpnelmkbbgpjfnpldfecjffhidffdpjb)

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/chat-archive-exporter-bet/jpnelmkbbgpjfnpldfecjffhidffdpjb)** · [GitHub releases](https://github.com/Kulver-stukas/Chat-Archive-Exporter/releases) · [Privacy policy](PRIVACY.md)

## Current published v0.1 release: v0.1.9.8 (rev.8)

This branch contains the v0.1.9.9 writer-recovery beta candidate (issue #6), pending UAT. For leftover claims, use Tools → Diagnostics → Review writer claims; confirm all other writers have stopped before Clear reviewed locks. See `UAT_v0.1.9.9.md`. No automatic foreign-claim takeover by age. Future storage separation: issue #7 and `TODO_v0.1.9.md`.

Chat Archive Exporter is an independent, local archiving extension for ChatGPT, with user-initiated Markdown and ZIP downloads, selective conversation exports, workspace-scoped Vault archives, Library and image inventory and original-file exports where available, and optional background maintenance. No external developer-operated backend or telemetry.

The completed v0.1 feature line is maintained on the `v0.1` branch. Version 0.2 is a separate architecture/refactoring line and is not part of this release. ChatGPT is the only supported provider in v0.1.

### Installation and updates

- **Chrome Web Store:** use the official listing above for ordinary installation and updates. The version offered by the store can lag behind GitHub while an update is under review.
- **GitHub:** use the [v0.1.9.8 release](https://github.com/Kulver-stukas/Chat-Archive-Exporter/releases/tag/v0.1.9.8) for the unpacked-install ZIP and the matching source ZIP. The separately named `-webstore.zip` is the submission package, with the manifest at the archive root; it is not a second installation to run beside the store copy.
- For an existing unpacked installation, replace files in its existing directory, reload the extension and refresh ChatGPT. Preserve extension storage and Vault. Store and unpacked installations may have different extension identities and local state.

Every new version published in the Chrome Web Store should have its own GitHub release, linked to the exact source commit and numerical manifest version used for the store build. GitHub publication of a beta candidate does not assert that the store has approved or distributed it. See [release procedure](RELEASING.md).

### What changed since Beta 2 (rev.5)

- More reliable workspace reconnection, including Settings in an ordinary browser tab.
- Existing archive detection by verified account ID, with original workspace paths retained.
- Portable workspace preferences, with explicit **Apply restored settings** before monitoring starts in a new browser profile.
- Reconnect the same Vault after permission errors without resetting monitoring settings or accepted jobs; bounded access checks and clearer diagnostics.
- Verified diagnostic downloads and a Copy diagnostics fallback.
- Cooperative shared-local-Vault writer protection and safeguards against stale chat versions and Library inventory commits.

No new browser permissions or archive format migration. The runtime is the tested rev.8 build (manifest version `0.1.9.8`, with its original revision label retained).

### Limits and support

Rev.8 passed 74 Node regression suites and has been tried by the maintainer in real browser use without reported problems. That does not establish exhaustive native-browser coverage. The shared-Vault guard is cooperative, requires all writers to participate, and assumes a coherent local filesystem. It is not an OS mutex or a distributed/cloud synchronization protocol. Do not run older builds as simultaneous writers against the same Vault. After an abnormal termination a stale writer claim may require manual recovery; stop all Vault writers before removing stale claims. See [rev.8 acceptance checks](UAT_v0.1.9-rev8.md) and [release notes](release-notes/v0.1.9.8.md).

The extension is not affiliated with or endorsed by OpenAI. It uses the signed-in ChatGPT web session and undocumented, changeable endpoints. Use only where authorized by applicable service terms and workspace policies; the official account data export is an alternative. Some conversations, original files and native Space objects may be unavailable. Account/project Memory is outside the archive scope. See [known limitations and future work](TODO_v0.1.9.md).

## Historical release documentation

The following sections describe earlier revisions. Their instructions and status statements are superseded where applicable by the current release information above.

---

# Chat Archive Exporter v0.1.9 rev.5 — Monitor and compact controls

The widget now opens directly as a monitor; there is no minimized icon or Refresh/Download action. Short status and expanded logs remain. Chats, Files and Settings open the corresponding Side Panel view. Tooltips replace redundant explanatory paragraphs across Popup, Side Panel and persistent settings. The Select messages shortcut **Files** selects eligible message rows containing enabled uploaded/generated file references; it does not toggle export categories or select individual attachments. See RELEASE_NOTES_v0.1.9-rev5.md and TEST_REPORT_v0.1.9-rev5.md.

# Chat Archive Exporter v0.1.9 rev.4 — Message selector navigation and layout

Minor UI revision of Beta 1: indeterminate loading progress, same-workspace automatic selector refresh after navigation, and a full-height message list. See RELEASE_NOTES_v0.1.9-rev4.md and TEST_REPORT_v0.1.9-rev4.md. The API, export engine and Vault are unchanged.

# Chat Archive Exporter v0.1.9 rev.3 — Image originals and selector polish

Selective conversation export now recognizes original-file references in visible image-generation tool outputs on the active branch. Recognized image-only responses show filenames in the selector and participate in the ZIP export. Original availability is reported explicitly; legacy full Vault archives retain their scope.

When the selector is open, the upper download action is inactive, its category menu remains usable, and the complete Save to Vault action is hidden. The lower download action shows the expected ZIP or Markdown format. Explanatory paragraphs are replaced with tooltips and accessible descriptions. Selection is still message-level; individual file checkboxes remain a TODO.

**Upgrade:** replace the files in the existing unpacked extension directory, reload, and refresh ChatGPT. No new permissions or Vault migration. Numeric manifest version is 0.1.9; version_name identifies rev.3. See RELEASE_NOTES_v0.1.9-rev3.md and TEST_REPORT_v0.1.9-rev3.md (71 automated tests passed; live authenticated image retrieval pending).

# Chat Archive Exporter v0.1.9 rev.2 — Compact message selector

This UI revision retains the v0.1.9 rev.1 selective-export behavior. Collapsed question and answer rows are single-line, with answers indented. Expanded previews display actual questions/responses, never Thinking in place of an answer. Thinking and file eligibility still follow the saved export settings. See RELEASE_NOTES_v0.1.9-rev2.md and TEST_REPORT_v0.1.9-rev2.md.

**Upgrade:** replace files in the same unpacked extension directory, click Reload, and refresh ChatGPT. Do not clear extension storage or the Vault. The Chrome manifest version remains 0.1.9; version_name identifies rev.2.

# Chat Archive Exporter v0.1.9 rev.1 — Selective export test build

Based on v0.1.8 rev.1. **Download MD** now has a split-button menu: All / Question / Answers / Thinking, then Uploaded files / Generated files. All and Complete conversation are enabled by default.

With **Complete conversation** enabled, the main button downloads the current conversation using the chosen content categories. Turn it off to choose individual questions and logical answers in the existing side panel. Available Thinking and original files can be selected independently of message text. Preferences are shared by all extension instances in the browser profile and survive restart; message selections remain bound to their exact conversation and branch.

Text-only exports produce Markdown. Included original-file references produce a ZIP containing Markdown, received originals under attachments/Uploaded or attachments/Generated, and export-report.json. Files belonging to unselected messages are not requested. Unavailable/expired files and limits are reported explicitly. Limits: 25 MiB per original, 100 MiB received originals per job, 128 MiB staging, 12 MiB conversation snapshot/Markdown.

Save to Vault, batch archives and background capture retain the complete archive format and existing paths. No additional Chrome permissions. No new export button is added to the ChatGPT page.

**Upgrade:** replace files in the same unpacked extension directory, click Reload on the browser extensions page, and reload ChatGPT. Preserve extension storage and the existing Vault.

**Verification:** 70/70 Node suites pass, including byte-checked ZIP output and durable selected-export recovery. UI resources and syntax were checked. The new real-browser UI suite is included but could not run because this environment has no working local Chromium. Authenticated Chrome/Edge testing is still required for the new feature.

See RELEASE_NOTES_v0.1.9-rev1.md, TEST_REPORT_v0.1.9-rev1.md and UAT_v0.1.9-rev1.md. Fine export controls considered from the supplied Exporter v6.13.2 reference are recorded in TODO_v0.1.9.md. This is a test build; no GitHub release was published for this revision.

## Earlier documentation

The material below records earlier versions. The selective-export behavior above supersedes earlier statements that individual content selection is unavailable. The v0.1.8 verified-copy policy supersedes unconditional Project Source exclusion.

---

# Chat Archive Exporter v0.1.8 rev.1 — Technical test build

This release continues from the published **v0.1.7 Beta 1 UX/UI**. It fixes Project Sources/Library deduplication using SHA-256-verified Vault originals, aliases filenames rejected by Chromium while recording the exact original name, and preserves Project Sources missing from Library together with evidence-backed chat/message references. The existing Popup, Side Panel, widget, chat export and Vault layout are retained.

**Upgrade:** replace files in the same unpacked extension directory, click **Reload** at `chrome://extensions`, and reload the ChatGPT tab. Do not uninstall, clear IndexedDB or reselect the Vault when permission is still granted.

**Verification:** 62 JavaScript test suites and the UI smoke tests pass with mocked APIs/permissions. Real authenticated Chrome and Edge UAT is still required; see `UAT_v0.1.8-rev1.md` and `TEST_REPORT_v0.1.8-rev1.md`. No new Chrome permissions. Selective Prompt/Thinking/Response export is deferred to P2 and is not enabled.

The text below documents earlier releases; any claims of unconditional Project Source exclusion are superseded by v0.1.8's verified-copy policy.

---

# v0.1.7 rev.4 - UX/UI test build

Popup-first Export / Activity / Settings, separate Tools, on-demand selection panel and optional monitoring widget. Archive core remains v0.1.6.11 rev.1. See `RELEASE_NOTES_v0.1.7-rev3.md` and `TEST_REPORT_v0.1.7-rev3.md` for installation, UI behavior and validation limits.

The v0.1.7 rev.4 Side Panel shows a saved chat list from a workspace-scoped UI cache or (when readable) from Vault `.workspace.json` / the background mirror, then refreshes through the normal ChatGPT API. The panel does not write chat-list metadata back into Vault; current chat export and Vault writing are unchanged.

The following retained v0.1.6.11 documentation describes the unchanged technical capabilities. Its older panel screenshots/instructions are superseded by the v0.1.7 UI notes.

---

# Chat Archive Exporter v0.1.6.11 rev.1 - Library jobs and selected originals (test build)

## Manual start, not automatic full rescans

- Opening Library / Images, focusing another browser tab, reconnecting the panel, or letting a cache expire no longer starts Library collection.
- **Start inventory** is the only initial collection trigger. The resulting list is committed to the selected Vault. **Stop / pause** cancels the current Library task and disables its metadata monitoring; previous committed data is preserved.
- Library jobs no longer hold the panel's global busy lock. Sections may be switched and the panel may be closed after acceptance.

## Persisted baseline and incremental metadata

- The snapshot is `ChatGPT/<workspace>/_Library/_inventory.json` (schema `cae.library-vault.v1`, catalog schema `cae.library-inventory.v3`).
- The first successful manual snapshot establishes an immutable enrollment cutoff. Optional monitoring starts only after that commit. The initial-run checkbox is visible and checked; clear it for one-shot collection.
- Background checks run on a five-minute cadence while the browser has an authenticated tab in the original workspace and Vault write permission. They enumerate inexpensive list/reference pages; only unseen file IDs with a server creation timestamp after the cutoff qualify for additional metadata. Known file descriptors are not re-requested. Undated or older newly discovered IDs require a manual inventory.
- Membership in Project Sources is resolved using actual file/library IDs and existing Vault source records, not names or folder names. These files remain visible as references but are excluded from descriptor enrichment and this Library original-download operation. Project/reference list queries still occur to identify new memberships.
- Checkpoints, work queues, cooldowns and the selected Vault handle survive worker restart. Missing permission, scope changes or rate limits pause the job. No automatic deletion, backfill of older unknown files, or overwrite of local changes.

## Selected original files (experimental)

- Eligible rows have selection checkboxes. **Select eligible visible files** respects the current filter; **Archive selected to Vault** freezes the explicit selection.
- Eligibility means an original can be requested, not that the server will deliver it. Native Pages/Sites, external mounted content, known Project Sources and files above the byte cap are excluded.
- Originals are grouped under `_Library/Uploaded|Generated|Unknown/Images|Files/`. A file-ID suffix prevents name collisions. Repeated references to the same file ID do not create extra copies.
- Original URL resolution and authenticated transfer remain inside the isolated ChatGPT content script. Signed URLs, auth headers, response bodies and original bytes are never stored in the job metadata/catalog.
- Streamed originals are checked against known sizes and SHA-256, then read back and verified on disk. Existing indexed originals are hashed before reuse; local edits are preserved. A staged checksum receipt supports recovery after a completed write and an interrupted index update.
- Per-file failures, including HTTP 415, remain in `_Library/_download_report.json` without repeatedly retrying that file. Other selected files continue. HTTP 429/authentication problems pause the task instead.
- Safety limits: 512 MiB per original, 1 GiB received per archival run, bounded transfer runtime. Remaining over-budget files are marked deferred and require another explicit selection/run. Original download is never automatic.

## Installation and verification

Extract the install ZIP and replace files in the **same existing unpacked extension directory**; click Reload in `chrome://extensions`. Do not uninstall or clear extension storage. Reopen the panel in the intended workspace. A normal ChatGPT conversation page is sufficient; the website's Library/Space page is not required.

No new Chrome permissions or host permissions. Existing chat export and Project Sources controllers are retained. This is a test build; it has not been published to GitHub or tested against an authenticated live ChatGPT backend in this environment. See `TEST_REPORT_v0.1.6.11-rev1.md` for the actual executed tests and blocked checks.

## First test run

1. Choose **Library / Images**, verify the workspace, and choose the existing Vault or restore its write access.
2. Leave **After saving, monitor new file metadata** checked to enroll new files after the first snapshot. Clear it to test a single manual run without monitoring.
3. Click **Start inventory** once. Switch to **Current chat** or **All conversations**, then reopen Library: there must be no new full scan caused by navigation.
4. After completion, check `_Library/_inventory.json` and its `baseline_at`, source exclusions and descriptor counts. Reopening the panel reads the local saved job/catalog, not hundreds of descriptors.
5. Create a new file in the same workspace after the baseline. On a later scheduled check it should appear without re-enriching old files. Missing dates are not treated as newness.
6. Select a small ordinary file and a generated image, then choose **Archive selected to Vault**. Inspect the originals, per-file statuses and `_download_report.json`. A `.js` that returns HTTP 415 must remain a reported failure, not an empty successful file.
7. Stop/pause monitoring. Wait or switch browser tabs: no new Library job should start. Chat background sync is a separate setting and is not disabled by the Library Stop button.

## Deliberate limitations

The listing API has no verified delta cursor, so background discovery still scans paginated list metadata; it is not a server push subscription. Only additional per-file descriptor calls are restricted to new items. Files deleted or changed remotely are not removed/overwritten by this incremental mode. Sources not present in Library remain separate unresolved reference records. Files with different IDs are not deduplicated by filename or assumed equal content. Origin describes the evidence available from this service, not a verified author identity. A Work sandbox, native Pages, Sites, Memory and external connector originals are outside this feature.

---

## Historical documentation (earlier versions; superseded by the sections above)

# Chat Archive Exporter v0.1.6.10 rev.2 — Library file references (test build)

This revision keeps the **metadata-only** Library/Images scan. A physical file is enumerated once by `file_id` even if present in Library, Images and multiple Project Sources. The catalog separately retains **origin** (`uploaded`, `generated`, `unknown`) and **placements** (Library directory, Project Source, conversation/message reference, Images gallery). Project Sources are placements, **not** evidence of user-uploaded authorship. A message reference does **not** establish whether the file came from the user prompt, assistant answer, or Work. There are no guessed per-file UI URLs: unobserved ones remain `null`.

## Install and test

1. Replace files in the **same unpacked extension directory** used for v0.1.6.10 rev.1; click Reload in `chrome://extensions`. Do not uninstall or clear extension storage/IndexedDB; this preserves existing Vault settings and accepted background/manual jobs. The unpacked extension must show `0.1.6.10 rev.2`.
2. Open any normal ChatGPT conversation in the **intended verified workspace**. Opening `/library` or `/space` is **not necessary**. In the side panel choose **Library / Images**, then Refresh if a previous scan is cached.
3. Inspect the group labels (Uploaded/Generated/Unknown × Images/Other files) and the new **File context** filter (Project Sources, Conversation references, Library, Images). `Project Source: <name>` is shown only when the Project detail API supplies a matching `file_id` or `library_file_id`, not merely because the file is in a folder with a matching name.
4. Export **Catalog JSON**, then inspect `status`, `classification_status`, `links_status`, `collections`, `items[].placements`, `summary.by_context` and `unmatched_project_refs`. Status `complete` now certifies **Library + Images enumeration only**. Descriptor or Project reference failures are separate statuses, and no incomplete resolution is represented as a full empty set.
5. Compare results on Z_Cat Free, Alexblow Free and Business. Check a file known to be a Project Source in `Logos`, an image present only in Images, and a Work Output document. Roles of messages and Work links remain unknown pending dedicated observation.

## Collection and privacy boundaries

Current-scope endpoints: Library nodes (cursor and folder traversal), generated Images gallery, file descriptors, Projects sidebar and individual Project details. Only allowlisted IDs, names, types and reference metadata enter the catalog. The extension does not save Project instructions or full Project responses, file bytes, signed URLs, auth tokens, Memory, Pages, automations or contents of unrelated accounts. Unmatched Project Source references are recorded separately without inventing a Library file.

The foreground scan stops when its panel/Port is closed. At most 1,200 non-gallery file descriptors are enriched in this test revision; two are queried concurrently with conservative pauses, 429 handling and active Workspace verification. Very large workspaces may still take time. Background inventory and original-file export are **deferred**. Existing chat export and separately enabled background update are unchanged.

## Known limitations

- A Library record's `origination_thread_id` and `origination_message_id` establish an observed reference, not the author role. The exact chat/Project URL and message anchor are not exposed by this listing and are not fabricated.
- The Work UI's Outputs and ephemeral sandbox files are not yet enumerated as independent storage sources. A `codex` or `caas` descriptor cannot by itself identify a Work session with certainty.
- A Project Source missing a matching Library record is listed under `unmatched_project_refs` rather than silently added or dropped. File content duplicates with different `file_id` values are **not** deduplicated by filename.
- Project detail APIs are private and may change. `links_status: partial` means the reference view is incomplete, not that the underlying file list is missing. Rate limits or 404 descriptors set `classification_status: partial` while the Library/Images listing may still be complete.
- Live Chrome authentication/permission regression checks have not yet been run for this revision.

---

## Previous rev.1 documentation (historical)

# Chat Archive Exporter v0.1.6.10 rev.1 — Library / Images inventory (test build)

## New in v0.1.6.10 rev.1

**Scope:** Read-only inventory of the active, verified ChatGPT Library and the independent generated Images gallery. No original file content is requested or downloaded by this new feature, and no Library files are written to the Vault. Existing chat exports and their separately configured background jobs retain v0.1.6.9 behavior.

1. In `chrome://extensions`, update the **same unpacked extension directory** and click **Reload**. Do not uninstall the previous version or clear its local storage; existing Vault indexes and queued jobs must be preserved.
2. Open ChatGPT Personal / Free or Business / Space in the desired workspace. Open the Chat Archive Exporter side panel and select **Library / Images**. The inventory will load; **Refresh** repeats the read-only scan.
3. Entries appear in separate **Uploaded**, **Generated**, and **Unknown** origin groups, each split into **Images** and **Other files**. Labels may be `confirmed`, `inferred`, `conflicting`, or `unavailable`; `my_files` indicates a plausible but *inferred* uploaded origin, not proof of file authorship.
4. To inspect data and report API problems, click **Catalog JSON**. This downloads a JSON **list/diagnostic report only**, with no signed content URLs, tokens, source IP addresses or original file bytes. The catalog is not automatically saved in Vault.

**Collection APIs** (all restricted to the verified currently active workspace): `GET /backend-api/files/library/nodes`, with cursor paging and attempted nested directory scans; `GET /backend-api/my/recent/image_gen?limit=50`, with `after` paging; and, only where needed, `GET /backend-api/files/{file_id}` for allowlisted metadata (`use_case`, MIME, size, safe origin markers). Duplicate images in Library and gallery are joined by a real `file_id`; a gallery ID `s_...` is **not** treated as a file ID. Files present only in Images remain in the catalog. Unknown and conflicting origins are not silently guessed from conversation IDs, `fs`/`sediment` locations or names.

**Completeness and limits:** Each collection independently reports `complete` or `partial`, counts, and warnings. The diagnostic build caps directory depth at 16, total nodes at 15,000, folders at 700, pages per folder/Images at 120, and per-file metadata lookups at 400. Folder pagination and the exact child-directory parameter still need confirmation in authenticated Chrome; unexpectedly returned parents are rejected rather than fabricated as nested files. API changes, 429 cooldowns, network errors or account switching may interrupt a scan. A scan is foreground-only and stops when its content-script Port disconnects. No background Library polling is enabled.

**Not in this build:** Library binary downloads; bulk Vault export of Library originals; selection checkboxes; native Spaces / Pages / Sites and their automations; external Google Drive/OneDrive downloads; Memory (account or Project). No new Chrome permissions.

### First-run checks

- On Personal/Free: confirm the inventory can include gallery-only images absent from the Library root list. Compare summary counts with the ChatGPT UI and with the JSON report. Verify origin grouping for one known uploaded file and one known generated image.
- On Business: compare the Space file view with the Library portion of the catalog. Inspect any nested-directory warnings; do not interpret a `partial` scan as a definitive complete file inventory.
- Switch Workspace while the scan is active. The scan should stop and should never display the previous workspace's list under the new account.
- Search by a name or extension; confirm origin groups remain separate. Download the **catalog JSON** and confirm it contains no `sig=`, signed URLs, authorization values, file contents or Memory.
- Existing v0.1.6.9 chat export, Vault handling, schedules and optional background sync must work as before.

---

## Historical v0.1.6.9 notes

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

**Known constraints for v0.1.6.9:** Internal ChatGPT endpoints are not a stable public API. Paging across more than 25 Schedules was simulated, not confirmed on a live account. Scheduled changes are observed at polling intervals, not recorded as a complete event history. Native installed-extension testing with authenticated ChatGPT/Chrome Downloads/File System Access remains necessary. More detailed UX/settings belong to v0.1.7; Library/Spaces/Images file inventories are postponed to v0.1.6.10.

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
reports `complete`. External interruptions retain the prepared bytes, offer **Retry
delivery / step**, and do not silently start another download. A browser Save
dialog explicitly dismissed by the user (`USER_CANCELED`) instead produces the
terminal `completed_not_saved` result: the selection was prepared but **no
completed download was saved**; staged bytes are discarded and another manual
operation can start. This is distinct from extension **Stop export**. Vault
exports and permission recovery do not use this browser-download policy.

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


### v0.1.7 rev.2 UX test build
The default browser action opens a Popup with Export, Activity, Settings and Tools. A Side Panel is used for large selections and may close after job acceptance. It also keeps Settings and Tools inline when opened. An optional in-page widget offers short activity monitoring and expanded logs. The old floating current-chat button is suppressed. The toolbar floppy icon now has a native `REC` / `IDLE` / `WARN` status badge. v0.1.6.11 rev.1 remains the functional archival core.
