# Chat Archive Exporter v0.1.8 rev.1 — Local verification report

Date: 2026-11-22. This is a **test build**, not a GitHub release or Chrome Web Store deployment.

## Automated verification completed

| Check | Result | Environment |
| --- | --- | --- |
| JavaScript suite | **62/62 passed** | Node.js, synthetic account/session/Vault APIs |
| Chromium Popup + Side Panel UI | Passed | Headless Chromium, mocked provider and filesystem |
| Chromium optional widget | Passed | Headless Chromium, mocked MV3 status |
| Chromium saved-chat cache | Passed | Saved metadata before mocked remote API response |
| Chromium retained/canceled delivery lists | Passed | Mocked canceled browser Save and retained tasks |
| Chromium Library Sources selection | Passed | Unsaved Source selectable; archived copy and Source-only metadata excluded; no implicit scan |
| File System Access invalid-name fallback | Passed | Mocked `getFileHandle` TypeError; original name, alias and SHA in index |
| Source checksum verification | Passed | Mocked Vault, SHA-256, identical size + modification time tampering |
| Interrupted index commit | Passed | Injected shutdown after complete file bytes, before final Source index write |
| Incremental-only Source reference | Passed | New Source placement committed with no new Library file; no rewrite when unchanged; promotion deduplicates |
| Workspace isolation / path validation | Passed | Mocked multi-workspace / source destination assertions |
| UI frozen-core diff allowlist | Passed | Whitelisted v0.1.8 technical modules; unchanged modules and Chrome permissions match recorded baseline |

Source checks in tests:
- `tests/library-source-dedup-integrity.test.js`
- `tests/source-filename-browser-safety.test.js`
- `tests/library-links-provenance.test.js`
- `tests/library-incremental-placement-commit.test.js`
- `tests/vault-source-recovery.test.js`
- `tests/library-panel-smoke.py`

## What was specifically verified

**Dedup:** a Library record linked to an unarchived Project Source remains selectable; an existing same-file-ID Source with a valid on-disk size/hash is excluded. An altered Source with the same size and timestamp is not treated as a verified duplicate. Local files are never silently overwritten.

**Filename handling:** `sourceFilename()` handles a conservative list of browser-restricted extensions, and `beginSource()` aliases a source that raises `Name is not allowed`. The index retains the original name. A subsequent request reuses the saved alias and original instead of repeating a download.

**Registry:** missing-from-Library Sources remain independent `source_only` records with project references; multiple Projects pointing to one file ID produce one entry. When an old Source-only ID appears in Library, it is promoted without duplicate rows. Any `conversation_id` and `message_id` retained from verified metadata is associated with the file, but **message roles and Work identity are not inferred**.

**Crash safety:** a staged SHA-256 and size prevent adopting an incomplete/orphan file as complete. Verified completed bytes can be recovered after interruption of the final index write; conflicting bytes are left untouched. A pending item prevents another Library download from duplicating an incomplete Source.

**Background:** no full rescan is triggered merely by panel navigation; incremental metadata checks do not refetch old file descriptors. New Source placements can update saved inventory without a newly created Library file.

## Not verified in this environment

- Live authenticated ChatGPT API enumeration on Free and Business Workspace (real cursor fields, Project refs, available server metadata).
- Actual installed MV3 extension with File System Access permissions and real user prompts in **Chrome and Edge**. Mocked Chromium tests do not prove OS/browser permission retention or worker lifecycle behavior in the user's profile.
- Physical machine sleep, multi-tab tab discard, real service-worker kill, and real mid-write power loss.
- Real browser-specific filename restrictions beyond the tested conservative denylist and simulated `Name is not allowed` TypeError.
- All browser/platform combinations. No claim that Edge UAT has passed.

## Data safety & caveats

- Current `v0.1.7` UX/UI preserved. No new Chrome permissions or host permissions. No automatic binary download or full data migration.
- A legacy Project Source index file with incomplete/invalid checksum is deliberately not declared a verified copy. The linked Library original may remain selectable; successful download is still dependent on provider API availability.
- File IDs are identity keys: two identical contents under **different** IDs are not silently conflated; byte-hash verifies an existing candidate, it does not erase distinct provenance.
- Only verified metadata establishes message links; role and chat-vs-Work type stay unknown until independently confirmed.
- Selective individual Prompt/Thinking/Response/attachment export is deferred to **P2** (not implemented in v0.1.8 rev.1).

## Required acceptance before wider publication

See `UAT_v0.1.8-rev1.md` for a controlled, disposable-Vault test matrix in authenticated Chrome and Edge. Do not replace the published GitHub Beta until these tests are accepted.
