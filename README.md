# @neevai/sdk

> Official NeevCloud SDK for the NeevAI platform — Node, Bun, Deno & edge.

`@neevai/sdk` is the single, growing TypeScript client for the **NeevAI platform**.
One package, one auth model, one client — adopt new capabilities as they ship.

**Available today**

- **`neev.sandboxes`** — full agent-sandbox lifecycle: create, list, get, pause, resume, delete, and live metrics. Sandboxes are gVisor-isolated (`runsc`) compute environments for AI agents.

**Coming next**

- `neev.inference`, `neev.runtimes`, `neev.storage`, … — rolling out in the same package.

---

## Install

```sh
npm install @neevai/sdk
# or: pnpm add @neevai/sdk · yarn add @neevai/sdk · bun add @neevai/sdk
```

Requires a server-side JS runtime with global `fetch`: **Node 18+**, **Bun**, **Deno**, or an edge runtime. There is no browser build — your API key must never ship to a browser.

## Authentication

The client reads configuration from explicit options or `NEEVCLOUD_*` environment variables:

| Option      | Env var                 | Required | Default |
| ----------- | ----------------------- | -------- | ------- |
| `apiKey`    | `NEEVCLOUD_API_KEY`     | yes      | —       |
| `orgId`     | `NEEVCLOUD_ORG_ID`      | yes\*    | —       |
| `projectId` | `NEEVCLOUD_PROJECT_ID`  | yes\*    | —       |

\* `orgId` / `projectId` may be set on the client or overridden per call.

## Quickstart

```ts
import { NeevAI } from "@neevai/sdk";

const neev = new NeevAI({
  apiKey: process.env.NEEVCLOUD_API_KEY,
  orgId: process.env.NEEVCLOUD_ORG_ID,
  projectId: process.env.NEEVCLOUD_PROJECT_ID,
});

// Create a sandbox and wait for it to come up.
const sandbox = await neev.sandboxes.create({
  name: "my-agent",
  image: "ghcr.io/neevcloud/sandbox-python:3.12",
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

Every failure is a typed `NeevAIError` subclass:

```ts
import { NotFoundError, RateLimitError, APIError } from "@neevai/sdk";

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

### Working inside a sandbox (files)

Operations that act inside a running sandbox are reached directly on the sandbox handle (the sandbox must be Ready):

```ts
const sandbox = await neev.sandboxes.get(id);
await sandbox.files.write("/work/main.py", "print('hi')"); // → { bytesWritten }
const bytes = await sandbox.files.read("/work/main.py"); // → Uint8Array
const text = await sandbox.files.readText("/work/main.py"); // → string
const entries = await sandbox.files.list("/work", { recursive: true }); // → FileEntry[]
```

These calls are **not** retried automatically (a retried `write` could run twice) — handle retries yourself if needed.

## Documentation

Full platform documentation: <https://docs.neevcloud.com>.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: [SECURITY.md](./SECURITY.md).

## License

[Apache-2.0](./LICENSE) © NeevCloud
