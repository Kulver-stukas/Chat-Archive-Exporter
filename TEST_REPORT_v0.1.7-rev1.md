# Validation - v0.1.7 rev.1

## Evidence boundary

Build created and tested in the current isolated development environment. No real ChatGPT login, user Vault or original file bytes were accessed. Browser UI tests use synthetic Chrome/worker/filesystem fixtures. This is a test build, not a production acceptance report.

## Passed

- **55/55 Node.js test suites**: all 52 original v0.1.6.11 suites plus 3 new UI-state/routing/core-freeze suites.
- JavaScript syntax check for every JS file in the source tree.
- SHA-256 comparison of **31 frozen archive files**, including every original lib/*.js plus content.js, sync-watch.js and offscreen.*: all byte-identical to v0.1.6.11 rev.1.
- The original worker.js is an unchanged byte prefix. Its only addition imports the UI state/observer module.
- Permissions and host_permissions arrays unchanged; minimum_chrome_version remains 116.
- Real Chromium DOM test (`tests/ui-browser.py`) passed 8 integrated scenarios:
  1. Popup Export / Activity / Settings / Tools navigation; saved catalog JSON without a scan.
  2. Complete-chat MD and Vault commands go to existing durable manual jobs; accepted work does not force navigation back.
  3. Contextual Reconnect Vault and persistent settings surface for a folder picker.
  4. Shared checkbox groups, partial parent state, filter-hidden selection counts, file origin/type/context/archive facets, 320px layout.
  5. Auto-close only after acceptance; rejected selections remain open.
  6. One explicit inventory, no restart on tabs/focus/navigation, independent Stop and Monitor controls.
  7. Workspace-switch invalidation of prior list selection/catalog.
  8. Dark styling and graceful fallback when sidePanel.close is unavailable.
- Real Chromium widget DOM test (`tests/widget-browser.py`): opt-in and manual launch, bound workspace/status, cached update messages without repeated verification, existing quick-export command, selector/settings routing, keyboard movement, collapse/dismiss, suppression/restoration of old in-page MD button, theme selection; no JavaScript errors.
- No horizontal overflow observed in tested 320px and 400px panel layouts. Scrollable list and footer are separate; selection actions do not overlay file rows.

## Not verified here

- The full native MV3 test (`tests/library-extension-e2e.py`) could not start: the managed test browser did not expose a loaded extension service worker. Timeout waiting for serviceworker was recorded. It is not reported as a passing integration test.
- Policy also blocked navigation to synthetic test hostnames, so UI DOM tests used set_content rather than a live test server. Actual browser extension APIs are mocked in these tests.
- Native popup dismiss/focus behavior during file permission prompts, real toolbar icons, real programmatic Side Panel close, actual signed-in API requests, real filesystem permissions and native Work/Free/Business behavior require user testing in Chrome.
- Legacy panel DOM smoke scripts in the retained test directory target the v0.1.6.11 layout and were not treated as v0.1.7 UI acceptance tests. They are superseded for UI verification by the new browser tests; all original Node controller tests still pass.

## Reproduce

Run every `tests/*.test.js` with Node.js 22 or newer, then:

```
python tests/ui-browser.py
python tests/widget-browser.py
```

The browser tests use Playwright and `/usr/bin/chromium`; set CAE_QA_DIR for screenshot/report output. `tests/frozen-core.json` contains baseline hashes. To package, run:

```
python tools/package_extension.py dist/chat-archive-exporter-v0.1.7-rev1.zip
```

## Recommended real Chrome acceptance

Update the same unpacked extension directory, Reload, and refresh an existing ChatGPT tab once. Verify a complete-chat download and a current-chat Vault export, then chat/file selection with auto-close both on and off. Check that reopening UI, filtering and switching tabs do not initiate Library scans. Verify contextual Reconnect Vault, cached Catalog JSON, optional widget, active/idle icon states, and selection clearing after switching Personal/Business workspace. Do not clear the existing Vault or extension data.
