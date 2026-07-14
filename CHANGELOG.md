# Changelog

Notable changes to runAlert are documented here. The project follows semantic
versioning.

## [1.0.0] - Unreleased

### Added

- Anonymous revisioned web/desktop configuration sync backed by a clean Supabase
  schema.
- Single-use, ten-minute `runalert://` pairing links and a manual fallback code.
- Offline edit queues, explicit conflict resolution, and JSON recovery exports.
- Sandboxed Electron desktop shell with supervised monitoring and OS-encrypted
  credentials.
- Universal signed/notarized Mac packaging, background updates, and Microsoft
  Store x64 AppX automation.
- Stable release manifest, adaptive system-like UI, accessibility coverage, and
  deterministic visual regression tests.

### Changed

- Standardized development, CI, and production on Node 24.
- Replaced beta query-token and script-installer flows with bearer credentials
  and signed desktop destinations.
- New users now start with an empty streamer list.

### Security

- Added strict configuration validation, request limits, throttling, security
  headers, log/analytics redaction, hardened Electron navigation, and fail-closed
  production sync.

[1.0.0]: https://github.com/jz-42/runAlert/releases/tag/v1.0.0
