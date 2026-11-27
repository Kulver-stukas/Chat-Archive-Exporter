# CAE v0.2.0 architecture — rev.2

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
- `Conversation`, `Message`, `OriginalReference`, `Page`: documented shape anchors; the existing normalized records and opaque IDs/cursors remain intact. Full record validation and extraction/rendering separation belong to rev.3 or later; generic jobs must not acquire raw provider payload assumptions. File locators are provider-owned and revalidated against workspace, conversation, branch and selected message by the existing API code.
- Capabilities are descriptive in rev.1; no UI toggles or features are added. Scope verification never derives authorization from the URL or a filename. Credentials and signed original URLs remain within the existing isolated content-script transfer path.

### Entry points and upgrades

Classic MV3 scripts are retained; no framework or dependency introduced. Manifest content scripts, service worker importScripts, and Popup/Side Panel/Options HTML explicitly load contracts → ChatGPT descriptor → registry before consumers. Recovery injection uses the exact same ordered bridge files, excluding the independently injected widget as in Beta 2. Offscreen rendering has no provider-registry dependency. Both development and store packaging include new modules. Version changes from 0.1.9 to 0.2.0; reload existing unpacked extension and refresh tabs, do not clear storage.

## Parity discipline

`tests/fixtures/v0.1.9-beta.2-runtime.json` pins baseline runtime/assets and a narrowly reviewed rev.1 delta list. `tests/fixtures/v0.1.9-beta.2-parity.json` was produced by executing the unmodified baseline against synthetic inputs (fixed dates/timezone), not by deriving expected outputs from the new implementation. `tests/parity-capture.js` captures the normalized conversation, complete and selected Markdown, actual selective ZIP member names and decompressed original/report bytes, Vault files/indexes, and a Library catalog with Project Source placements. It deliberately does not compare ZIP container timestamps/compression metadata. `tests/functional-parity.test.js` compares this snapshot without regenerating it. Existing regression assertions remain; fixture dependency loading and the injection script list/frozen-core approved delta list were updated for this architecture.

## Remaining stages (not implemented in rev.1)

1. rev.2: integrate the cumulative v0.1.9 rev.6–8 fixes without expanding the provider boundary.
2. rev.3: relocate ChatGPT HTTP/payload parsing, original location policy, configuration/library conversion into provider modules; extract pure Markdown/selection and common bounded byte transfer. Keep the parity fixture stable.
3. rev.4: separate provider-specific enumeration from generic job lifecycle, browser transport and storage. Keep persisted records, job recovery, legacy Vault paths and workspace isolation intact.
4. rev.5: decompose UI controllers by view; wire capabilities and normalized application contracts; run complete parity gate and authenticated Chrome/Edge UAT.

This revision does not make the entire application provider-independent: `lib/api.js`, `lib/normalize.js`, metadata/Library normalization, Vault layout and several orchestration details still contain ChatGPT-specific implementation. The contract is deliberately introduced before relocating those details. No claim of support for another provider, native Spaces/Pages/Sites, or all API limitations.

## Rev.2 integration constraints

The legacy provider remains ChatGPT; the Vault guard uses the existing `ChatGPT/.chat-archive/writers` namespace. Before adding other providers, generalize provider-specific paths/identity deliberately rather than changing the existing on-disk schema implicitly. Rev.2 retains the original Beta 2 parity fixture. The only allowed output delta in that synthetic fixture is a precisely asserted +2 fake-filesystem modification-time counter offset for two metadata entries, caused by writer-claim creation.
