# @neev/sdk

> Official NeevCloud SDK for the Neev platform — Node, Bun, Deno & edge.

`@neev/sdk` is the single, growing TypeScript client for the **Neev platform**.
One package, one auth model, one client — adopt new capabilities as they ship.

**Available today**

- **`neev.sandboxes`** — full agent-sandbox lifecycle: create, list, get, pause, resume, delete, and live metrics. Sandboxes are gVisor-isolated (`runsc`) compute environments for AI agents.
- **`neev.templates`** — the platform sandbox-template catalogue (list, get). A template id (e.g. `sb-ubuntu-26-04-minimal`) is required when creating a sandbox.

**Coming next**

- `neev.inference`, `neev.runtimes`, `neev.storage`, … — rolling out in the same package.

---

## Install

```sh
npm install @neev/sdk
# or: pnpm add @neev/sdk · yarn add @neev/sdk · bun add @neev/sdk
```

Requires a server-side JS runtime with global `fetch`: **Node 18+**, **Bun**, **Deno**, or an edge runtime. There is no browser build — your API key must never ship to a browser.

## Authentication

The client reads configuration from explicit options or `NEEV_*` environment variables:

| Option      | Env var                 | Required | Default |
| ----------- | ----------------------- | -------- | ------- |
| `apiKey`    | `NEEV_API_KEY`          | yes      | —       |
| `orgId`     | `NEEV_ORG_ID`           | yes\*    | —       |
| `projectId` | `NEEV_PROJECT_ID`       | yes\*    | —       |
| `baseURL`   | `NEEV_BASE_URL`         | no       | production API |

\* `orgId` / `projectId` may be set on the client or overridden per call.

`baseURL` defaults to the Neev production API; set `NEEV_BASE_URL` only to target another environment.

## Quickstart

```ts
import { Neev } from "@neev/sdk";

const neev = new Neev({
  apiKey: process.env.NEEV_API_KEY,
  orgId: process.env.NEEV_ORG_ID,
  projectId: process.env.NEEV_PROJECT_ID,
});

// Create a sandbox from a template and wait for it to come up.
const sandbox = await neev.sandboxes.create({
  name: "my-agent",
  sandbox_template_id: "sb-ubuntu-26-04-minimal",
  region: "as-south-1", // production region
});
await sandbox.waitUntilReady();

console.log(sandbox.id, sandbox.phase, sandbox.connectUrl);

// Pause it when idle, resume on demand, delete when done.
await sandbox.pause();
await sandbox.resume();
await sandbox.delete();
```

See [`examples/`](./examples) for runnable scripts.

## Usage

### Resource methods

```ts
const page = await neev.sandboxes.list({ limit: 50 });
const sandbox = await neev.sandboxes.get(id);
await neev.sandboxes.pause(id);
await neev.sandboxes.resume(id);
await neev.sandboxes.delete(id);
const metrics = await neev.sandboxes.metrics(id, { step: "60s" });
```

### Sandbox templates

Create requires a `sandbox_template_id`. Pass a known id directly, or browse the catalogue to discover one:

```ts
// Create directly from a known template id.
const sandbox = await neev.sandboxes.create({
  name: "my-agent",
  sandbox_template_id: "sb-ubuntu-26-04-minimal",
  region: "as-south-1", // production region
});

// Or discover what's available first.
const { items } = await neev.templates.list();
const template = await neev.templates.get("sb-ubuntu-26-04-minimal"); // inspect one
```

### Sandbox handles

`create`, `get`, and `list` return `Sandbox` handles with lifecycle methods on the object itself:

```ts
const sandbox = await neev.sandboxes.get(id);
await sandbox.refresh();          // re-fetch latest state
await sandbox.waitUntilReady();   // poll until phase === "Ready"
await sandbox.pause();
sandbox.data;                     // full raw API record
```

### Per-call scope override

Methods accept an optional scope to target a different org/project than the client default:

```ts
await neev.sandboxes.list({ orgId: "other-org", projectId: "other-proj" });
```

### Error handling

Every failure is a typed `NeevError` subclass:

```ts
import { NotFoundError, RateLimitError, APIError } from "@neev/sdk";

try {
  await neev.sandboxes.get("missing");
} catch (err) {
  if (err instanceof NotFoundError) {
    // 404 — handle missing sandbox
  } else if (err instanceof APIError) {
    console.error(err.status, err.code, err.requestId);
  }
}
```

Transient failures (network errors, `429`, `5xx`) are retried automatically with exponential backoff (configurable via `maxRetries`).

### Advanced: untyped requests

Most resources are typed against an OpenAPI spec. For endpoints that don't have a published spec yet, `neev.raw` issues requests over the same transport (auth, retries, timeout, typed errors), with caller-supplied types:

```ts
const widget = await neev.raw.request<{ id: string }>({
  method: "GET",
  path: "/api/v1beta1/orgs/acme/projects/web/widgets/123",
});
```

These graduate to fully-typed resource methods as specs land in the SDK.

### Working inside a sandbox (files & exec)

Operations that act inside a running sandbox are reached directly on the sandbox handle. The handle resolves the sandbox's `connect_url` (returned by `create`/`get`/`list`) on first use and caches it; if the sandbox isn't Ready yet, the first `files`/`exec` call waits until it is:

File paths are workspace-relative (the daemon rejects absolute paths):

```ts
const sandbox = await neev.sandboxes.get(id);
await sandbox.files.write("main.py", "print('hi')"); // → { bytesWritten }
const bytes = await sandbox.files.read("main.py"); // → Uint8Array
const text = await sandbox.files.readText("main.py"); // → string
const entries = await sandbox.files.list(".", { recursive: true }); // → FileEntry[]

const result = await sandbox.exec(["sh", "-c", "python3 main.py"]); // → { stdout, stderr, exitCode }
```

`exec` is buffered — it runs the command to completion and returns captured output; a non-zero `exitCode` is returned, not thrown.

These calls are **not** retried automatically (a retried `write` could run twice) — handle retries yourself if needed.

## Documentation

Full platform documentation: <https://docs.neevcloud.com>.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: [SECURITY.md](./SECURITY.md).

## License

[Apache-2.0](./LICENSE) © NeevCloud
