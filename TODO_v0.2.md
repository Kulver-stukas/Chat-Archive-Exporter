# v0.2 engineering backlog

The v0.1 maintenance line is frozen. Apply subsequent fixes and provider architecture work to v0.2 only; promote a tested v0.2 version to the Chrome Web Store when ready.

## Storage and jobs (issue #7)

- [x] Introduce a logical provider / workspace / resource identity and overlap contract (`contracts/resources.js`), and include scoped resource keys in writer-claim metadata.
- [x] Extract the legacy ChatGPT storage layout, revision policy, and resource paths into the provider adapter. Separate job RPC mapping and major provider-specific enumeration/inventory phases from the common lifecycle.
- [ ] Complete remaining provider-shaped job metadata/attachment/source policies and replace transitional single-provider composition with explicit provider injection.
- [ ] P0: design and implement per-provider/workspace authoritative mutable source and metadata indexes. Global index becomes a rebuildable derived view; audit all legacy readers/writers before changing the authority.
- [ ] P0: migration and rollback of existing archives. Deferred by design; preserve paths, index schemas and checksums until migration is designed and independently tested.
- [ ] P0: activate resource-granular locking after removing shared mutable-index dependencies; coordinate only overlapping resources; unknown/legacy claims fail closed. Retain local Web Lock and cross-profile guard until then.
- [ ] P1: move remote captures outside disk transactions; revalidate target revision, workspace identity and resource claims before commit. Preserve crash recovery, spool and pending-source semantics. Do not shorten the current transaction by releasing the lock while a stale mutable global-index snapshot can still be committed.
- [ ] Test external Vault contention and recovery in authenticated Chrome/Edge, provider and workspace isolation, migration rollback, and concurrent disjoint-resource commits before adding another provider.

## UI (rev.5; issues #5, #9, #10)

- [x] Chats: derive `archived` from the saved current Vault revision, including background exports, independently of the provider archive flag. Keep uncertain results in All chats; show older revisions as update pending.
- [ ] Confirm Chats behavior on existing archives in two real profiles (issue #9).
- [ ] Decompose UI controllers by view; consume provider capabilities and normalized application state rather than provider-specific internals.
- [ ] ATT: orange badge and `!` icon when user intervention is necessary. Higher priority than ordinary processing or waiting.
- [ ] STOP: red badge and square stop icon while pending unsaved writes wait for another installation's Vault writer claim. Automatic retry; not monitoring disabled. Stale-claim review may escalate to ATT if user action becomes necessary.
- [ ] Neutral grey for ordinary inactive/waiting states without pending unsaved writes or intervention; keep REC for actual active recording. Red denotes pending unsaved work without mandatory intervention, not simply enabled monitoring. Confirm exact mapping for mixed tasks, other errors and recovery; use text/accessible labels in addition to color. Apply consistently to browser action, Side Panel and related status surfaces.
- [ ] Regression/UAT for precedence, light/dark appearance, writer contention and recovery; retain existing state until this UI task is implemented.

No new providers or extra permissions in the architecture-only v0.2.0 milestone. No account/project Memory extraction.
