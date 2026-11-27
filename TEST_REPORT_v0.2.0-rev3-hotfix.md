# Test report — rev.3 hotfix (0.2.0.4)

- 80/80 Node.js suites passed, including independent concurrent claims and the new `writer-claim-recovery.test.js` covering stable identity, local-lock proof, restart, empty own claims, foreign/legacy preservation, changed snapshot refusal, explicit reviewed cleanup and preservation of an index sentinel.
- Chromium `ui-browser.py`: 12/12 cases passed, including the explicit review/confirmation flow (mocked extension APIs/FS). Syntax checks passed for all non-test JavaScript.
- Direct deterministic rev.3 vs hotfix comparison: normalized messages, Markdown, ZIP members/bytes, archive files/indexes, Library placements identical except the two precisely checked synthetic metadata mtime counters (+2 vs rev.3, +4 vs Beta 2). Original Beta 2 fixtures unchanged. No permission expansion.
- `writer-claim-browser.py` was attempted, but Chromium navigation to the local fixture was blocked by the environment administrator (ERR_BLOCKED_BY_ADMINISTRATOR). No pass claimed for real OPFS/Web Lock after page destruction. Native external Vault and authenticated Chrome/Edge concurrency remain UAT.
