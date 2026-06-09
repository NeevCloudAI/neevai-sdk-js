/**
 * Google Genkit agent with a Neev sandbox as its code-execution tool.
 *
 * Genkit is Google's agentic framework for JS/TS. This example points Genkit at
 * NeevCloud `gpt-oss-120b` via the OpenAI-compatible inference endpoint (using
 * the `@genkit-ai/compat-oai` plugin) and exposes `run_python` / `run_shell`
 * tools backed by a Neev sandbox.
 *
 * Install (peer deps for this example):
 *   npm install @neev/sdk genkit @genkit-ai/compat-oai
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agents/genkit.ts
 *
 * NEEV_API_KEY is used for both the sandbox and (by fallback) the model; set
 * NEEV_INFERENCE_API_KEY if your inference key differs.
 */
import { openAICompatible } from "@genkit-ai/compat-oai";
import { genkit, z } from "genkit";
import { NEEV_INFERENCE_BASE_URL, NEEV_MODEL, neevInferenceApiKey } from "./model.js";
import { SandboxCodeExecutor, formatRunResult } from "./sandbox-tool.js";

async function main(): Promise<void> {
  // Register the Neev inference endpoint as an OpenAI-compatible provider named "neev".
  const ai = genkit({
    plugins: [
      openAICompatible({
        name: "neev",
        apiKey: neevInferenceApiKey(),
        baseURL: NEEV_INFERENCE_BASE_URL,
      }),
    ],
  });
  const executor = new SandboxCodeExecutor();

  // Expose the sandbox as Gemini-style callable tools.
  const runPython = ai.defineTool(
    {
      name: "run_python",
      description: "Execute Python 3 code in a secure Neev sandbox and return its output.",
      inputSchema: z.object({ code: z.string().describe("Python 3 source to execute") }),
      outputSchema: z.string(),
    },
    async ({ code }) => formatRunResult(await executor.runPython(code)),
  );

  const runShell = ai.defineTool(
    {
      name: "run_shell",
      description: "Run a shell command in the Neev sandbox and return its output.",
      inputSchema: z.object({ command: z.string().describe("Shell command to run") }),
      outputSchema: z.string(),
    },
    async ({ command }) => formatRunResult(await executor.runShell(command)),
  );

  try {
    const { text } = await ai.generate({
      model: `neev/${NEEV_MODEL}`,
      prompt:
        "Use the sandbox to compute the SHA-256 hex digest of the exact string " +
        "'neev' (no trailing newline), then report only the 64-character digest.",
      tools: [runPython, runShell],
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
