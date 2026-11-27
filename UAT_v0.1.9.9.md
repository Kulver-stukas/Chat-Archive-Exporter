# Writer recovery UAT (both hotfixes)

Use a backed-up test Vault; install the hotfix in all participating writers.
1. Upgrade the existing unpacked installation in its existing folder; reload extension and tabs. Check enabled monitoring, archived counts, queue, enrollment cutoff and Library. Do not clear extension storage.
2. Close the browser or terminate the extension worker during a real write. Verify a leftover new marker (if present) is removed automatically on the next write by the same installation; queued work and pending original recovery continue. Check index JSON and saved-file checksums. Repeat when closing between claim creation and metadata commit if reproducible.
3. With a legacy anonymous claim or another stopped installation's claim, use Tools / Diagnostics / Review writer claims. Confirm that other writers have stopped, then Clear reviewed locks. Verify no archive indexes or files were deleted. Test a changed snapshot and a local writer already active: clear must refuse.
4. Two browsers on the same local Vault: one writes, the other waits. Repeat across different workspaces. No stale snapshot overwrites, no foreign claim takeover merely after sleep or time elapsed. Resume a browser that was suspended. Do not mix older pre-guard writers.
5. Test diagnostics: ownership/current-other workspace relation/operation/age, no raw IDs, chat content, paths or tokens. Chrome and Edge native sessions remain UAT.
6. Confirm existing Archive/Library/Markdown/ZIP behavior and no change to permissions.
