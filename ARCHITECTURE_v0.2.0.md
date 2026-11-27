# CAE v0.2.0 architecture — rev.3

Baseline: v0.1.9 Beta 2, GitHub commit `c1c166f1248b8f931240e1fb7211c51545e324d1`. Functional parity, not a new feature release. Issue #5 defines the milestone; the UX backlog in #4 is deferred.

## Implemented boundary

| Module | Responsibility |
| --- | --- |
| `contracts/provider.js` | Provider descriptor, declared operations, capability metadata, verified scope and provider-qualified identity, operation facade, provider-neutral registry factory. No network, DOM, Chrome or storage dependencies. |
| `providers/chatgpt/descriptor.js` | The existing ChatGPT host allowlist, declarative bridge file order, API and observer URL semantics, session-to-scope mapping, ChatGPT capabilities. No network requests. |
| `providers/registry.js` | Composition root registering ChatGPT alone, designating it as the legacy provider. |
| `content.js` | Existing isolated content-script RPC, dispatching via the operation facade. Streaming/credential handling stays in the isolated tab. |
| `lib/tab-bootstrap.js` | Browser injection/recovery using the declared provider bridge and allowed hosts, never reloading the tab. |

The UI controller, UI worker, manual jobs, Library jobs and background sync now consume registry eligibility and/or verified-scope helpers. Manifest host permissions are declarative and must still be declared explicitly; tests require exact alignment with the registered ChatGPT descriptor. The watcher and API use provider-specific route functions with the exact legacy parsing behavior (the watcher is more restrictive than the API status recognizer). The fake provider is test-only and no new provider host permissions are added.

### Contract notes

- `ProviderDescriptor`: stable provider ID, display name, allowed hosts, URL recognizer, bridge file list, declared operations, capabilities. The registry rejects duplicate IDs and ambiguous URL matches. The operation facade exposes only declared methods and delegates without altering argument or result shapes.
- `Scope`: existing `accountId`, `observed`, `display`, `currentId`, optionally `providerId` for new adapters. ChatGPT's actual wire result remains byte-for-byte structurally compatible. A legacy scope without an explicit provider is accepted only in the explicitly designated legacy context. A provider mismatch or workspace mismatch fails verification.
- `WorkspaceIdentity`: `{providerId, accountId}`; the transient identity key is an unambiguous JSON tuple. Do not use this key to rewrite existing persisted ChatGPT indexes or storage keys. For legacy jobs the registered legacy provider remains ChatGPT, even if another adapter is registered in a future revision.
- `Conversation`, `Message`, `OriginalReference`, `Page`: documented shape anchors; the existing normalized records and opaque IDs/cursors remain intact. Extraction/rendering separation is implemented in rev.3; full provider-neutral record validation remains for rev.4 or later; generic jobs must not acquire raw provider payload assumptions. File locators are provider-owned and revalidated against workspace, conversation, branch and selected message by the existing API code.
- Capabilities are descriptive in rev.1; no UI toggles or features are added. Scope verification never derives authorization from the URL or a filename. Credentials and signed original URLs remain within the existing isolated content-script transfer path.

### Entry points and upgrades

Classic MV3 scripts are retained; no framework or dependency introduced. Manifest content scripts, service worker importScripts, and Popup/Side Panel/Options HTML explicitly load contracts → ChatGPT descriptor → registry before consumers. Recovery injection uses the exact same ordered bridge files, excluding the independently injected widget as in Beta 2. Offscreen rendering has no provider-registry dependency. Both development and store packaging include new modules. Version changes from 0.1.9 to 0.2.0; reload existing unpacked extension and refresh tabs, do not clear storage.

## Parity discipline

`tests/fixtures/v0.1.9-beta.2-runtime.json` pins baseline runtime/assets and a narrowly reviewed rev.1 delta list. `tests/fixtures/v0.1.9-beta.2-parity.json` was produced by executing the unmodified baseline against synthetic inputs (fixed dates/timezone), not by deriving expected outputs from the new implementation. `tests/parity-capture.js` captures the normalized conversation, complete and selected Markdown, actual selective ZIP member names and decompressed original/report bytes, Vault files/indexes, and a Library catalog with Project Source placements. It deliberately does not compare ZIP container timestamps/compression metadata. `tests/functional-parity.test.js` compares this snapshot without regenerating it. Existing regression assertions remain; fixture dependency loading and the injection script list/frozen-core approved delta list were updated for this architecture.

## Rev.3 adapter extraction

| Module | Responsibility |
| --- | --- |
| `providers/chatgpt/http.js` | Session cache, authenticated read-only backend calls, scope checks, retry/cooldown and request spacing. Instantiated in the isolated tab by the provider API. |
| `providers/chatgpt/api.js` | Existing ChatGPT operations, endpoint selection, enumeration and original resolution/revalidation. Legacy RPC result shapes unchanged. |
| `providers/chatgpt/normalize.js` | Decode raw conversation mapping, active branch, message visibility, ChatGPT citations/math widgets, file pointers and generated-tool images into legacy normalized records. |
| `providers/chatgpt/config-inventory.js` | Provider-specific configuration conversion and page aggregation. |
| `providers/chatgpt/library-inventory.js` | Provider-specific Library/image/Project Source conversion and catalog assembly (the latter remains coupled until rev.4). |
| `providers/chatgpt/original-policy.js` | Original URL allowlist and authenticated/signed URL credential policy. |
| `providers/chatgpt/markdown-profile.js` | ChatGPT presentation labels, default source, sandbox-link recognition. Pure; may be loaded in worker/UI. |
| `lib/markdown-primitives.js`, `lib/markdown.js` | Pure common text helpers and renderer factory over normalized records; no raw provider payload, browser API or endpoint dependency. Provider presentation is supplied explicitly. |
| `lib/export-selection.js` | Existing normalized-record selection and attachment grouping; unchanged. |
| `lib/source-transfer.js` | Shared bounded, backpressured original byte transport; explicit provider authorization callback required before fetch. No provider host/path or credential-routing rules. |
| `lib/normalize.js` | Transitional legacy composition facade for existing render callers and CommonJS tests. Raw decoder is not loaded in worker/UI/offscreen. Old API/config/Library locations are retired runtime paths or compatibility-only shims. |

