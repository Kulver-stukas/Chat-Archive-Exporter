# Chat Archive Exporter v0.1.6.10 rev.2 — Test report

## Data and design basis

- v0.1.6.10 rev.1 source archive and three user-supplied JSON catalogs from 2026-11-16 (Z_Cat Free: 5 files, Alexblow Free: 60, Business: 475).
- Business report: Library and Images listing complete (27 Library pages, 5 directories; 54 Images), descriptors partial due to the 400-item rev.1 cap (21 skipped); Free: one descriptor HTTP 404. Rev.1 project-folder names alone do not establish Project Source membership.
- New rev.2 structures preserve `file_id`, Library node ID, Project Source reference ID, originating conversation/message IDs and gallery ID as separate identifiers.

## Tests

- All 47 Node JS regression suites passed, including updated Library/Images API mocks and provenance/placement joining tests.
- 6 Chromium/Playwright UI tests passed, including Library context filtering and metadata JSON; no page exceptions or Vault write observed.
- 2 existing browser tests requiring a local HTTP origin were blocked by sandbox policy (`ERR_BLOCKED_BY_ADMINISTRATOR`), not failed assertions against extension behavior.
- Static syntax validation and build archive manifest checks passed.

## Remaining live checks

- Confirm current-scope Projects sidebar + `/backend-api/gizmos/{project_id}` expose matching `file_id`/`library_file_id` for Logos and other Project Sources; monitor `unmatched_project_refs` and `links_status`.
- Check that rev.2's `status=complete` is independent of failed descriptor or Project-link enrichment; compare actual Used/Generated/Unknown counts after new classification.
- Measure latency and response rate of two concurrent descriptors over a large Business Library; watch for HTTP 429 and degraded UI.
- Confirm session-switch abort, panel-close cancellation, and per-workspace isolation on actual signed-in Chrome.
- Verify ZIP/manual chat export and opt-in existing background behavior remain unchanged.

## No expanded access

Library/Images remains read-only and foreground. No downloads of original files, no Vault writes, Memory, Pages, external Drive/OneDrive content, invented URL, or sibling Workspace calls were introduced.
