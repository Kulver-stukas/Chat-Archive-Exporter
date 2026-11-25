# v0.1.9 rev.2 — Test report

Date: 2026-11-25. Baseline: delivered v0.1.9 rev.1 source ZIP.

## Executed

- `node --test tests/*.test.js`: 70 passed, 0 failed, 0 skipped. The updated export-selection suite checks identical preview text/row identities across all 31 nonempty content-category combinations, multiline response previews and file-only/thinking-only fallback behavior. Existing export/attachment/Vault tests are unchanged.
- `python tests/compact-selector-browser.py` with installed Chromium 144.0.7559.96: pass for 320px light and 400px dark. Actual panel HTML/JS/CSS, synthetic 100-turn conversation (200 logical rows), mocked browser/provider/Vault interfaces. Collapsed rows measured 29px; answer checkboxes offset 15px. Verified no horizontal overflow, all rows initially collapsed, real response previews independent of Thinking, expanded multi-line preview, individual expansion without changing neighboring row height, Answers and None selection and empty-export guard. Screenshots saved in QA directory.
- JavaScript syntax and package references checked by build script.

## Not completed

- The previous full multi-surface selective-export UI browser test cannot navigate to its synthetic HTTPS test origin (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). Its new compact-row assertions are also covered by the focused offline Chromium test above.
- Native authenticated Chrome/Edge extension UAT is not executed. Browser filesystem permissions, real provider responses and cross-instance settings persistence are not newly verified in this revision.

## Scope

Only presentation-related code in `panel.js`, `styles.css` and the row-preview projection in `lib/export-selection.js` was modified. `manifest.json` changes only version_name. Other archive/worker/runtime modules and permissions retain the delivered rev.1 bytes. No new feature or archive-policy changes.
