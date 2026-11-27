# Chat Archive Exporter v0.2.0 rev.3 — architecture preview

Manifest: `0.2.0.3`. Based on the user-tested rev.2, GitHub `dev/v0.2` commit `1ceb339b286ffe7478fad65b6b71eab27f069296`.

- Provider-owned ChatGPT HTTP client, raw conversation decoder, API and inventory conversion, original URL/credential policy, and presentation profile.
- Shared pure Markdown renderer, unchanged selection policy and bounded byte transfer. The renderer accepts a provider profile; the transfer rejects missing/denied policies before network access.
- No changes to existing RPC messages, provider endpoint selection, persisted archive formats, permissions, Vault binding/recovery, writer claims, Library policy or monitoring engines. No new providers or features.
- Transitional compatibility facades and legacy job-facing aliases remain until rev.4. The Library catalog assembly and configuration page aggregation still reside in the ChatGPT adapter. The full application is not yet provider-independent.

For upgrades, replace the contents of the same unpacked extension folder and reload it; refresh ChatGPT. Do not clear existing IndexedDB or Vault. Use a test Vault or backup. Native authenticated Chrome/Edge UAT of this preview is pending. No release or Chrome Web Store upload.
