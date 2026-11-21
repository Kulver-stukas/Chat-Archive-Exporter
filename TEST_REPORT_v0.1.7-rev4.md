# Chat Archive Exporter v0.1.7 rev.4 — Test report

## Reproduced bug and correction

Manual job state `download_failed` retains `active: true` after Chrome's Save dialog is canceled (`USER_CANCELED`) to allow optional ZIP retry. The Side Panel's `ensureListLoaded()` previously returned immediately whenever `manualJob.active` was true, suppressing both saved Vault/Local cache and live `CAE_LIST` requests. The rev.4 UI removes this inappropriate check. The independent manual-job controller is unchanged.

## Tests

- **56/56 Node.js test suites passed**, including the frozen-core integrity test for 31 engine files.
- **10/10 Chromium Popup/Side Panel smoke scenarios passed**.
- **2/2 new Chromium retained-delivery cases passed**: cached chat list appears before API response, and cold list appears after API response, with the canceled job left active/unchanged.
- Existing cached-chat browser test passed; refreshing after failed live request retains cached rows.
- Widget Chromium smoke passed (compact/expanded state, dismissal, and keyboard navigation).
- Native installed-extension test on an authorized real ChatGPT workspace was not executed in this environment.

## Change boundary

Only UI code (`panel.js`), version labels/documentation, and new regression test modified. No data-engine, API, Vault, Source, worker or permission modifications.
