# Chat Archive Exporter v0.1.9 rev.3 — Image originals and selector polish

## Fixes

- Recognize visible image-generation tool results (`image_gen_title`, image asset pointers with image-generation metadata) on the active conversation branch. Project their original-file references into the selectable assistant output without exporting internal tool text or reconstructing hidden reasoning. The legacy full-archive renderer still omits these tool-only records.
- Resolve verified image file IDs, including legacy `file-...` identifiers, through the existing authenticated conversation-scoped attachment path. Preserve original bytes; choose a supported image extension from binary signature or response MIME when needed. Do not treat an HTML/JSON error response as an image.
- Image-only outputs display available filenames or fallback names rather than a no-text placeholder when an original reference is recognized. ZIP/Markdown selection uses the eligible file references, not just the presence of text.
- While the individual-message selector is open, disable its redundant upper download action, keep the category menu usable and hide Save to Vault. Restore the normal complete-archive actions outside selection mode. The lower action identifies `.zip` or `.md` from the current selection. Before loading the conversation, use a neutral Download label when its format is unknown.
- Move persistent explanatory paragraphs to control tooltips and accessible descriptions. Keep loading, status, validation and errors visible.

## Scope and outstanding work

No new permissions, no Vault format migration, no changes to automatic Vault archive scope. Individual attachment checkboxes are deferred to TODO_v0.1.9.md. Selection remains message-level plus origin-category filters. File names and availability are limited to metadata actually returned for the selected branch; unavailable originals are reported, not fabricated.

Upgrade in the existing unpacked extension directory, reload the extension, then refresh ChatGPT. Manifest numeric version remains 0.1.9; version_name identifies rev.3. See TEST_REPORT_v0.1.9-rev3.md. This is a local test build, not a GitHub release.
