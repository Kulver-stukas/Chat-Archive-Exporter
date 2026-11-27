# Test report — v0.2.0 rev.3

Baseline: exact rev.2 source archive, verified against the 217 files in GitHub commit `1ceb339b286ffe7478fad65b6b71eab27f069296` on `dev/v0.2`.

- Node.js: 79/79 suites passed (77 existing, 2 new: `rev3-adapter-boundary.test.js`, `rev3-runtime-parity.test.js`).
- Browser fixtures: 6/6 passed using Chromium (`ui-browser.py`, `compact-selector-browser.py`, `message-selector-navigation-browser.py`, `library-panel-smoke.py`, `ui-chat-cache-browser.py`, `widget-browser.py`). These exercise actual Chromium rendering and interactions with mocked extension APIs, provider responses and Vault access.
- Direct comparison: executing the deterministic parity capture separately against the untouched rev.2 source ZIP and the rev.3 source tree produced identical JSON bytes, including normalized messages, full/selected Markdown, ZIP member names and decompressed bytes, Vault files/indexes and Library catalog/placements. ZIP container timestamps/compression metadata are intentionally excluded. The original Beta 2 parity test also passed with only its previously documented two synthetic mtime offsets. Neither original Beta 2 fixture was regenerated.
- Exact rev.2 runtime integrity test checks 13 modified and 9 added runtime/assets paths; all other runtime/assets bytes are unchanged. The approved modifications are extraction/entrypoint changes and version labels, not an archival policy change. Generic renderer and transfer tests verify no raw ChatGPT dependency and denial of missing/refused authorization policy. No new browser or host permissions.
- JavaScript syntax: all non-test JavaScript files passed `node --check`. The install package builder validates manifest content script paths, worker imports and HTML script references.
- Not tested here: native authenticated ChatGPT in Chrome/Edge, real browser file-handle recovery and simultaneous filesystem writers, native MV3 lifecycle across restarts. The browser fixtures do not establish native extension compatibility by themselves. See UAT.

Rev.3 is an unpacked architecture preview, not a store release. The confirmed rev.2 remains the development branch baseline until acceptance of rev.3.
