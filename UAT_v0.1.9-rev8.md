# rev.8 acceptance checks

Use a backup or a separate test Vault, not your production archive.
All writers must run rev.8; do not use older versions against this Vault during the experiment.

1. Update working rev.7 Chrome profile. Verify settings, stored chat counts, export content, source/Library indexes, permissions, cutoff and queue remain intact.
2. Edge: reproduce permission error. Keep Enable background update checked. Click Reconnect Vault or Reselect original Vault; select the exact same folder, preferably from Settings in a tab. Check prior enrollment date, queue, policy, Library and manual jobs. Cancel picker and try a different folder; no active binding may be changed.
3. Verify no automatic permission prompts. After repeated timeout, automatic probes back off. Check version and individual UI/worker/offscreen error names in diagnostic report.
4. Export access diagnostics from popup, panel and settings tab; check completed JSON in Downloads and test Copy diagnostics. If clipboard access is unavailable, manual selection fallback must work.
5. Cross-profile test: use Chrome and Edge against SAME local test directory. Trigger manual export, background update and Library job at overlapping times. Inspect ChatGPT/.chat-archive/writers. A competing writer waits, leaves other marker untouched, and resumes after release. Verify index JSON, retained chat records and checksums.
6. Start a Library inventory in one browser, commit an inventory in the other before the first finishes. First must not replace the later inventory with a stale snapshot.
7. Simulate stale marker ONLY on test Vault. Write operations should wait; no automatic stealing or expiry. Stop both browsers, ensure all extension workers and writers are terminated, then manually remove only stale writer-*.lock files under ChatGPT/.chat-archive/writers. Never delete indexes. Restart one browser and verify retry.
8. Test concurrent starts on repeated runs. This is a cooperative protocol relying on coherent local directory visibility; no support for sync-folder replicas across machines, old versions, manual concurrent filesystem edits or an OS-native lock. Do not enable production multi-writer use until this UAT passes.
9. Review rev.7 restored settings, popup-to-side-panel navigation and color changes; verify Chrome Web Store package only after UAT.
