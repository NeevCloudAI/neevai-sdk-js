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

The SDK is generated-types + a hand-written ergonomic client. The vendored
OpenAPI source of truth is [`specs/openapi.yaml`](../specs/openapi.yaml); run
`pnpm gen` to regenerate `src/generated/types.ts` after updating it.
