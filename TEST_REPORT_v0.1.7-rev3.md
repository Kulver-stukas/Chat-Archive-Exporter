# v0.1.7 rev.3 — Test report

The test harness uses synthetic ChatGPT accounts, Chrome runtime API, and Vault fixtures. It cannot independently verify production ChatGPT endpoints, real Chrome File System Access permissions, or MV3 extension lifecycle in the user's browser.

- Frozen core: all 31 source hashes from `tests/frozen-core.json` unchanged, and original `worker.js` prefix unchanged; only the appended UI import list expands.
- New pure test: `tests/ui-chat-list-cache.test.js` validates Vault index/mirror decoding, identity scope, per-chat de-duplication and UI cache envelope.
- Updated worker test: `CAE_UI_WIDGET_STATUS` rebinds automatically after transient bindings have been cleared; repeated healthy polling avoids re-verifying the provider.
- New Chromium test: `tests/ui-chat-cache-browser.py` delays the provider `CAE_LIST`, checks that two cached rows are available for selection, then confirms replacement by three live rows, retention of selected IDs, and offline refresh fallback.
- Widget Chromium test: short and expanded modes, logs, keyboard movement, permanent suppression of the legacy export button; expanded widget fits inside a 720px-high viewport.
- Existing browser Popup/Side Panel test: all 10 scenarios continue to pass. Native installed-extension test and real Free/Business acceptance remain outstanding.

## Test results

- **56/56 Node.js test suites passed.**
- **10/10** existing Chromium Popup/Side Panel scenarios passed.
- A dedicated Chromium cached-chat test passed: cache first, refreshed API, selection preservation and offline fallback.
- Widget Chromium test passed, including the check that its expanded box has no outer scrollbar at 720 px.

## Source files unchanged

The complete v0.1.6.11 archive core, including `lib/sync.js`, `lib/library-policy.js`, `lib/vault.js`, and file-transfer code, remains unchanged. Project Sources without a verified archived copy remain outside this UX-only bug-fix scope.
