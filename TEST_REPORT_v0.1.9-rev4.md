# v0.1.9 rev.4 test report

## Passed

- All 71 existing Node.js test suites.
- `tests/message-selector-navigation-browser.py`: actual panel JS/CSS in Chromium with delayed synthetic API responses. Indeterminate progress visibility and disabled actions; full-height list (402 px at 1024 px viewport, 678 px at 1300 px, minimum 64 px at 440 px); automatic same-workspace loading; late reply isolation; rapid navigation during workspace status query; explicit refresh after workspace change; no reads on unrelated tabs or hidden selector; same-tab SPA navigation and API failure recovery; stale vs verified popup intent; Complete conversation prevents auto-follow; no automatic downloads or Library inventory.
- `tests/compact-selector-browser.py`: 200 rows at 320 px light / 400 px dark; one-line previews, answer indentation, disclosure, content filters and dynamic output label.
- `tests/ui-browser.py`: all 10 existing synthetic Popup/Side Panel smoke scenarios.
- `tests/ui-chat-cache-browser.py`, `tests/ui-chat-pending-delivery-browser.py`: cached listing before API, error recovery, pending delivery does not block chat listing.

## Limits

The older cross-document `tests/selective-export-ui-browser.py` cannot navigate to its routed synthetic address (`net::ERR_BLOCKED_BY_ADMINISTRATOR` at `https://cae.test/popup.html`) in this environment. Its SPA expectation was updated for automatic refresh. The new in-document Chromium regression test exercises the actual panel JS and controlled navigation events without network navigation. Neither constitutes authenticated Chrome/Edge MV3 UAT or real API latency measurement.

## UAT

1. Open a long conversation, disable Complete conversation, click Select messages. Verify Loading messages and a moving progress indicator until rows arrive.
2. Change some checkboxes, switch to another chat in the same workspace with the panel open. Verify previous rows disappear; after a short pause, the new rows load and eligible rows start selected. Repeat quickly among several tabs.
3. Switch to another workspace; confirm the selector does not load until Refresh. Switch to an unrelated site and verify no message requests are made there.
4. Resize browser height. The list should expand to use the remaining space while the download button remains visible (or reachable by scrolling in very short windows).
5. Confirm manual Refresh, export categories, selection download, complete-conversation export and Vault behavior are unchanged.
