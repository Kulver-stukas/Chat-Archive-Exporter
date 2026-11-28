# rev.6 test report

Executed using the available JavaScript engine against fetched production modules and synthetic read-only handles:

- 32 v2 assertions passed: workspace/project ID collisions, Unicode/Windows naming, GPT fallback, project merge/move, explicit removal, source filename and canonical resource/metadata identity, control conversion, legacy header evidence, scope isolation, Deleted reservation, pending/unindexed/divergent evidence, writer claims, changed indexes, cancellation and pause setting.
- Six existing Vault Integrity synthetic scenarios passed.
- 19 UI/settings/wiring assertions passed on the actual extracted UI helper, portable-preference sanitizer, markup, and manifest.
- Relevant modified JavaScript and test sources passed engine parsing.

Full Node and Chrome/Edge regression suites were NOT executed. Local GitHub clone is blocked by DNS; connected repository tools expose source text but not a runnable local checkout. No real Vault files were modified, and no private diagnostics were committed. The v2 migration executor and rollback remain unimplemented. This is a diagnostic schema preview, not a validated release.
