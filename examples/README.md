# Examples

Runnable examples for `@neev/sdk`. The package isn't published yet, so run them
from this repository — `import "@neev/sdk"` resolves to the local build
automatically (Node package self-referencing), so no link step is needed.

## Quick setup (once)

```sh
# from the repo root
pnpm install
pnpm build            # builds dist/ — examples import "@neev/sdk" and resolve to it

# sandbox credentials
export NEEV_API_KEY=...        # your sandbox API key
export NEEV_ORG_ID=...
export NEEV_PROJECT_ID=...
```

By default examples target the **production** API (`https://api.ai.neevcloud.com/agent`)
and region `as-south-1`. To target another environment, also set:

```sh
export NEEV_BASE_URL=https://api.dev.ai.neevcloud.com/agent
export NEEV_REGION=as-dev-1
```

> Re-run `pnpm build` whenever you change SDK source, so the examples pick it up.

## Examples — no model needed (pure SDK)

| File | What it shows | Run |
|------|---------------|-----|
| [`create-sandbox.ts`](./create-sandbox.ts) | Lifecycle: list templates → create → wait for Ready → metrics → pause → delete | `npx tsx examples/create-sandbox.ts` |
| [`streaming-exec.ts`](./streaming-exec.ts) | `sandbox.execStream` — output streamed line-by-line as it is produced | `npx tsx examples/streaming-exec.ts` |
| [`parallel-fanout.ts`](./parallel-fanout.ts) | Several isolated sandboxes run a map/reduce concurrently; reads `metrics()` | `npx tsx examples/parallel-fanout.ts` |
| [`sandbox-metrics.ts`](./sandbox-metrics.ts) | `sandbox.metrics()` polled under CPU load | `npx tsx examples/sandbox-metrics.ts` |

## Examples — with an AI model

These drive NeevCloud `gpt-oss-120b` over the OpenAI-compatible inference
endpoint, so add an inference key (falls back to `NEEV_API_KEY` if your sandbox
and inference keys are the same):

```sh
export NEEV_INFERENCE_API_KEY=...   # inference key
# inference endpoint defaults to https://inference.ai.neevcloud.com/v1
```

| File | Extra install | Run |
|------|---------------|-----|
| [`agents/ai-interpreter.ts`](./agents/ai-interpreter.ts) | none (only `@neev/sdk` + `fetch`) | `npx tsx examples/agents/ai-interpreter.ts` |
| [`agents/langchain.ts`](./agents/langchain.ts) | `pnpm add -D @langchain/core @langchain/openai @langchain/langgraph zod` | `npx tsx examples/agents/langchain.ts` |
| [`agents/vercel-ai.ts`](./agents/vercel-ai.ts) | `pnpm add -D ai@^4 @ai-sdk/openai@^1 zod` | `npx tsx examples/agents/vercel-ai.ts` |
| [`agents/genkit.ts`](./agents/genkit.ts) | `pnpm add -D genkit @genkit-ai/compat-oai` | `npx tsx examples/agents/genkit.ts` |

`ai-interpreter.ts` is the highlight: the model writes shell, it runs in the
sandbox, and its output streams to your terminal live. See
[`agents/README.md`](./agents/README.md) for framework-by-framework detail.

> The `pnpm add -D` installs are just to run the examples in your working copy —
> they don't need to be committed.

## Environment reference

| Variable | Used by | Default |
|----------|---------|---------|
| `NEEV_API_KEY` | all | — (required) |
| `NEEV_ORG_ID` | all | — (required) |
| `NEEV_PROJECT_ID` | all | — (required) |
| `NEEV_BASE_URL` | all | production gateway |
| `NEEV_REGION` | sandbox create | `as-south-1` |
| `NEEV_INFERENCE_API_KEY` | model examples | falls back to `NEEV_API_KEY` |
| `NEEV_INFERENCE_BASE_URL` | model examples | production inference endpoint |

## Notes

- Sandbox file paths are **workspace-relative** — the daemon rejects absolute paths.
- The standard templates ship `sh` only (no `bash`, no `python3`); `sh -c` works
  on every template. `runPython` needs a python-capable template.
- Progress/transcript output goes to **stderr**; an example's result goes to **stdout**.
