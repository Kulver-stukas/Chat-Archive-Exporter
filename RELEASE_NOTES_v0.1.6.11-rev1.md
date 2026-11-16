# Chat Archive Exporter v0.1.6.11 rev.1 (test build)

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

No new Chrome permissions or host permissions. Existing chat export and Project Sources controllers are retained. This remains a test build; its authenticated ChatGPT API paths have not been verified in live production during local build testing. See `TEST_REPORT_v0.1.6.11-rev1.md` for the actual executed tests and blocked checks.
