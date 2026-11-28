# rev.5 test report

Executed against the exact authored scanner source via the JavaScript tool runtime, using synthetic read-only directory/file handles:
- 6 scenario checks: quick audit, full hash audit, writer contention provisional status, index-change detection, unverified-scope rejection, cancellation. Quick/full assertions include missing, duplicate, unindexed, misplaced and split project files, shadowed legacy index, pending source, same-size hash mismatch, and cross-workspace filtering. All passed.
- 25 checks on the manual diagnostic helpers and UI/manifest wiring passed (including bounded detail, reason redaction, retained outcomes, idempotent checkpoint and unchanged permissions).
- 13 changed/relevant JavaScript and test files parsed successfully with the JavaScript engine.

Repository regression coverage added: tests/vault-integrity.test.js; manual-job selection/receipt assertions; missing-file forced-verification regression; reviewed baseline delta for manual-store.js and manifest version. The full Node suite and Chromium fixture suite were NOT executed: the local build container could not resolve GitHub, and the connected GitHub interface does not expose a local checkout. Browser UAT is not claimed. The branch is an unmerged diagnostic preview, not a validated release.