The ChatGPT content bridge loads the provider-specific HTTP client, decoder and original policy only in its isolated tab context, not in service worker, UI or offscreen. Configuration/Library conversion helpers are also loaded by the legacy job controllers because those controllers still aggregate provider-shaped records; separating that orchestration is rev.4. The generic renderer accepts a presentation profile and consumes normalized messages only. The legacy profile preserves all existing Markdown labels, fallback URLs and generated-file link handling. No change to token/signed URL lifetime or RPC boundary, no new endpoints, permissions or hosts.

## Remaining stages

1. rev.1: provider contracts and registry — complete.
2. rev.2: cumulative v0.1.9 rev.6–8 fixes — complete; exact source snapshot committed to `dev/v0.2` (`1ceb339b286ffe7478fad65b6b71eab27f069296`).
3. rev.3: provider API/HTTP, decoding, configuration/Library and original-policy extraction; common renderer and transfer — implemented in this preview.
4. rev.4: separate provider-specific enumeration/aggregation from generic job lifecycle, browser transport and storage; remove transitional legacy composition dependencies. Preserve persisted records, recovery, legacy Vault paths and workspace isolation.
5. rev.5: decompose UI controllers by view; wire capabilities and normalized application contracts; run complete parity gate and authenticated Chrome/Edge UAT.

No additional provider is implemented. Generic job and Vault orchestration, some normalized legacy fields (including project/GPT and sandbox-file fields), and UI remain coupled to the legacy ChatGPT workflow. They are not claimed to be fully provider-independent. The fake renderer/profile in the boundary test is test-only.

## Rev.2 integration constraints

The legacy provider remains ChatGPT; the Vault guard uses the existing `ChatGPT/.chat-archive/writers` namespace. Before adding other providers, generalize provider-specific paths/identity deliberately rather than changing the existing on-disk schema implicitly. Rev.3 retains the original Beta 2 parity fixture. The only allowed output delta in that synthetic fixture is a precisely asserted +2 fake-filesystem modification-time counter offset for two metadata entries, caused by writer-claim creation.

`tests/fixtures/v0.2.0-rev2-runtime.json` additionally pins the actual rev.2 source archive runtime. `tests/rev3-runtime-parity.test.js` asserts the exact set of changed/added runtime modules and both original Beta 2 fixture hashes. `tests/rev3-adapter-boundary.test.js` tests a renderer without the ChatGPT decoder and a transfer that rejects missing or refused policy.


## Rev.3 hotfix (manifest 0.2.0.4) and storage backlog

Issue #6: an abandoned anonymous writer claim can indefinitely block all workspaces. The compatible hotfix retains the old `writer-*.lock` namespace, adds a persistent profile-local installation ID, uniquely identified operation claims, and automatic removal of prior own claims only under the existing exclusive local Web Lock. This is recovery of the *execution marker*, not deletion of a queued job. Existing file integrity and pending-source recovery rules remain. Foreign and legacy claims require explicit reviewed cleanup after other writers are stopped. Exported diagnostics redact IDs and show ownership, workspace relation, operation, version and age. No automatic timeout-based takeover. A profile cloned with its local storage is not an independent installation.

Issue #7 / TODO: before multi-provider implementation, split authoritative indexes into provider/workspace resources and derive the global inventory; audit lock ordering, shared data and migration. For now the old global mutable index still requires a global guard. The enable-monitoring permission probe is now outside that guard; deeper separation of network operations and disk transactions is deferred to rev.4. Existing provider adapter boundary and persisted archive schemas are unchanged.

Hotfix parity: the original Beta 2 fixture remains unchanged. Its two checked synthetic metadata mtime offsets are now +4 (formerly +2) because each of the two writer claims has a JSON commit in addition to creation. Compared to rev.3, the only output differences are +2 on those two counters. See the hotfix test report.


### Shared Workspace views (rev.3 hotfix 2)

`lib/library-jobs.hydrate` loads the existing account-validated `_Library/_inventory.json` into profile-local display/cache state using a passive snapshot read, not a writer claim. An explicit Files view may subsequently schedule a one-shot incremental metadata check when due. No automatic first inventory, original-file retrieval, or monitor enrollment.

`lib/workspace-activity.js` is a limited presentation receipt layer. `.activity-manual.json` and `.activity-library.json` are account/provider-bound, last-result summaries, published under the existing global writer guard with a reread/compare at commit. They are not job journals or executable checkpoints. Local active jobs remain authoritative. Rev.4 must move these resources into the scoped coordination model (issue #7).
