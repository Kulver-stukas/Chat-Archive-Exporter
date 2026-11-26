# Privacy Policy — Chat Archive Exporter

Effective: November 26, 2026. Applies to Chat Archive Exporter BETA v0.1.9 and its current local archiving features. Independent developer: Kulver-stukas.

## Purpose and data accessed

The extension's single purpose is to let you export and maintain a local archive of content and related configuration available to your signed-in ChatGPT workspace. It supports user-initiated downloads, a user-selected local Vault directory, and optional background archive maintenance. It does not provide an AI service or a hosted archive.

To perform these functions, it handles:

- Account and workspace identifiers, display names and, where returned by the session, account email; conversation and project identifiers, URLs, titles, times and model metadata.
- Your conversation text, including user messages, assistant responses, available user-visible Thinking, and citations; uploaded or generated files and images when available and within the selected export scope. These may contain personal, confidential or other sensitive information.
- Library and image inventory, file descriptors, project source references, user-authored project instructions and personalization, available schedule instructions/settings, installed plugin and bundled skill metadata, and connector reference metadata when the relevant archive/snapshot operation runs. The extension does not request or archive account or project Memory, or fetch connected-drive originals as part of those inventories.
- Your existing ChatGPT session authentication (including session access token and device/session identifiers where provided) solely to make authorized requests within the signed-in web session. The token is used in the isolated ChatGPT content-script context; it is not intentionally persisted in extension storage, included in exported files or forwarded to the developer. The extension never asks for your password.
- Operational preferences, local directory handles, job status, archive indices, hashes and diagnostic events. Some diagnostic logs may include chat/project titles and other local archive metadata.

## How data is used and stored

Data is processed in the browser for the archive features you choose. A session check and workspace binding may occur when you open a ChatGPT tab or interact with the extension, to display the current context and prevent writes to the wrong workspace. Manual actions request the selected data; full workspace snapshots and enabled background maintenance may include the configuration categories described above. Background chat updates are off until enabled; Library metadata monitoring requires a first manual inventory and can be turned off. Library original-file downloads require explicit selection. No automatic export to a developer-operated server occurs.

The extension uses Chrome local/session storage and local IndexedDB for settings, cached metadata, archive state and temporary/staged data. If you choose a Vault, files are written to the selected directory under its permission. Downloads are saved through the browser. Temporary data is retained where necessary to resume an interrupted operation, and cleared as jobs complete or are discarded. Local archives persist until you remove them. Browser storage and Vault are not encrypted by this extension; protect them using your own OS/browser settings.

## Network requests and disclosure to others

Requests use HTTPS to ChatGPT's web service and, for requested originals, supported storage URLs returned by that service (for example oaiusercontent.com and Azure blob storage). Authentication headers are restricted to the relevant ChatGPT origin. These providers already host or deliver the requested content; their own terms and privacy policies apply. The extension has no developer-operated backend, advertising, analytics or telemetry service; it does not sell, rent, or transfer your archive to advertisers, data brokers or the developer. If you save to a cloud-synchronized folder, share a file or voluntarily provide a diagnostic report in a support request, that is your own choice and the destination's policies apply. Do not submit private content, credentials or signed URLs in public bug reports.

## Controls, retention and deletion

You choose what to export and where to save it. In Settings you can pause background monitoring and restore or revoke directory access using browser controls. You can stop or cancel pending exports using Activity. Remove downloaded files or Vault files yourself when no longer needed; clearing extension storage or uninstalling removes browser-held extension state but does not delete your exported files. Back up any pending data first. Removing or reinstalling a store version may use a different extension identity and require selecting/authorizing the Vault again.

## Limited Use and contact

The use of information obtained through Chrome APIs is limited to the disclosed local archive purpose and related operational requirements. The developer does not use that information for advertising, profiling, credit decisions, or unrelated purposes. This extension's use and transfer of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

This is independent software, not affiliated with OpenAI. It uses undocumented web endpoints; service terms and workspace rules may restrict automated extraction. Use only where you are authorized to archive the data. For privacy questions or security reports, contact the developer through the repository's contact/support facilities: https://github.com/Kulver-stukas/Chat-Archive-Exporter/issues (do not include confidential data in a public issue).
