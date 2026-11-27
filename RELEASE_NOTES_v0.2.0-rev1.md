# v0.2.0 rev.1 — provider contracts and registry

First internal architecture-preview build based on the published v0.1.9 Beta 2. Only ChatGPT is supported. No new UI controls, export formats, permissions, storage migrations or provider hosts.

- Provider-neutral descriptor, operation facade, capability and scoped identity contracts.
- Centralized ChatGPT host eligibility, scope mapping and distinct API/observer route parsing.
- Shared registry used by the existing UI, tab recovery, manual and background jobs; isolated content bridge now delegates through the declared provider operation facade.
- Explicit module load order in all consuming entrypoints and both package scripts. Existing archive paths, IndexedDB/storage keys, RPC wire formats and job schemas preserved.
- Baseline snapshots for subsequent parity work and tests of a fixture-only second provider.

Upgrade by replacing files in the same unpacked extension folder, reloading the extension, and refreshing the ChatGPT tab. Back up the prior extension folder and existing Vault before a development upgrade. Do not uninstall or clear extension storage. The store and GitHub release are unchanged.

See `ARCHITECTURE_v0.2.0.md` and `TEST_REPORT_v0.2.0-rev1.md`. Full normalization/export, jobs/storage and UI decomposition is deferred to rev.2–rev.4. Real authorized Chrome/Edge UAT remains necessary.
