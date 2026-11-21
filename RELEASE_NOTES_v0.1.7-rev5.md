# Chat Archive Exporter v0.1.7 rev.5 - Browser Save cancellation

## Behavior change (user-requested maintenance exception)

When Chrome's **Always ask where to save files** dialog is dismissed without saving, both single-chat Markdown exports and multi-chat ZIP exports end in `completed_not_saved`. The chat selection may have been fully prepared, but the extension **does not claim the download was saved**. Temporary staged blobs are cleared, the job becomes terminal, and a new manual export can start immediately. The UI presents **Prepared, not saved** and does not offer Retry for this state.

The same terminal behavior is applied when `chrome.downloads.download()` explicitly rejects due to user cancellation. Existing pending rev.4 jobs with a current `download_failed` message indicating `USER_CANCELED` are migrated on worker startup; earlier unrelated log entries cannot trigger this migration.

**Do not conflate these cases:**

| Event | Terminal state | Staged data | New manual export |
| --- | --- | --- | --- |
| Browser reports complete | `completed` or `completed_with_warnings` | Cleared | Allowed |
| User cancels browser Save dialog | `completed_not_saved` | Cleared | Allowed |
| Extension Stop export | `cancelled` | Cleared after stopping | Allowed |
| Network/disk/policy failure | `download_failed` | Retained for explicit Retry | Not until resolved/stopped |
| Delivery cannot be verified | `delivery_uncertain` | Retained | Not until resolved/stopped |

### Scope

- Only the manual **browser download** destination (current chat .md or selected chats .zip).
- No change to manual **Vault** destination, existing Vault paths/indexes, Project Sources, Library/Images, workspace scoping, network calls, download limits, or permissions.
- An explicit, narrow maintenance modification to `lib/manual-jobs.js` is the only change to the frozen v0.1.6.11 core. All other archive modules are SHA-256-identical to the frozen baseline.
- Real Chrome UAT is required to verify how a particular browser version reports Save-dialog cancellation.
