# v0.2 engineering backlog

The v0.1 maintenance line is frozen. Apply subsequent fixes and provider architecture work to v0.2 only; promote a tested v0.2 version to the Chrome Web Store when ready.

## Storage and jobs (issue #7)

- [x] Introduce a logical provider / workspace / resource identity and overlap contract (`contracts/resources.js`), and include scoped resource keys in writer-claim metadata.
- [x] Extract the legacy ChatGPT storage layout, revision policy, and resource paths into the provider adapter. Separate job RPC mapping and major provider-specific enumeration/inventory phases from the common lifecycle.
- [ ] Complete remaining provider-shaped job metadata/attachment/source policies and replace transitional single-provider composition with explicit provider injection.
- [ ] P0: design and implement per-provider/workspace authoritative mutable source and metadata indexes. Global index becomes a rebuildable derived view; audit all legacy readers/writers before changing the authority.
- [ ] P0: migration and rollback of existing archives. Promoted into the current refactoring; preserve paths, index schemas and checksums until migration is designed and independently tested.
- [ ] P0: activate resource-granular locking after removing shared mutable-index dependencies; coordinate only overlapping resources; unknown/legacy claims fail closed. Retain local Web Lock and cross-profile guard until then.
- [ ] P1: move remote captures outside disk transactions; revalidate target revision, workspace identity and resource claims before commit. Preserve crash recovery, spool and pending-source semantics. Do not shorten the current transaction by releasing the lock while a stale mutable global-index snapshot can still be committed.
- [ ] Test external Vault contention and recovery in authenticated Chrome/Edge, provider and workspace isolation, migration rollback, and concurrent disjoint-resource commits before adding another provider.

## UI (after storage prerequisites; issues #5, #9, #10)

- [x] Chats: derive `archived` from the saved current Vault revision, including background exports, independently of the provider archive flag. Keep uncertain results in All chats; show older revisions as update pending.
- [ ] Confirm Chats behavior on existing archives in two real profiles (issue #9).
- [ ] Decompose UI controllers by view; consume provider capabilities and normalized application state rather than provider-specific internals.
- [ ] ATT: orange badge and `!` icon when user intervention is necessary. Higher priority than ordinary processing or waiting.
- [ ] STOP: red badge and square stop icon while pending unsaved writes wait for another installation's Vault writer claim. Automatic retry; not monitoring disabled. Stale-claim review may escalate to ATT if user action becomes necessary.
- [ ] Neutral grey for ordinary inactive/waiting states without pending unsaved writes or intervention; keep REC for actual active recording. Red denotes pending unsaved work without mandatory intervention, not simply enabled monitoring. Confirm exact mapping for mixed tasks, other errors and recovery; use text/accessible labels in addition to color. Apply consistently to browser action, Side Panel and related status surfaces.
- [ ] Regression/UAT for precedence, light/dark appearance, writer contention and recovery; retain existing state until this UI task is implemented.

## Vault architecture refactoring — revised sequence (2026-11-28)

The following work supersedes the earlier UI-first sequence. Keep the existing Vault readable and protect existing user content. Revision numbers are planning targets, not released versions.

| Revision | Scope |
| --- | --- |
| rev.5 | Read-only Vault Integrity and write-pipeline audit; durable per-item manual export outcomes, selected IDs/counts, target paths and skip reasons. |
| rev.6 | Vault Schema v2; shared identity/naming resolver; authoritative container registry; combined human-readable + stable short-ID directory names; migration plan and rollback. Reserve the workspace-level Deleted namespace and lifecycle/tombstone fields. |
| rev.7 | Common Vault Writer; crash-safe transactions, verified moves, index recovery and scoped writer coordination. |
| rev.8 | Enrollment (including All chats), actual file evidence versus tracked/indexed status, missing-file recovery and redundant-write investigation; UI corrections. |
| rev.9 | Deleted / unavailable object lifecycle and selective local cleanup (separate feature below). |
| rev.10 | Final multi-profile Chrome/Edge UAT, including migration, deletion/restoration and existing functional parity before additional providers. |

- [ ] Use the same verified provider display metadata in Chats and folder-name resolution. Workspace folders follow `Workspace_{Name}_{Type}_{ShortID}` where those fields are available; projects/GPTs follow `{DisplayName}_{ShortID}`. Preserve Unicode, normalize whitespace to underscores, handle reserved names, forbidden characters, path-length and case-insensitive collisions; extend short IDs on collision. Store full IDs as authoritative keys. Do not guess a workspace name or plan type, and do not create another directory solely because the display label is temporarily unavailable. Static structural directories have no ID suffix.
- [ ] Audit/reconcile physical files and both legacy global and local workspace indexes. Detect split project folders, chats whose current container differs from their stored path, missing/unindexed/duplicate/locally modified files, pending transactions and writer claims. Distinguish provider-native project and GPT IDs; prevent repeated ID suffixes. Preserve source original bytes and historical snapshots. Perform a dry run, verify copied bytes and references, retain originals until verified commit, and prevent legacy writers from running during migration.
- [ ] Add regression fixtures for both a populated multi-workspace Vault and a small test Vault. Fixtures must be synthetic or sanitized; do not commit real user chat titles/content, account IDs, inventories, or personal paths.

## Deleted objects / local archive cleanup (rev.9; deferred implementation)

- [ ] Reserve a visible `Deleted/` directory in every workspace in Schema v2, with original container/resource hierarchy inside (e.g. `Deleted/Projects/{ProjectName}_{ShortID}/Sources/`, `Deleted/Chats/_Unassigned/`, `Deleted/Library/Generated/Images/`). Exact static subdirectory names are a design detail; ensure a removed project and a removed individual source can coexist without overwriting one another. No automatic purging.
- [ ] Track remote lifecycle separately from local file state and provider archive flags. Distinguish confirmed remote deletion, removal/detachment from a container, replacement, inaccessible/unknown and absent from a complete inventory. A missing entry in a partial/failed/paginated scan, HTTP/auth failure, account switch or a provider-archived chat is not evidence of deletion. Treat each provider's evidence according to its supported semantics; use repeated complete observations or stronger verified evidence before moving files.
- [ ] Generalize legacy per-project `deleted/` source quarantine into one workspace-level retained archive; preserve previous paths, full IDs, original associations, last-seen / first-confirmed-absent times, reason/evidence, hashes, size and local state. Migrate legacy quarantines losslessly; do not silently drop locally edited files, overwrite collisions, or follow another workspace's resources. Keep other placements of a detached shared source intact.
- [ ] Use the common writer's verified copy/commit/remove and recovery protocol; prevent automatic monitor re-enrollment or duplicate download while an object remains deleted, and reconcile reappearing objects by ID without overwriting local changes. Keep a minimal tombstone after explicit local purge so stale jobs cannot resurrect the file. Local restore / reappearance does not imply restoration at the provider.
- [ ] Add a Deleted/Trash view (e.g. a trash icon beside Tools) modeled on Chats: tree grouped by workspace/container/resource type, search and filters, checkboxes, sizes and dates/reasons, open local copy and selective permanent local deletion with explicit confirmation and per-item result. No automatic emptying, no remote delete actions; show impacted references before purging and retain shared bytes until no retained references require them.
- [ ] Test individual chat/source/library-item deletion, whole-project removal, source detach with other placements intact, archived chat, partial inventory / API error, locally modified file, reappearance, collisions, interrupted move, selective purge, cross-workspace isolation and Obsidian visibility. Preserve history and do not confuse archive status with deletion.

No new providers or extra permissions in the architecture-only v0.2.0 milestone. No account/project Memory extraction.
