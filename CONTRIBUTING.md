# Contributing to @neevcloud/sdk

Thanks for your interest in improving the Neev SDK!

## Prerequisites

- Node 18+ (the repo pins Node 20 via `.nvmrc`)
- [pnpm](https://pnpm.io) 10+

## Getting started

```sh
git clone https://github.com/NeevCloudAI/neev-sdk-js.git
cd neev-sdk-js
pnpm install
```

## Development workflow

| Command              | What it does                                          |
| -------------------- | ----------------------------------------------------- |
| `pnpm gen`           | Regenerate TS types from every `specs/<service>.yaml`  |
| `pnpm typecheck`     | Type-check with `tsc --noEmit`                         |
| `pnpm test`          | Run the unit tests                                     |
| `pnpm test:coverage` | Run tests with coverage (80% threshold enforced)       |
| `pnpm lint`          | Lint + format check with Biome                         |
| `pnpm lint:fix`      | Apply lint + format fixes                              |
| `pnpm build`         | Build the dual ESM/CJS bundle and type declarations    |

Before opening a PR, make sure `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass.

## Architecture: hybrid autogen + hand-written wrapper

The SDK follows a hybrid model so it can cover endpoints whether or not they have an OpenAPI spec yet:

- **Spec-backed (preferred):** the service's OpenAPI spec is vendored into `specs/<service>.yaml`, `pnpm gen` produces `src/generated/<service>.ts`, and a hand-written resource wrapper calls a typed [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) client (`ctx.createTypedClient<paths>()`). Paths, params, bodies, and responses are all checked against the spec at compile time.
- **Spec-less (escape hatch):** for endpoints without a spec, the wrapper hand-writes the request/response types and calls `ctx.raw.request<T>()`. The `RawClient` shares the exact same transport (`dispatch`) — auth, timeout, retry, and typed errors are identical to the spec-backed path.

Both paths run over a single shared `dispatch` (`src/http.ts`): bearer auth, per-request timeout, and exponential-backoff retries on network errors / 429 / 5xx.

### Adding or migrating a service

Specs are moved from the backend services into this public repo **one at a time**:

1. Copy the service's `apis/openapi.yaml` to `specs/<service>.yaml`.
2. Run `pnpm gen` → generates `src/generated/<service>.ts`.
3. Hand-write the resource wrapper (a `src/resources/<service>.ts` + any handle classes) using `ctx.createTypedClient<paths>()` and the `unwrap` / `ensureOk` helpers.
4. Until a spec exists, a resource may use `ctx.raw.request<T>()` with hand-written types; migrate it to the typed client when the spec lands.

## Code conventions

- **Generated code is not edited by hand.** `src/generated/` is produced by `pnpm gen` from the vendored specs. To change types, update the spec source and regenerate.
- Every exported function, method, and type carries a short doc comment describing what it does.
- New runtime code ships with unit tests; coverage must stay at or above 80%.
- Formatting and linting are enforced by Biome — run `pnpm lint:fix` before committing.

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for versioning. If your change affects published behavior, add a changeset:

```sh
pnpm dlx changeset
```

## Reporting bugs

Use the issue templates. For security issues, follow [SECURITY.md](./SECURITY.md) instead of filing a public issue.
