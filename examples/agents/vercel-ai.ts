/**
 * Vercel AI SDK agent with a Neev sandbox as its code-execution tool.
 *
 * `generateText` runs a multi-step tool-calling loop: the model writes code,
 * the `runPython` / `runShell` tools execute it in a gVisor-isolated Neev
 * sandbox, and the model uses the output to finish the task.
 *
 * Install (peer deps for this example):
 *   npm install @neev/sdk ai @ai-sdk/openai zod
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... OPENAI_API_KEY=... \
 *     npx tsx examples/agents/vercel-ai.ts
 */
import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";
import { SandboxCodeExecutor, formatRunResult } from "./sandbox-tool.js";

async function main(): Promise<void> {
  const executor = new SandboxCodeExecutor();

  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      // Allow several tool-call rounds so the model can run code then read output.
      maxSteps: 6,
      tools: {
        runPython: tool({
          description: "Execute Python 3 code in a secure Neev sandbox and return its output.",
          parameters: z.object({ code: z.string().describe("Python 3 source to execute") }),
          execute: async ({ code }) => formatRunResult(await executor.runPython(code)),
        }),
        runShell: tool({
          description: "Run a bash command in the Neev sandbox and return its output.",
          parameters: z.object({ command: z.string().describe("Shell command to run") }),
          execute: async ({ command }) => formatRunResult(await executor.runShell(command)),
        }),
      },
      prompt:
        "Use the sandbox to list the Python version, then compute the sum of the " +
        "first 100 primes in Python and report it.",
    });
    console.log(text);
  } finally {
    // Always release the sandbox so it stops billing.
    await executor.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
