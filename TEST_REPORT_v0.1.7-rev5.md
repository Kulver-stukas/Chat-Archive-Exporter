# Chat Archive Exporter v0.1.7 rev.5 - Test report

## Intent

Close an accepted **browser download** manual job when Chrome reports an explicit user cancellation. The chat text or ZIP may have been prepared in IndexedDB, but no **completed** browser download is reported. The result must not be marked as saved, block future manual exports, or be retried automatically.

## Implementation

- `lib/manual-jobs.js`: terminal `completed_not_saved`, `deliveryOutcome=user_cancelled_save`, clears the staged payload, preserved historical prepared count, and explicit current-job migration from pre-rev.5 `download_failed` on worker startup.
- `ui/state.js`: neutral human label, non-running state and no spurious Needs attention.
- `panel.js`: distinguishes *prepared* from *saved*, no Retry and no Stop control, explicit no-file-saved explanation.
- No changes to Vault export, workspace identity, background monitoring, source/archive paths, permissions or provider APIs.

## Tests run

- **57 / 57 Node.js `.test.js` suites passed**, including new `manual-user-canceled-save.test.js`.
- Regression scenarios: single-chat `.md`; multi-chat `.zip`; rejected `chrome.downloads.download` with explicit user cancellation; external `NETWORK_FAILED` preserving bytes and explicit Retry; old retained `USER_CANCELED` job migrated on worker restart; extension Stop remains distinct; subsequent Vault job succeeds.
- UI/browser synthetic Chromium: **10/10** Popup/Side Panel scenarios, widget scenario and two existing pending-download chat-list scenarios passed.
- Frozen core integrity: **all original modules unchanged except one explicitly approved maintenance exception** (`lib/manual-jobs.js`); original `worker.js` prefix unchanged and no extra permissions.

## Remaining live UAT

Run in Chrome with **Ask where to save each file before downloading** enabled. Cancel Save for (a) current-chat Markdown, (b) selected-chats ZIP. Confirm `Prepared, not saved`, idle/monitoring indicator, no Retry/Stop, and ability to immediately start another job. Verify external download interruption still exposes Retry, and Vault exports are unaffected. Chrome's download events do not prove absence of a partially created OS-level temporary file; the extension does not claim to inspect the filesystem for one.
