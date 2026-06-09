/**
 * LangChain.js agent with a Neev sandbox as its code-execution tool.
 *
 * The agent reasons over a task, calls the `run_python` / `run_shell` tools to
 * execute code in a gVisor-isolated Neev sandbox, and uses the captured output
 * to produce its answer. The model is NeevCloud `gpt-oss-120b`, served over the
 * OpenAI-compatible Neev inference endpoint.
 *
 * Install (peer deps for this example):
 *   npm install @neev/sdk @langchain/core @langchain/openai @langchain/langgraph zod
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agents/langchain.ts
 *
 * NEEV_API_KEY is used for both the sandbox and (by fallback) the model; set
 * NEEV_INFERENCE_API_KEY if your inference key differs.
 */
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { NEEV_INFERENCE_BASE_URL, NEEV_MODEL, neevInferenceApiKey } from "./model.js";
import { SandboxCodeExecutor, formatRunResult } from "./sandbox-tool.js";

async function main(): Promise<void> {
  const executor = new SandboxCodeExecutor();

  // Tool 1: run Python in the sandbox (needs a python-capable template).
  const runPython = tool(async ({ code }) => formatRunResult(await executor.runPython(code)), {
    name: "run_python",
    description: "Execute Python 3 code in a secure Neev sandbox and return its output.",
    schema: z.object({ code: z.string().describe("Python 3 source to execute") }),
  });

  // Tool 2: run a shell command in the same sandbox.
  const runShell = tool(async ({ command }) => formatRunResult(await executor.runShell(command)), {
    name: "run_shell",
    description: "Run a shell command in the Neev sandbox and return its output.",
    schema: z.object({ command: z.string().describe("Shell command to run") }),
  });

  const agent = createReactAgent({
    // NeevCloud gpt-oss-120b over the OpenAI-compatible inference endpoint.
    llm: new ChatOpenAI({
      model: NEEV_MODEL,
      temperature: 0,
      apiKey: neevInferenceApiKey(),
      configuration: { baseURL: NEEV_INFERENCE_BASE_URL },
    }),
    tools: [runPython, runShell],
  });

  try {
    const result = await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content:
              "Use the sandbox to compute the SHA-256 hex digest of the exact string " +
              "'neev' (no trailing newline), then report only the 64-character digest.",
          },
        ],
      },
      // A freshly-created sandbox's data-plane hostname takes a few seconds to
      // resolve after it reports Ready, so the first tool calls may fail while
      // the agent waits for it to come up. Raise the step budget above the
      // default 25 so the agent can wait that out instead of erroring.
      { recursionLimit: 100 },
    );
    const final = result.messages.at(-1);
    console.log(final?.content);
  } finally {
    // Always release the sandbox so it stops billing.
    await executor.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
