# Chat Archive Exporter v0.1.8 rev.1 — Technical test build

Baseline: [v0.1.7 Beta 1](https://github.com/Kulver-stukas/Chat-Archive-Exporter/releases/tag/v0.1.7-beta.1), not the old v0.1.6 interface. Technical work tracked in GitHub Issue #3.

## What changed

**P0 — Library × Project Sources.** Previously, simply being referenced by a Project Source could hide an eligible Library original. The extension now distinguishes *linked* from *archived*: it verifies an actual matching on-disk Vault Source file (workspace, file ID, size and SHA-256) before excluding the Library original. Missing Source exports remain selectable in Library. Existing locally edited originals are never overwritten, even if file size and modification time are unchanged. File IDs are matched; equal names do not establish identity.

**P0 — Invalid File System Access names.** Source file names rejected by Chromium are converted to safe on-disk names with an inert suffix (`.cae-file`) while preserving `original_filename` and `stored_filename` in the Vault index. `getFileHandle` failures with `Name is not allowed` trigger a single deterministic alias attempt, not an indefinite connector retry. A second failure is classified `UNSUPPORTED_FILENAME`. Existing successfully archived files retain their paths; this revision does **not** rename or migrate older user archives.

**P1 — Complete reference inventory.** A Project Source absent from Library/Images becomes a Source-only record (`source_only: true`) with distinct placements, rather than silently disappearing or impersonating a downloadable Library original. For metadata including a confirmed `conversation_id` and `message_id`, the catalog saves a `conversation_message` placement and `message_references`; unknown message roles, chat-vs-Work classification and unobserved page URLs are retained as `unknown`/`null`. Multiple Projects can point to one physical `file_id` without creating multiple Library originals. An old Source-only record promotes to a Library record if that original later becomes visible in Library, irrespective of its original creation date. The incremental job durably commits changes in placements even when the Library added no new file; unchanged polling avoids redundant Vault writes.

**P1 — Vault crash recovery and verification.** Source writes now create a pending receipt, stage the downloaded byte count and SHA-256, and finalize only after verifying the bytes on disk. A crash between the file write and its index commit is recovered by checking the file and checksum, without repeating the download. Incomplete or modified files are preserved as conflicts. Source destination paths are constrained by the verified workspace. Manual and background chat export behavior, File System Access permission prompts and previously saved paths remain unchanged.

## Deliberately deferred

- Selective per-Prompt / Thinking / Response / attachment exports: **P2**. Whole-chat Markdown and multi-chat ZIP exports remain available.
- Full native Space/Page/Site hierarchy, page schedules and Work sandbox enumeration: out of scope.
- No export of account/Project Memory or Temporary Chats; no cross-workspace access, no automatic original binary downloads.
- Real Chrome/Edge UAT requires an authorized browser and interactive permission dialogs; not simulated as completed.

## Installation

1. Unpack the **extension** ZIP in the **same existing extension directory** and use `chrome://extensions` → **Reload**. Do not uninstall or clear extension data, Vault or saved handles.
2. Refresh the ChatGPT tab. Verify that the Popup, Side Panel and widget display the expected workspace and Vault.
3. Run a **manual** Library inventory. Confirm that a file shared with Project Sources is selectable when its Source copy was never archived, and excluded when a verified same-file-ID Source copy exists in the Vault.
4. Check `_Library/_inventory.json` for `items[].placements`, `source_only`, `source_copy_verified`, `project_references` and `message_references`. A `source_only` record is a reference, not a downloaded file.
5. For browser permissions, invalid names, sleep/reload and crash cases, follow `UAT_v0.1.8-rev1.md` before upgrading an important production Vault.

## Existing boundaries

HTTP 415/404 remain per-file failures, 429 invokes cooldown and explicit confirmation; requestable does not mean downloadable. File identity and verified duplicates use identifiers and hashes, not names. ChatGPT APIs can change and may expose only incomplete metadata. Do not fabricate author roles or provenance where the API does not identify them. No new Chrome host permissions or runtime permissions.
