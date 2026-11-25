# Chat Archive Exporter v0.1.9 rev.2

UI-only revision of the v0.1.9 rev.1 selective conversation exporter.

- Collapsed rows show only the first line with ellipsis when necessary; no separate Question/Answer label lines.
- Answers are visually nested by a 15 px horizontal indent; checkboxes remain independent.
- The disclosure arrow expands the question/answer text, with file names and relevant metadata. Thinking never replaces the answer text in a preview, even when Thinking is selected for export and Answers is not. A group without response text displays its file names or an explicit no-text placeholder.
- Selecting Thinking still exports available Thinking according to the existing settings. The grouping, selected message IDs, enabled content categories, eligibility, jobs, binary export, Vault behavior and browser permissions are unchanged.

Upgrade in the existing unpacked extension directory. Reload the extension and refresh ChatGPT. No storage migration or Vault reselection is needed.

See TEST_REPORT_v0.1.9-rev2.md for tests and limitations. No GitHub publication in this revision.
