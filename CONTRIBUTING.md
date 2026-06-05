# Contributing to @neevai/sdk

Thanks for your interest in improving the NeevAI SDK!

## Prerequisites

- Node 18+ (the repo pins Node 20 via `.nvmrc`)
- [pnpm](https://pnpm.io) 10+

## Getting started

```sh
git clone https://github.com/NeevCloudAI/neevai-sdk-js.git
cd neevai-sdk-js
pnpm install
```

## Development workflow

| Command              | What it does                                          |
| -------------------- | ----------------------------------------------------- |
| `pnpm gen`           | Regenerate TS types from `specs/openapi.yaml`          |
| `pnpm typecheck`     | Type-check with `tsc --noEmit`                         |
| `pnpm test`          | Run the unit tests                                     |
| `pnpm test:coverage` | Run tests with coverage (80% threshold enforced)       |
| `pnpm lint`          | Lint + format check with Biome                         |
| `pnpm lint:fix`      | Apply lint + format fixes                              |
| `pnpm build`         | Build the dual ESM/CJS bundle and type declarations    |

Before opening a PR, make sure `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass.

## Code conventions

- **Generated code is not edited by hand.** `src/generated/` is produced by `pnpm gen` from the vendored OpenAPI spec. To change types, update the spec source and regenerate.
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
