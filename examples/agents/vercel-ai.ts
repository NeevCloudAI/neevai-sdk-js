/**
 * Vercel AI SDK agent with a Neev sandbox as its code-execution tool.
 *
 * `generateText` runs a multi-step tool-calling loop: the model writes code,
 * the `runPython` / `runShell` tools execute it in a gVisor-isolated Neev
 * sandbox, and the model uses the output to finish the task. The model is
 * NeevCloud `gpt-oss-120b` over the OpenAI-compatible Neev inference endpoint.
 *
 * Install (peer deps for this example):
 *   npm install @neev/sdk ai @ai-sdk/openai zod
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agents/vercel-ai.ts
 *
 * NEEV_API_KEY is used for both the sandbox and (by fallback) the model; set
 * NEEV_INFERENCE_API_KEY if your inference key differs.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";
import { NEEV_INFERENCE_BASE_URL, NEEV_MODEL, neevInferenceApiKey } from "./model.js";
import { SandboxCodeExecutor, formatRunResult } from "./sandbox-tool.js";

async function main(): Promise<void> {
  const executor = new SandboxCodeExecutor();

  // NeevCloud gpt-oss-120b over the OpenAI-compatible inference endpoint.
  const neev = createOpenAI({
    baseURL: NEEV_INFERENCE_BASE_URL,
    apiKey: neevInferenceApiKey(),
  });

  try {
    const { text } = await generateText({
      model: neev(NEEV_MODEL),
      // Allow several tool-call rounds so the model can run code then read output.
      maxSteps: 6,
      tools: {
        runPython: tool({
          description: "Execute Python 3 code in a secure Neev sandbox and return its output.",
          parameters: z.object({ code: z.string().describe("Python 3 source to execute") }),
          execute: async ({ code }) => formatRunResult(await executor.runPython(code)),
        }),
        runShell: tool({
          description: "Run a shell command in the Neev sandbox and return its output.",
          parameters: z.object({ command: z.string().describe("Shell command to run") }),
          execute: async ({ command }) => formatRunResult(await executor.runShell(command)),
        }),
      },
      prompt:
        "Use the sandbox to compute the SHA-256 hex digest of the exact string " +
        "'neev' (no trailing newline), then report only the 64-character digest.",
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
