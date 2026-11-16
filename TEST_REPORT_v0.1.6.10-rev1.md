# v0.1.6.10 rev.1 test report

## Source basis

- v0.1.6.9 release source ZIP.
- User-supplied Library filter and file-origin diagnostics from 2026-11-16: `/backend-api/files/library/nodes` returned `items`, `cursor`, and metadata keys including `library_file_category`, `image_gen_attribution`, `record_creation_time`, `file_size_bytes`, and origination identifiers. `/backend-api/files/{file_id}` returned HTTP 200 in both tested cases, with `use_case: my_files` for a Library document and `use_case: image_gen` for a generated gallery image.
- Prior supplied Personal/Business manifests confirm that generated Images may be absent from Library; they are inventoried independently.

## Static and simulated verification

- JavaScript syntax (`node --check`) for all extension modules.
- 47 JavaScript tests passed, including the existing regression suite and new inventory tests.
- New VM tests: `tests/library-inventory.test.js` and `tests/library-inventory-unit.test.js`.
- Six Playwright Chromium UI smoke tests passed, including `tests/library-panel-smoke.py` and existing panel regression tests.
- Existing HTTP-localhost browser tests could not run in this container because the local server navigation was blocked by administrator policy (`ERR_BLOCKED_BY_ADMINISTRATOR`); this does not establish a product defect.

## Remaining authenticated-browser checks

- Whether the Library child query accepts directory `id` or a different folder reference. The scanner marks mismatched child-parent results as partial and never silently claims complete nested traversal.
- Whether all Gallery items provide a usable `file_id`/URL, and whether any `use_case` values need reclassification.
- Latency/cooldown on a Business workspace with hundreds of Library file descriptors.
- Switching active workspace mid-inventory and browser tab/Port cancellation on genuine Chrome.
- JSON export via browser Downloads; no original contents are requested.

## Security invariant

No new Memory, account-switcher, file download, signed content URL, binary transfer or automatic Vault write operation was introduced by the Library/Images feature.
