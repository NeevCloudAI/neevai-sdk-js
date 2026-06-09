/**
 * Google Genkit agent (Gemini) with a Neev sandbox as its code-execution tool.
 *
 * Genkit is Google's agentic framework for JS/TS. This example defines a
 * `run_python` tool backed by a Neev sandbox and lets Gemini call it to solve a
 * task, then summarise the result.
 *
 * Install (peer deps for this example):
 *   npm install @neev/sdk genkit @genkit-ai/googleai
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... GEMINI_API_KEY=... \
 *     npx tsx examples/agents/genkit.ts
 */
import { gemini15Flash, googleAI } from "@genkit-ai/googleai";
import { genkit, z } from "genkit";
import { SandboxCodeExecutor, formatRunResult } from "./sandbox-tool.js";

async function main(): Promise<void> {
  const ai = genkit({ plugins: [googleAI()], model: gemini15Flash });
  const executor = new SandboxCodeExecutor();

  // Expose the sandbox as a Gemini-callable tool.
  const runPython = ai.defineTool(
    {
      name: "run_python",
      description: "Execute Python 3 code in a secure Neev sandbox and return its output.",
      inputSchema: z.object({ code: z.string().describe("Python 3 source to execute") }),
      outputSchema: z.string(),
    },
    async ({ code }) => formatRunResult(await executor.runPython(code)),
  );

  try {
    const { text } = await ai.generate({
      prompt:
        "Use the sandbox to compute the 25th Fibonacci number in Python, " +
        "then state the value in one sentence.",
      tools: [runPython],
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
