# Documentation

The canonical Neev platform documentation lives at
<https://docs.neevcloud.com>. This directory holds the `@neevcloud/sdk`
SDK-specific guides and reference.

New here? Start with **[Getting started](./getting-started.md)**.

| Document | What you'll find |
| -------- | ---------------- |
| [Getting started](./getting-started.md) | Install, configure credentials, and run your first sandbox |
| [API reference](./api-reference.md) | Grouped lifecycle vs runtime API lists with copy-paste snippets |
| [API inventory](./api-inventory.md) | Exhaustive per-method signatures, parameter tables, types, and errors |

For day-to-day usage you can also start from the [project README](../README.md)
and the [runnable examples](../examples).

## API surface

The SDK uses a **hybrid** model:

- **Spec-backed** resources are built from a vendored OpenAPI spec
  (`specs/<service>.yaml`) — `pnpm gen` produces `src/generated/<service>.ts`,
  and a hand-written wrapper calls a typed `openapi-fetch` client.
- **Spec-less** endpoints use `neev.raw.request<T>()` with hand-written types,
  over the same transport.

See [CONTRIBUTING → Architecture](../CONTRIBUTING.md#architecture-hybrid-autogen--hand-written-wrapper)
for the architecture overview and contributor checklist.
