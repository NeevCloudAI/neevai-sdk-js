/**
 * AI code-interpreter with live output.
 *
 * NeevCloud `gpt-oss-120b` is given a `run_shell` tool backed by a Neev sandbox.
 * When the model calls it, the command runs in the gVisor-isolated sandbox and
 * its stdout/stderr **stream to your terminal as they are produced** (via
 * `sandbox.execStream`), not buffered to the end — so you watch the AI's code
 * run live. The full output is then fed back so the model can finish the task.
 *
 * This is a minimal hand-rolled tool-calling loop (no agent framework) so the
 * tool execution can stream; it talks to the OpenAI-compatible Neev inference
 * endpoint directly and needs only `@neev/sdk`.
 *
 * Install:
 *   npm install @neev/sdk
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agents/ai-interpreter.ts
 *
 * NEEV_API_KEY covers both the sandbox and (by fallback) the model; set
 * NEEV_INFERENCE_API_KEY if your inference key differs.
 */
import { Neev } from "@neev/sdk";
import { NEEV_INFERENCE_BASE_URL, NEEV_MODEL, neevInferenceApiKey } from "./model.js";

// The task the model solves by running shell in the sandbox.
const TASK =
  "Print every prime number below 50, one per line, then on the last line print " +
  "'count: N' with how many there were. Use the run_shell tool; the sandbox has " +
  "busybox sh only (no bash, no python).";

const REGION = process.env.NEEV_REGION ?? "as-south-1";
const MAX_STEPS = 6;

// ANSI helpers for a readable transcript.
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

// Minimal shapes of the OpenAI-compatible chat payloads we use.
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run a POSIX sh command in the secure sandbox and return its output.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to run" } },
        required: ["command"],
      },
    },
  },
];

// One chat-completions round against the Neev inference endpoint.
async function chat(messages: ChatMessage[]): Promise<ChatMessage> {
  const res = await fetch(`${NEEV_INFERENCE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${neevInferenceApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: NEEV_MODEL, messages, tools: TOOLS, temperature: 0 }),
  });
  if (!res.ok) throw new Error(`inference ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: ChatMessage }[] };
  return data.choices[0]?.message ?? { role: "assistant", content: "" };
}

async function main(): Promise<void> {
  const neev = new Neev();
  console.error(dim(`creating sandbox (region=${REGION})…`));
  const sandbox = await neev.sandboxes.create({
    name: `ai-${Math.random().toString(36).slice(2, 8)}`,
    sandbox_template_id: "sb-ubuntu-26-04-minimal",
    region: REGION,
  });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a coding assistant. You have a run_shell tool that executes POSIX sh " +
        "in a secure sandbox (busybox sh; no bash, no python). Use as few commands as " +
        "possible — never re-run a command that already succeeded — then reply with a " +
        "single concise final line.",
    },
    { role: "user", content: TASK },
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const message = await chat(messages);
      messages.push(message);

      if (message.tool_calls?.length) {
        for (const call of message.tool_calls) {
          const args = JSON.parse(call.function.arguments || "{}") as { command?: string };
          const command = args.command ?? "";
          console.log(`\n${cyan(`$ ${command}`)}`);

          // Stream the command's output to the terminal as it runs.
          let stdout = "";
          let stderr = "";
          let exitCode = 0;
          for await (const event of sandbox.execStream(["sh", "-c", command], {
            timeoutMs: 60_000,
          })) {
            if (event.type === "stdout") {
              process.stdout.write(event.data);
              stdout += event.data;
            } else if (event.type === "stderr") {
              process.stderr.write(event.data);
              stderr += event.data;
            } else {
              exitCode = event.exitCode;
            }
          }
          console.log(dim(`(exit ${exitCode})`));

          // Feed the result back so the model can continue.
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `exit_code: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`.slice(
              0,
              4000,
            ),
          });
        }
        continue;
      }

      // No tool call → the model's final answer.
      if (message.content) console.log(`\n${green(message.content.trim())}`);
      return;
    }
    console.error(dim(`stopped after ${MAX_STEPS} steps`));
  } finally {
    console.error(dim(`deleting sandbox ${sandbox.id}`));
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
