# Chat Archive Exporter v0.2.0 rev.2 — architecture preview

Date: 2026-11-27. Manifest version: `0.2.0.2`.

Base: the supplied v0.2.0 rev.1 source archive; cumulative fixes from v0.1.9 Beta 2 (`c1c166f1248b8f931240e1fb7211c51545e324d1`) to v0.1.9 rev.8 (`3489a3d24f962dcbcc16a0e0cbb9bf02daa10ef5`). The latter was reported working in real use by the user. This is an integration revision, not a new provider implementation.

- Workspace recovery by verified account ID, existing Vault detection and portable preference restoration.
- Recover the original Vault directory while monitoring stays enabled, after checking directory identity. Preserve enrollment date, policies, queued work and accepted jobs. Reject a different directory during active monitoring or jobs.
- Bounded/coalesced permission checks and diagnostics, explicit reconnection, verified diagnostics download and clipboard/text fallback.
- Cooperative shared Vault writer claims, fresh index loading under the guard, newer conversation revision preservation and stale Library inventory rejection. No automatic deletion of stale writer claims.
- Retain provider contract, registry, legacy ChatGPT descriptor, capability declarations and RPC facade; use the existing verified-provider checks for adapted routes. No new host permissions, provider support or archive migration.
- Preserve the original golden fixture and the existing regression assertions, with narrowly reviewed integration deltas. The deeper provider extraction previously planned for rev.2 is deferred to rev.3 or later.

The cooperative guard assumes shared visibility of one local filesystem and participating extension versions. It is not a transactional database or distributed lock for cloud replicas. Older versions without the guard cannot participate safely in concurrent writing. Stop every writer before manually clearing a stale claim. No live authenticated browser validation of this integrated build has been performed. See TEST_REPORT and UAT.
