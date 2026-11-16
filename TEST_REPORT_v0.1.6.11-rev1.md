# Test report - v0.1.6.11 rev.1

Date: 2026-11-16. Base: the delivered v0.1.6.10 rev.2 source ZIP, not an inferred repository state.

## Executed successfully

- All 47 preexisting Node.js test suites passed after the changes.
- Five added Node.js suites passed (52 total):
  - `library-job-lifecycle.test.js`: explicit manual baseline, original-free collection, restart recovery, five-minute new-file checks, old descriptor cache reuse, dated/undated enrollment, Project Source exclusion and persistent Stop.
  - `library-job-archive.test.js`: selected-only archival, Source selection rejection, grouping, HTTP 415 isolated/no automatic retry, disk SHA-256, no duplicate bytes on repeated archival, same-size/same-mtime local edit preservation.
  - `library-job-safety.test.js`: no implicit seed, mismatched workspace fail-closed, permission loss pause, Retry-After across restart and Resume, local snapshot corruption protection.
  - `library-page-api.test.js`: allowlisted metadata, safe route/ID validation, file descriptor errors, directory-parent verification, pre/post workspace checks, signed URL kept only in local transfer resolver, no private descriptor details retained.
  - `library-job-recovery.test.js`: original closed before index interruption, checksum-based recovery without redownload, byte budget charged once, size mismatch rejected.
- Six real Chromium UI smoke suites passed using stubbed extension/backend interfaces:
  - configuration-panel, library-panel, manual-panel, panel-automation, panel-taxonomy, panel-ui.
- The Library UI test specifically checks no scan on open/focus/reconnect, explicit Start, navigation during collection, Source checkbox exclusion, filtered selection, archive command, Stop, catalog JSON, no page JavaScript errors and no horizontal overflow at sidebar width.
- All runtime and test JavaScript files passed `node --check`.

## Not passed / environment blocked

- `manual-browser-smoke.py` and `spool-browser-smoke.py` were blocked before their assertions: Chromium returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` for their localhost HTTP fixture pages.
- `library-extension-e2e.py` was attempted with the unpacked MV3 extension, real content-script bridge and an isolated OPFS test Vault. No extension service worker became available. An independent `chrome://extensions` check was also blocked by browser administrator policy. This is **not** counted as a passed end-to-end test.
- Unit lifecycle/transport tests use simulated Chrome APIs, clocks, IndexedDB and file handles. Passing them does not establish live Chrome permission survival or live ChatGPT endpoint availability.

## Required live browser acceptance

Initial baseline creation, correct existing workspace Vault path, closing/reopening the side panel, Chrome worker restart/idle, generating a new file after enrollment, zero repeated descriptor calls for preexisting IDs, Source exclusion by ID, original binary delivery through the actual endpoint, per-file HTTP 415 reporting, permission recovery, workspace switching mid-job and a real local-edit conflict.

No authenticated ChatGPT server calls were made during build testing. No new GitHub commit, tag or release was created.
