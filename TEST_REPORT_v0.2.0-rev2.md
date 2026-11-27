# Test report — v0.2.0 rev.2

- Node: 77/77 suites passed, including the 74 rev.1 suites and three cumulative rev.6–8 regression suites (Vault recovery, portable preferences, shared Vault). All original baseline fixtures are retained.
- Chromium fixture scripts: 6/6 passed (`ui-browser.py`, `compact-selector-browser.py`, `message-selector-navigation-browser.py`, `library-panel-smoke.py`, `ui-chat-cache-browser.py`, `widget-browser.py`). The popup folder-selection assertion follows rev.8 routing: open Side Panel Settings, then persistent Settings tab when requested. These are real Chromium rendering/interactions with mocked Chrome extension APIs, provider data and Vault access.
- Parity capture: same normalization, complete and selected Markdown, ZIP contents (including original bytes and report), Vault file paths/content/checksums, Library catalog and placements. The two synthetic metadata `local_last_modified` counters are each +2 from the fixed Beta 2 snapshot due to creation of writer claims. The test asserts this precise delta and exact equality of everything else; the golden fixture was not regenerated.
- Architecture: original baseline runtime fixture retained; the allowlist accounts explicitly for cumulative repairs. Contract, registry and descriptor unchanged from rev.1. No new permissions or host permissions.
- Native authenticated Chrome/Edge sessions, real filesystem permission recovery and parallel native filesystem writers in the integrated rev.2 build have not been tested in this environment. The rev.8 user observation applies to rev.8, not automatically to this build. The existing native MV3 smoke limitation recorded in rev.1 remains unverified.

No GitHub or Chrome Web Store publication in this integration revision.
