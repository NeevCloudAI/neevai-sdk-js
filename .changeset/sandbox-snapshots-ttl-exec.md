---
"@neevcloud/sdk": minor
---

Add sandbox snapshots, fork, restore, a create-time TTL, and a unified `exec`.

- **Snapshots / fork / restore**: `sandboxes.createSnapshot` / `listSnapshots` / `getSnapshot` / `deleteSnapshot`, `sandboxes.restore` (in place from a snapshot), and `sandboxes.fork` (a new sandbox seeded from a snapshot), with matching `sandbox.snapshot` / `snapshots` / `restore` / `fork` handle methods. Exports `SnapshotData`, `SnapshotStatus`, `CreateSnapshotParams`, `SnapshotListResponse`.
- **Create TTL**: `sandboxes.create` accepts `lifecycle.ttl_seconds` so the sandbox auto-shuts-down after the TTL.
- **Unified exec**: `sandbox.exec` is buffered by default and returns a live event stream when called with `{ stream: true }` (typed via overloads). `sandbox.execStream` remains as a deprecated alias.
