# rev.4 test report

Baseline: exact v0.2.0 rev.3 hotfix 2 source ZIP, manifest 0.2.0.5. Candidate: 0.2.0.6.

- 84/84 Node.js regression suites passed, including exact runtime baseline allowlists, original Beta 2 functional parity (unchanged Markdown, ZIP, archive bytes/indexes and Library placement, except the two previously documented synthetic mtime offsets), independent-profile recovery and shared state.
- New tests cover provider/workspace/resource identity and overlap, retained shared-index conflict, injected semantic transport with non-ChatGPT test fixture, manual/background archive currency, provider-only archive flag, stale revision, unknown and workspace isolation. Worker route tests verify disk evidence and reject changed Vault bindings.
- Eight Chromium fixture test scripts passed: ui-browser, ui-chat-cache-browser, ui-chat-pending-delivery-browser, shared-workspace-browser, compact-selector-browser (after adding missing tooltips to two existing recovery buttons), message-selector-navigation-browser, widget-browser, chat-vault-status-browser.
- Native OPFS/Web Locks page-destruction test and selective-export cross-page UI script could not complete: test HTTP/HTTPS navigation blocked by the Chromium environment (ERR_BLOCKED_BY_ADMINISTRATOR). These are not passes. Existing Node tests and local-page Chromium fixtures cover corresponding synthetic logic but do not substitute for native authorized UAT.
- The provider adapter and resource identity boundaries are tested; no physical migration, resource-granular lock acquisition or additional provider is implemented. Real Chrome/Edge authenticated/external Vault UAT remains required.
