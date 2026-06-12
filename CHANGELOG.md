# Changelog

## 0.5.0

### Minor Changes

- bd32716: Add sandbox snapshots, fork, restore, and a unified `exec`.

  - **Snapshots / fork / restore**: `sandboxes.createSnapshot` / `listSnapshots` (paginated) / `getSnapshot` / `deleteSnapshot`, `sandboxes.restore` (in place from a chosen snapshot), and `sandboxes.fork` (a new sandbox from the source's current live state — it does not reuse an existing snapshot), with matching `sandbox.snapshot` / `snapshots` / `restore` / `fork` handle methods. Exports `SnapshotData`, `SnapshotStatus`, `CreateSnapshotParams`, `SnapshotListResponse`.
  - **Unified exec**: `sandbox.exec` is buffered by default and returns a live event stream when called with `{ stream: true }` (typed via overloads). `sandbox.execStream` remains as a deprecated alias.

- 0d8f862: Sync the sandbox lifecycle surface to the current aiagent API and add the sandbox-template catalogue.

  - `neev.templates` — new read-only resource: `list()` and `get(id)` over `/api/v1beta1/sandbox-templates`.
  - `sandboxes.create` takes an optional `sandbox_template_id`; when omitted the server uses its default template (and resolves the image and default command from the chosen template). `image`/`command` are optional and ignored when a template is set. **Breaking** for callers that passed only `image`.
  - `CreateSandboxRequest` and `Sandbox` gain `resources` (cpu/memory_gb/disk_gb) and `egress` (mode + allow rules); `Sandbox` also gains `sandbox_template_id` and `created_by`. The removed `namespace`/`fqdn`/`k8s_uid` fields are no longer returned.
  - `Sandbox` handle exposes `region`, `templateId`, and `resources`.
  - `Sandbox` handle now resolves the daemon `connect_url` automatically: `files`/`exec` wait until the sandbox is Ready on first use to obtain it, cache the connection, and rebuild it if the `connect_url` changes (e.g. across a resume).

- 5eb0b63: Add streaming command execution. `sandbox.execStream(command, options)` (also on `SandboxConnection`) is an async generator that yields `stdout`/`stderr` text chunks as the daemon flushes them and a terminal `exit` event, so callers can consume output live instead of waiting for the whole command. Buffered `sandbox.exec` is now implemented on top of it (unchanged behavior). Exports the `ExecStreamEvent` type.

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial SDK scaffold: `Neev` client with env/option config resolution.
- `neev.sandboxes` resource — `create`, `list`, `get`, `pause`, `resume`, `delete`, `metrics`.
- `Sandbox` handle with `refresh`, `pause`, `resume`, `delete`, `metrics`, and `waitUntilReady`.
- Typed error hierarchy (`NeevError` and HTTP-status subclasses).
- HTTP transport with timeout and exponential-backoff retries on network errors, `429`, and `5xx`.
- Generated TypeScript types from the AI Agent Service OpenAPI spec.
- Sandbox files: `sandbox.files.write()` writes files to a running sandbox via
  its sandboxd daemon (reached at `connect_url`; not retried).
- Sandbox files: `sandbox.files.read()` (raw `Uint8Array`) and
  `sandbox.files.readText()` (UTF-8) read files from a running sandbox.
- Sandbox files: `sandbox.files.list()` lists directory entries
  (`FileEntry[]`) from a running sandbox.
- Sandbox exec: `sandbox.exec()` runs a command in a running sandbox and returns
  buffered `{ stdout, stderr, exitCode }` (drains the `/v1/exec` NDJSON stream;
  non-zero exit is not an error).

### Changed

- Hybrid autogen architecture: a shared `dispatch` transport backs both a typed
  `openapi-fetch` client (`createTypedClient`) for spec-backed services and a
  `RawClient` (`raw.request`) escape hatch for endpoints without a spec yet.
- `pnpm gen` now generates per-service types (`specs/<service>.yaml` →
  `src/generated/<service>.ts`) so specs can be migrated one at a time.

[Unreleased]: https://github.com/NeevCloudAI/neev-sdk-js/commits/main
