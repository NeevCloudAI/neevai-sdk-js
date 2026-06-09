# Agent framework examples

These examples wire a **Neev sandbox** into popular agentic frameworks as a
secure code-execution tool. Each agent reasons over a task, runs Python or shell
inside a gVisor-isolated Neev sandbox, and uses the captured output to answer.

All three drive the **same NeevCloud model — `gpt-oss-120b`** — over the
OpenAI-compatible Neev inference endpoint, and share two helpers:

- [`sandbox-tool.ts`](./sandbox-tool.ts) — a `SandboxCodeExecutor` that
  provisions one sandbox, exposes `runPython` / `runShell`, and tears it down.
- [`model.ts`](./model.ts) — the shared model config (endpoint + `gpt-oss-120b`).

So each example file holds only the framework-specific wiring.

| Example | Framework | Model |
| ------- | --------- | ----- |
| [`langchain.ts`](./langchain.ts) | LangChain.js (LangGraph ReAct agent) | NeevCloud `gpt-oss-120b` |
| [`genkit.ts`](./genkit.ts) | Google Genkit | NeevCloud `gpt-oss-120b` |
| [`vercel-ai.ts`](./vercel-ai.ts) | Vercel AI SDK | NeevCloud `gpt-oss-120b` |

## Setup

One NeevCloud API key covers both the sandbox and the model. Set:

```sh
export NEEV_API_KEY=...        # sandbox + model (inference)
export NEEV_ORG_ID=...
export NEEV_PROJECT_ID=...
```

That's the whole setup. Defaults applied for you:

| Setting | Default | Override |
| ------- | ------- | -------- |
| Platform API base | production | `NEEV_BASE_URL` |
| Model | `gpt-oss-120b` | — |
| Inference endpoint | `https://inference.ai.neevcloud.com/v1` | `NEEV_INFERENCE_BASE_URL` |
| Inference key | `NEEV_API_KEY` | `NEEV_INFERENCE_API_KEY` |
| Region | `as-south-1` | `new SandboxCodeExecutor({ region })` |
| Template | `sb-ubuntu-26-04-minimal` | `new SandboxCodeExecutor({ templateId })` |

**Templates and binaries.** Discover templates with `neev.templates.list()`
(e.g. `sb-debian-12-minimal`, `sb-ubuntu-26-04-minimal`). The minimal images are
deliberately small: they ship `sh` but **not** `bash`, and **not** `python3`. So
`runShell` works everywhere, while `runPython` needs a python-capable template
(pass one to `new SandboxCodeExecutor({ templateId })`, or `apt-get install -y
python3` first via `runShell`). Sandbox file paths are **workspace-relative**.

## Run

```sh
# LangChain
npm install @neev/sdk @langchain/core @langchain/openai @langchain/langgraph zod
npx tsx examples/agents/langchain.ts

# Google Genkit
npm install @neev/sdk genkit @genkit-ai/compat-oai
npx tsx examples/agents/genkit.ts

# Vercel AI SDK
npm install @neev/sdk ai @ai-sdk/openai zod
npx tsx examples/agents/vercel-ai.ts
```

## Verify

Each example asks the agent to compute the SHA-256 of the string `neev` inside
the sandbox and report the digest. A successful run prints:

```
3fb3a134aebfd0bf072b02b4096612a39e201593853091c52510d37adc3d98de
```

(`printf 'neev' | sha256sum`). If you see that digest, the full loop worked:
model tool-call → code executed in the sandbox → result returned → sandbox
deleted. Right after the sandbox reaches Ready, its data-plane hostname can take
a few seconds to resolve, so the first tool call may need a moment — the agent
loop simply waits and retries on its own.

## What this demonstrates

- **Lifecycle** — `sandboxes.create` from a catalogue template; automatic
  cleanup with `sandbox.delete()`.
- **Runtime** — `sandbox.files.write` to stage code and `sandbox.exec` to run
  it, with output buffered back to the agent. The handle resolves the sandbox's
  `connect_url` and waits for Ready on first use, so the tool code stays a
  single `write` + `exec`.
- **Isolation** — every agent's generated code runs in a gVisor (`runsc`)
  sandbox, not on the host.
