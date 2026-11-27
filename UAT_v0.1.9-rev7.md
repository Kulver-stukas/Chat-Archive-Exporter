# rev.7 — acceptance tests

Use a backup/test Vault. Only one browser profile may write to a Vault at a time.

1. Existing profile: update unpacked installation, confirm existing settings, archive paths, library catalog and queue are retained.
2. Fresh profile: select existing Vault; confirm saved preferences appear, orange Apply restored settings, no monitoring before explicit confirmation.
3. Apply once: check restored chat policy, Library policy and export content categories; ensure dates are unchanged and no historical backfill or original downloads occur.
4. Change settings in the original profile and verify .preferences.json is updated; use a second fresh profile to check restoration.
5. Popup Choose Vault opens Settings in side panel; picker from side panel is user initiated. Settings tab remains available.
6. Chrome and Edge: restart, simulate slow/offline network, reconnect Workspace. A Vault permission error does not erase verified Workspace.
7. Export diagnostics during a Vault error: file downloaded even if the live permission probe is stuck; report contains no tokens, paths or chat bodies.
8. Required actions appear orange; ordinary confirmation green, disabled actions neutral; check both themes.
9. Run manual full/selective export and check correct Markdown, ZIP, attachments, project metadata and library files. No automatic extraction of Memory.
10. Do not upload the Web Store candidate before authenticated native browser UAT passes. Cross-profile concurrent writers remain unsupported.
