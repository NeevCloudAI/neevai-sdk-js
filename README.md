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

The client reads configuration from explicit options or `NEEVAI_*` environment variables:

| Option      | Env var              | Required | Default                                |
| ----------- | -------------------- | -------- | -------------------------------------- |
| `apiKey`    | `NEEVAI_API_KEY`     | yes      | —                                      |
| `orgId`     | `NEEVAI_ORG_ID`      | yes\*    | —                                      |
| `projectId` | `NEEVAI_PROJECT_ID`  | yes\*    | —                                      |
| `env`       | `NEEVAI_ENV`         | no       | `dev`                                  |
| `baseURL`   | `NEEVAI_BASE_URL`    | no       | `https://agent.<env>.ai.neevcloud.com` |

\* `orgId` / `projectId` may be set on the client or overridden per call.

## Quickstart

```ts
import { NeevAI } from "@neevai/sdk";

const neev = new NeevAI({
  apiKey: process.env.NEEVAI_API_KEY,
  orgId: process.env.NEEVAI_ORG_ID,
  projectId: process.env.NEEVAI_PROJECT_ID,
});

// Create a sandbox and wait for it to come up.
const sandbox = await neev.sandboxes.create({
  name: "my-agent",
  image: "ghcr.io/neevcloud/agent-base:latest",
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

## Documentation

Full platform documentation: <https://docs.neevcloud.com>.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: [SECURITY.md](./SECURITY.md).

## License

[Apache-2.0](./LICENSE) © NeevCloud
