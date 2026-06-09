/**
 * LangChain.js agent with a Neev sandbox as its code-execution tool.
 *
 * The agent reasons over a task, calls the `run_python` / `run_shell` tools to
 * execute code in a gVisor-isolated Neev sandbox, and uses the captured output
 * to produce its answer.
 *
 * Install (peer deps for this example):
 *   npm install @neev/sdk @langchain/core @langchain/openai @langchain/langgraph zod
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... OPENAI_API_KEY=... \
 *     npx tsx examples/agents/langchain.ts
 *
 * The model is provider-agnostic: point ChatOpenAI at Neev inference (or any
 * OpenAI-compatible endpoint) via `configuration.baseURL` if you prefer.
 */
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { SandboxCodeExecutor, formatRunResult } from "./sandbox-tool.js";

async function main(): Promise<void> {
  const executor = new SandboxCodeExecutor();

  // Tool 1: run Python in the sandbox.
  const runPython = tool(async ({ code }) => formatRunResult(await executor.runPython(code)), {
    name: "run_python",
    description: "Execute Python 3 code in a secure Neev sandbox and return its output.",
    schema: z.object({ code: z.string().describe("Python 3 source to execute") }),
  });

  // Tool 2: run a shell command in the same sandbox.
  const runShell = tool(async ({ command }) => formatRunResult(await executor.runShell(command)), {
    name: "run_shell",
    description: "Run a bash command in the Neev sandbox and return its output.",
    schema: z.object({ command: z.string().describe("Shell command to run") }),
  });

  const agent = createReactAgent({
    llm: new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 }),
    tools: [runPython, runShell],
  });

  try {
    const result = await agent.invoke({
      messages: [
        {
          role: "user",
          content:
            "Use the sandbox to compute the SHA-256 of the string 'neev' in Python, " +
            "then report the hex digest.",
        },
      ],
    });
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
