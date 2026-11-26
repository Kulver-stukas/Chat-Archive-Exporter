# Chat Archive Exporter v0.1.9 rev.5

UI-only follow-up to rev.4, before v0.1.10.

- Widget opens directly in short monitor mode; there is no minimized bubble or minimize button. Close, dragging, automatic status refresh and short/expanded logs remain. The toolbar REC/IDLE/WARN status is unchanged.
- Refresh and Download actions are removed from the widget. Chats, Files and Settings remain navigation shortcuts, opening their respective views inside the existing side panel. Choosing a different Vault may still require the existing persistent directory-picker surface.
- Native browser tooltips cover static and dynamically generated UI buttons and relevant settings controls; redundant explanatory paragraphs are moved to the corresponding tooltips. Real status, errors, file availability and important prerequisites remain visible. Native tooltip display depends on the browser.
- The new Files shortcut in the message selector replaces the current selection with eligible logical message rows containing file/image references allowed by the existing Uploaded files and Generated files categories. The button is disabled if no such row exists. Text and Thinking settings remain unchanged. For file-only output, disable the three text categories in the dropdown. Individual attachment checkboxes remain in TODO.
- No new permissions, API changes, changes to archive job engines or Vault format. The numerical manifest version remains 0.1.9, with version_name indicating rev.5.

## Install

Replace files in the existing unpacked extension folder, reload in chrome://extensions and refresh ChatGPT. Do not clear the Vault or extension storage. This revision is not yet published to GitHub.
