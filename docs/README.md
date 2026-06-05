# Documentation

The canonical NeevAI platform documentation lives at
<https://docs.neevcloud.com>.

This directory holds SDK-specific notes and guides. For day-to-day usage, start
with the [project README](../README.md):

- **Install & auth** — [README → Install](../README.md#install)
- **Quickstart** — [README → Quickstart](../README.md#quickstart)
- **Sandbox lifecycle** — [README → Usage](../README.md#usage)
- **Runnable examples** — [`examples/`](../examples)

## API surface

The SDK uses a **hybrid** model:

- **Spec-backed** resources are built from a vendored OpenAPI spec
  (`specs/<service>.yaml`) — `pnpm gen` produces `src/generated/<service>.ts`,
  and a hand-written wrapper calls a typed `openapi-fetch` client.
- **Spec-less** endpoints use `ctx.raw.request<T>()` with hand-written types,
  over the same transport.

Specs are migrated from the backend services into `specs/` one at a time. See
[CONTRIBUTING → Architecture](../CONTRIBUTING.md#architecture-hybrid-autogen--hand-written-wrapper)
for the full workflow.
