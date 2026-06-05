# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial SDK scaffold: `NeevAI` client with env/option config resolution.
- `neev.sandboxes` resource — `create`, `list`, `get`, `pause`, `resume`, `delete`, `metrics`.
- `Sandbox` handle with `refresh`, `pause`, `resume`, `delete`, `metrics`, and `waitUntilReady`.
- Typed error hierarchy (`NeevAIError` and HTTP-status subclasses).
- HTTP transport with timeout and exponential-backoff retries on network errors, `429`, and `5xx`.
- Generated TypeScript types from the AI Agent Service OpenAPI spec.
- Sandbox data-plane: `sandbox.files.write()` writes files to a running sandbox
  via its sandboxd daemon (reached at `connect_url`, no-retry transport).

### Changed

- Hybrid autogen architecture: a shared `dispatch` transport backs both a typed
  `openapi-fetch` client (`createTypedClient`) for spec-backed services and a
  `RawClient` (`raw.request`) escape hatch for endpoints without a spec yet.
- `pnpm gen` now generates per-service types (`specs/<service>.yaml` →
  `src/generated/<service>.ts`) so specs can be migrated one at a time.

[Unreleased]: https://github.com/NeevCloudAI/neevai-sdk-js/commits/main
