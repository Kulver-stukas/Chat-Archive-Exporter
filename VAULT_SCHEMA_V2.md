# Vault Schema v2 — rev.6 design and dry-run contract

Status: naming contract and read-only migration planning implemented; v2 persistence and migration execution are NOT active in rev.6. All existing exports still use v1. No new permissions, providers or API endpoints.

## Directory layout

```text
Vault/
  .cae/
    vault.json
    providers.json
    migrations/
  ChatGPT/
    Workspace_Example_User_Business_12345678/
      .cae/
        workspace.json
        containers.json
        chats.json
        resources.json
        sync.json
        preferences.json
        activity-manual.json
        activity-library.json
        transactions/
        writers/
      Project_Name_abcdef01/
        _project.md
        _sources.md
        Existing chat [full-chat-id].md
        Sources/
      _Unassigned/
      _GPTs/
        GPT_Name_abcdef02/
      _Library/
        Generated/
        Uploaded/
      Deleted/
        Projects/
        Chats/
        GPTs/
        Library/
```

The provider name is stable. The workspace folder combines a human-readable label from verified-scope metadata, verified plan or known scope kind, and the first eight characters of its normalized full account ID. Project and GPT directories use their display label and the last eight characters of the normalized full ID. Extend colliding short IDs and check case-insensitive path collisions. Preserve Unicode NFC, normalize whitespace to underscores, replace forbidden filesystem characters and handle Windows reserved names. Short IDs are presentation only. Full IDs identify objects. Continue accepting Vault roots containing spaces. Original Source and existing chat basenames are retained by the migration plan; stale chat titles are review findings, not automatic renames. Do not invent paid plan labels: the legacy configuration may expose only scope type and user name, so Workspace rather than Business can appear as the type suffix. A missing label uses an explicit fallback; never derive identity from an arbitrary folder name.

## Planned authoritative files

| File | Schema identifier | Responsibility |
| --- | --- | --- |
| .cae/vault.json | cae.vault.v2 | vault_id, schema_version=2, migration state |
| .cae/providers.json | cae.providers.v2 | provider IDs, workspace registry and full IDs |
| workspace/.cae/workspace.json | cae.workspace.v2 | provider_id, account_id, identity/display fields, directory, prior locations, migration commit |
| workspace/.cae/containers.json | cae.containers.v2 | typed project/GPT IDs, display_name, directory_name, directory, short_id, previous_directories, evidence and lifecycle |
| workspace/.cae/chats.json | cae.chats.v2 | full conversation ID, typed container ID, actual path, title, remote revision, archive flag, committed bytes/hash |
| workspace/.cae/resources.json | cae.resources.v2 | logical resource ID, original/provider ID and placement, path, committed bytes/hash, lifecycle |
| workspace/.cae/sync.json | cae.sync.v2 | opt-in configuration, enrollment baseline and monitoring state |
| workspace/.cae/preferences.json | cae.preferences.v2 | portable preferences; no handles, tokens or job payloads |
| workspace/.cae/activity-*.json | cae.activity.v2 | portable receipts; detailed jobs remain browser-local |
| workspace/.cae/transactions/ | cae.transaction.v2 | recoverable staged/verified/committed operations |
| workspace/.cae/writers/ | cae.writer-claim.v2 | scoped cooperative writer coordination |

The legacy global index becomes non-authoritative only after the future migration. Retain it for rollback and derive global summaries from workspace indexes. The plan previews registry and paths; its JSON is not a live index and cannot be applied.

Canonical identity is provider + account + type + stable full ID. Project attachment placements include the project ID. A shared resource can have separate retained placements. Canonical metadata keys use semantic roles, not old path-derived keys: workspace:configuration, workspace:personalization, workspace:archive-report, library:inventory, library:download-report, project:<id>:project-metadata, project:<id>:source-inventory. Retain legacy keys as evidence and block divergent aliases. Never adopt an ambiguous identity automatically.

## Identity, revision, placement and lifecycle

A valid checksum does not prove that the file is in the correct folder or that a provider inventory is complete. Moving a chat alone should not fetch or rewrite its body. Distinguish remote unknown / observed / confirmed deleted / detached / superseded and local retained / missing / conflict / purged states; provider archive status is separate. Reserve previous paths and tombstones for rev.9; no new deletion behavior yet.

A legacy YAML header may lack project_id or contain an empty value while the source URL and ledger carry a project ID. Do not equate missing evidence with contradictory IDs. Prefer observed current-scope Chats metadata, requiring explicit container observation to infer removal, otherwise typed ledger, legacy fingerprint, or header evidence. Stale names and incomplete inventories are review findings; do not infer deletion from absence. No Memory or credential extraction. No chat bodies in the exported plan.

## Plan format

cae.vault-migration-plan.v2 contains current account_id, source_prefix, target_prefix, proposed container registry, live-list observation time, reserved directories, planned controls, entries, directory mappings, audit counts, findings and execution requirements. Physical entries include old and proposed paths, action, status, typed index claims, recorded and observed size/hash. Unindexed physical files remain in the plan. The full audit hashes files; the planner reuses an audit checksum if the file's observed size/mtime still match and hashes otherwise. This is not an atomic snapshot. Missing files, pending/incomplete index records, divergent checksums, conflicting identities, unresolved paths and colliding targets block execution. Investigate generated metadata divergence as a writer/recovery problem, not automatically user editing. Keep conflict protection; defer local chat version history, diffs, merges and external-editor write-back.

## Activation requirements (rev.7)

Stop all v1 writers in every browser/profile before any migration. A Vault-wide execution must verify all workspaces, target uniqueness, complete file inventories, hashes and references, plus destination capacity. Never write v1 and v2 concurrently. Copy and verify originals before publishing new indexes. Rewrite controlled metadata and check references transactionally. Retain old data and rollback evidence until verified commit. Recover interrupted operations via the common writer. Only then switch normal export, monitoring, Library and settings writers to v2. Older releases cannot be assumed to recognize a v2 marker. Defer remote lifecycle detection and local purge to rev.9.
