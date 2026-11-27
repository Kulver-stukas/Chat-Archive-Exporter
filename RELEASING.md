# Release procedure

## Branches

- `v0.1`: maintenance baseline for the completed 0.1 feature line, including future necessary bug/security fixes.
- `main`: current public source until a successor is explicitly promoted.
- Development of v0.2 and subsequent provider adapters is separate from the published v0.1 baseline.
- `release/v<manifest-version>`: immutable publication branch for each intended store version. Keep historical beta tags and assets unchanged.

## Chrome Web Store and GitHub

Store listing: https://chromewebstore.google.com/detail/chat-archive-exporter-bet/jpnelmkbbgpjfnpldfecjffhidffdpjb

1. Allocate a new monotonically increasing numeric `manifest.json` version for each new store upload. Preserve the release's source commit and record the human-readable revision in the release notes.
2. Run all Node regression suites, relevant browser fixture checks and authenticated user acceptance tests. Record actual results and limitations.
3. Add `release-notes/v<manifest-version>.md`, update the changelog and README, and create `release/v<manifest-version>` at the exact intended release commit. The existing Publish extension pre-release workflow checks the tag against the manifest, runs regression tests and creates the tagged GitHub beta with install, source and store packages. Do not reuse tags or replace an already published release's assets.
4. Submit the matching `-webstore.zip` to the Chrome Web Store through the developer dashboard. Prefer that exact GitHub asset; record the commit, version and submission/approval status. The store approval step is manual and is not inferred from successful GitHub CI.
5. When the store version is actually published, verify that its numerical version corresponds to the GitHub release and record the confirmed status (and date, if known) in the release notes or release tracking documentation. If a version is already live and has no GitHub release, recover the exact submitted source/build before publishing the matching release; do not label an unverified reconstruction as identical.

Every version distributed through the store must have a corresponding immutable GitHub release. Development test ZIPs need not become store releases. Existing Beta 1 and Beta 2 releases remain available. The beta designation is retained until a deliberate production-release decision; a GitHub pre-release is still a published release with a tag and downloadable assets.
