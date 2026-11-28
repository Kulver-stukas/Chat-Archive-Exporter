# rev.5 authenticated UAT

Use a copy of an archive for deliberate destructive fixture tests. Do not delete actual archive files to test recovery. Keep Schema v1 unchanged.

1. Upgrade the existing unpacked extension to 0.2.0.7, reload the extension, refresh ChatGPT. Confirm account, workspace, original Vault binding and monitoring configuration.
2. Pause monitoring in every browser/profile that writes to the test Vault. Tools → Vault Integrity → Scan Vault → Export integrity report. Expect scope, actual and indexed chat counts, findings and a quick-mode report with no hashes claimed verified. Repeat with Full scan (SHA-256). Verify the reports and directory listing agree. Scan only the current Workspace; repeat in other workspaces.
3. In the populated archive, the audit should expose prior split/incorrect project directories if they still exist, not move or modify them. On the small test Vault check custom GPT paths, legacy index evidence and Sources. No automatic repairs.
4. Enable a controlled competing writer during a scan of a copy, or run a scan with an existing writer claim. Expect a provisional report if a claim or changing index is observed; re-run after all writers stop. Cancel and switch workspace during a scan: no cross-workspace report export or writes.
5. On Chats select an entire Project, including previously archived chats. Note the count displayed. Save selection to Vault. After terminal status, Tools → Export manual job diagnostics. Compare selected IDs, accepted count, counts.saved/skipped/failed and per-item outcomes/paths. A verified existing file must be identified as verified_current, an untracked file as untracked_preserved, a conflict as conflict. Older jobs lack detailed records. A stale selection should be rejected, not silently reduced.
6. Repeat the identical selection: expected zero writes where existing revisions are current; explicit verified skip reasons. Open a chat in the test Workspace, generate another answer, and verify background updates and widget counters.
7. On a disposable Vault copy, remove one indexed chat file while all writers are paused. Re-enable monitoring and trigger forced detail verification of the unchanged remote chat. Expect restoration of the file and matching index. Verify no local edit is overwritten.
8. For every unexpected result retain the JSON integrity and manual-job reports and, if relevant, the existing access diagnostics. The exported diagnostic reports contain IDs and local paths; do not publish them unredacted.

Required UAT on Chrome, a separate Chrome profile, and Edge. Full Node/browser regression still required before promotion.
