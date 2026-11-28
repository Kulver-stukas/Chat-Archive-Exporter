# v0.2.0 rev.4 — job, transport and storage boundaries

Manifest 0.2.0.6. ChatGPT-only unpacked architecture preview; no store publication and no v0.1 backport.

- Extract manual context planning/projection, background inventory and Library scan phases to the ChatGPT adapter; retain durable common lifecycle and recovery.
- Introduce profile-injected semantic job transport and a storage profile for legacy path/revision policy; explicit provider/workspace/resource identity and resource metadata in writer claims.
- Fix Chats badge/filter (issue #9): archived is the current indexed Vault revision, not ChatGPT's remote archive flag, regardless of manual/background export. Outdated copies show update pending; unknown currency is not falsely classified. The view is metadata-only, not a physical file integrity audit.
- Preserve all existing archive paths, schemas, local queues, buffer, settings and permissions. Keep shared-index locking conservative; physical index separation, migration, fine-grained lock acquisition and deeper remote/disk transaction separation are deferred (#7).
- Record ATT/STOP indicator design in TODO_v0.2.md / issue #10, for UI work in rev.5. No new badge states in rev.4.

Upgrade the existing unpacked extension directory, reload the extension and refresh ChatGPT. Do not clear profile storage or Vault. See UAT_v0.2.0-rev4.md and TEST_REPORT_v0.2.0-rev4.md.
