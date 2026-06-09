# Agent framework examples

These examples wire a **Neev sandbox** into popular agentic frameworks as a
secure code-execution tool. Each agent reasons over a task, runs Python or shell
inside a gVisor-isolated Neev sandbox, and uses the captured output to answer.

All three share [`sandbox-tool.ts`](./sandbox-tool.ts) — a small
`SandboxCodeExecutor` that provisions one sandbox, exposes `runPython` /
`runShell`, and tears it down at the end — so each file holds only the
framework-specific wiring.

| Example | Framework | Model |
| ------- | --------- | ----- |
| [`langchain.ts`](./langchain.ts) | LangChain.js (LangGraph ReAct agent) | OpenAI (configurable) |
| [`genkit.ts`](./genkit.ts) | Google Genkit | Gemini |
| [`vercel-ai.ts`](./vercel-ai.ts) | Vercel AI SDK | OpenAI (configurable) |

## Prerequisites

A Neev API key plus org/project, set in the environment. The client targets the
Neev production API by default; set `NEEV_BASE_URL` only to target another
environment.

```sh
export NEEV_API_KEY=...
export NEEV_ORG_ID=...
export NEEV_PROJECT_ID=...
```

Plus the model provider key the example uses (`OPENAI_API_KEY` or
`GEMINI_API_KEY`).

**Templates and binaries.** Discover available templates with `neev.templates.list()`
(e.g. `sb-debian-12-minimal`, `sb-ubuntu-26-04-minimal`). The minimal images are
deliberately small: they ship `sh` but **not** `bash`, and **not** `python3`. So:

- `runShell` uses `sh -c` and works on every template.
- `runPython` needs a python-capable template — pass one to
  `new SandboxCodeExecutor({ templateId })`, or install python first via
  `runShell` (e.g. `apt-get update && apt-get install -y python3`).

Sandbox file paths are **workspace-relative** (the daemon rejects absolute paths).

The executor provisions in the production region `as-south-1` by default; pass
`new SandboxCodeExecutor({ region })` to target another region.

## Run

```sh
# LangChain
npm install @neev/sdk @langchain/core @langchain/openai @langchain/langgraph zod
npx tsx examples/agents/langchain.ts

# Google Genkit
npm install @neev/sdk genkit @genkit-ai/googleai
npx tsx examples/agents/genkit.ts

# Vercel AI SDK
npm install @neev/sdk ai @ai-sdk/openai zod
npx tsx examples/agents/vercel-ai.ts
```

## What this demonstrates

- **Lifecycle** — `sandboxes.create` from a catalogue template; automatic
  cleanup with `sandbox.delete()`.
- **Runtime** — `sandbox.files.write` to stage code and `sandbox.exec` to run
  it, with output buffered back to the agent. The handle resolves the sandbox's
  `connect_url` and waits for Ready on first use, so the tool code stays a
  single `write` + `exec`.
- **Isolation** — every agent's generated code runs in a gVisor (`runsc`)
  sandbox, not on the host.
