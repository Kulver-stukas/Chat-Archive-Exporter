# v0.2.0 rev.6 — schema preview UAT

Manifest 0.2.0.8. This is a read-only migration-planning build, not a migration executor.

1. Update the same unpacked extension directory; reload extension and ChatGPT. Keep chat and Library monitoring paused across all browsers. Do not start manual export during planning. Verify existing Vault/workspace binding.
2. Settings: when Enable background update is unchecked, Check Project Sources every 6 hours must be unchecked and disabled. Checking the parent makes the child available but does not turn it on. Uncheck again before applying. Test popup, Side Panel and persistent Settings. Pause also clears the effective saved Source option.
3. Open Side Panel → Chats, explicitly refresh its list, then Tools → Vault Schema v2 → Plan migration (dry run) → Export migration plan. The planner uses the live list already obtained in that panel and does not itself make new provider requests.
4. Repeat for all three previously tested workspaces in the two Vaults. Check combined names and full IDs, proper project/GPT classification, previous directories and preservation of original Source filenames. Check label fallback where a paid plan is not exposed.
5. Confirm that all observed physical files are represented, including unindexed/pending Library files and control files. Divergences, collisions and incomplete records should block the plan, not trigger repairs. Compare listings before/after. Cancel a scan and switch workspace; old plans cannot be exported from another scope.
6. Return three migration-plan JSONs for review; keep them private because they contain IDs, local paths and hashes. A blocked plan is an expected useful result for an inconsistent archive.
7. Full Node and Chromium regression and disposable-Vault execution tests are still required before any real migration.

Popup Tools and widget persistence issues remain deferred.
