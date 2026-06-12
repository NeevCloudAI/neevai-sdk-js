---
"@neevcloud/sdk": minor
---

Add streaming command execution. `sandbox.execStream(command, options)` (also on `SandboxConnection`) is an async generator that yields `stdout`/`stderr` text chunks as the daemon flushes them and a terminal `exit` event, so callers can consume output live instead of waiting for the whole command. Buffered `sandbox.exec` is now implemented on top of it (unchanged behavior). Exports the `ExecStreamEvent` type.
