# Test report

- 81/81 Node.js suites passed, including cross-profile saved inventory, independent local jobs, read while another writer holds a claim, baseline preservation, one-shot API update, no original downloads, stale receipt rejection and account isolation. Original Beta 2 parity fixture retained.
- Real Chromium with mocked extension/provider/filesystem: 12/12 UI scenarios, new cross-profile UI ordering/history scenario, widget, cached chat list, retained download and message selection navigation passed.
- Selective-export browser script could not navigate to the synthetic HTTPS test host (`ERR_BLOCKED_BY_ADMINISTRATOR`); this is an environment blocker. Native authenticated Chrome/Edge, real external Vault and live multi-profile concurrency remain UAT.
