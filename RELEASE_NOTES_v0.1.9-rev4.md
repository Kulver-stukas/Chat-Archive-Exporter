# Chat Archive Exporter v0.1.9 rev.4

Minor UI-only revision of the v0.1.9 Beta 1 (rev.3) functionality.

- The current-chat selector displays an indeterminate progress bar while fetching messages. Selection/export controls remain disabled while the result is unavailable. The actual message and file counts appear after the response; the conversation API returns one response, so no artificial percentage or partial message count is reported.
- An already opened selective selector automatically follows a different chat in the same verified workspace after tab/SPA navigation and a 300 ms debounce following reconnection. The former message choices are cleared immediately; the newly loaded eligible messages are selected by default. Explicit Refresh preserves existing choices when the same conversation and branch are reloaded.
- Superseded replies and stale popup intents cannot populate a selector for another chat. A different workspace requires a new explicit Refresh. No automatic export, Library scan or file download is triggered. The selector only follows navigation while its Current view is visible and Complete conversation is off.
- The message list now grows to fill the remaining side-panel height, rather than being capped at 45vh. Export controls remain visible in ordinary windows. Very short windows retain scrolling so controls stay accessible.
- No changes to archival algorithms, Vault paths, permissions, provider requests or the worker. Numeric manifest version remains 0.1.9; version_name identifies rev.4 for unpacked-extension testing.

Install by replacing files in the existing unpacked folder and clicking Reload. The release on GitHub remains v0.1.9-beta.1 until this revision is tested.
