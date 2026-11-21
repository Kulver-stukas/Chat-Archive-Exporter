# v0.1.7 rev.4 — Pending-download chat-list recovery

UI-only bug fix on top of v0.1.7 rev.3. Archive engines remain frozen at v0.1.6.11 rev.1.

## Cause

When the browser Save dialog is canceled, the manual delivery controller records `download_failed` and keeps `active: true` so the staged ZIP can be retried. The v0.1.7 Side Panel incorrectly returned early from `ensureListLoaded()` for **every** active manual job. This blocked both the saved Vault chat list and the live `CAE_LIST` request in that workspace. The canceled download state never meant ChatGPT listing or Vault access had failed.

## Correction

- Chat-list cache and live API enumeration are read-only and are no longer blocked by a retained manual job.
- The explicit **Refresh chat list** button remains available during a retained delivery, but the request still uses verified workspace identity.
- Manual job submission/Retry/Stop, staged ZIP bytes, archive data, Vault schema, background monitoring, permissions and source export code are unchanged. Starting another manual export while a pending job is retained is still prohibited by the original worker.
- Existing UI summary distinguishes a canceled browser Save dialog from a Vault permission failure.

## Verification

- Chromium regression reproduces an active `download_failed` job before opening Chats, then demonstrates both a cached list before API response and a cold API-only list without a saved cache.
- Existing Node.js tests and browser smoke suites should be run with this rev.4 build before installation.

## Operational workaround on rev.3

From Activity, click Stop export to discard the pending delivery, or Retry delivery if you need the ZIP. This removes the blocker but may discard staged bytes if stopped. Rev.4 does not require either action merely to browse the chat list.
