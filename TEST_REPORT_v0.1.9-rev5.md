# Test report — v0.1.9 rev.5

## Passed

- 71/71 Node.js regression suites (including UI worker route to Settings and frozen-core tests).
- Chromium widget test: opt-in, directly visible monitor, absence of minimized and quick action controls, short/long logs, all widget buttons have native titles, routing Settings to side panel, close updates widget preference, drag and theme, no implicit scans.
- Chromium compact selector: 200 rows at 320px light and 400px dark; generated image and uploaded image fixtures; Files shortcut selects only eligible file-containing rows, disabled with both file categories off, ZIP label and correct count, all panel buttons have nonempty tooltips, other selection shortcuts still work.
- Chromium shared UI smoke: 11/11 scenarios including local Settings/Tools, widget Settings intent, Vault recovery fixture, cancellation, list selection, auto-close, workspace changes, no implicit inventory.
- Chromium message selector navigation: indeterminate progress, full-height layout, workspace isolation, stale replies, explicit Refresh, complete-conversation behavior.

## Limits

Browser checks exercise real Chromium DOM/CSS and scripted extension/API fixtures. They do not establish successful operation with authenticated ChatGPT, native extension permissions, native tooltip timing or actual sidePanel.open user-gesture behavior. These need user UAT in Chrome/Edge. No publication to GitHub during this revision.
