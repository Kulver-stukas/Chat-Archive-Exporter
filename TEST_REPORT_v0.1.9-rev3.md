# v0.1.9 rev.3 — Test report

Date: 2026-11-25. Baseline: delivered v0.1.9 rev.2 source archive.

## Executed

- `node --test tests/*.test.js`: 71 passed, 0 failed, 0 skipped. New image-tool output tests cover generated image pointers, image-only previews, active-branch scope, hidden tool records and legacy archive rendering. Extended attachment resolver tests cover legacy file IDs and conversation/message binding. Extended manual selection output tests verify a ZIP containing original synthetic PNG bytes with a correct extension and the attachment report. All pre-existing Vault, lifecycle, workspace isolation and selective-export regressions pass.
- Focused Chromium selector test (`tests/compact-selector-browser.py`): pass at 320px light and 400px dark with a synthetic 200-row conversation, including image-only output. Verified ZIP/MD selection label, disabled upper action with functional menu, hidden Vault action during selection, compact descriptions, row expansion and no horizontal overflow. Screenshots in QA output.
- Install packaging validates manifest script, HTML script and worker import references. ZIP archives are checked for integrity.

## Limits

- No authenticated live ChatGPT API/image-only conversation was available to the test environment. The missing-image explanation is based on the original normalizer and the supplied Exporter reference; the new extraction and binary transfer path are verified with synthetic fixtures, not the user's exact server response.
- The full cross-surface browser scenario remains blocked by the test environment's navigation policy. Native Chrome/Edge acceptance testing is required.
- Some real generated images may have expired or unsupported original-file routes. The report distinguishes unavailable originals from successfully received bytes; an original is not claimed merely because an image reference exists.
- No individual file checkboxes in this revision.

## Targeted UAT

1. Open the image-generation conversation that previously produced only Markdown. Enable Generated files and Complete conversation off; open the selector. Check recognized output filenames and a ZIP label for selected eligible images.
2. Select a single image-producing answer. Export, confirm a ZIP containing Markdown, any obtainable original(s) under attachments/Generated and export-report.json. Check that the report describes missing files and that the original can be opened. Disable Generated files (and Uploaded files if applicable): for the same text-bearing selection, expect Markdown instead.
3. Check an uploaded image and a file-only user prompt. Verify that original references remain scoped to the selected messages and relevant origin categories. No unrelated files should be retrieved.
4. With a selector open, the upper action must be inactive and its category arrow available. Save to Vault is hidden in that mode; leaving selection / choosing Complete conversation restores the complete-archive action. Normal Vault export and monitoring remain unchanged.
5. Confirm that the former explanatory paragraphs are replaced by control tooltips; validation and error messages remain visible.
