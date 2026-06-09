/**
 * Stream a command's output from a sandbox as it is produced.
 *
 * `sandbox.execStream(...)` is an async generator: it yields `stdout`/`stderr`
 * text chunks the moment the daemon flushes them, then a terminal `exit` event.
 * This runs a command that prints a line per second and logs each chunk with the
 * elapsed time, so you can see the ~1s spacing — proof the output arrives live
 * rather than all at once at the end (which is what the buffered `exec` returns).
 *
 * Run (targets the Neev production API by default; override with NEEV_BASE_URL):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/streaming-exec.ts
 */
import { Neev } from "@neev/sdk";

const neev = new Neev();

// Production region; override with NEEV_REGION for another environment.
const REGION = process.env.NEEV_REGION ?? "as-south-1";

const start = Date.now();
// Logs with the milliseconds elapsed since start, so streaming is visible.
function log(message: string): void {
  console.error(`[+${String(Date.now() - start).padStart(5)}ms] ${message}`);
}

async function main(): Promise<void> {
  log("creating sandbox…");
  const sandbox = await neev.sandboxes.create({
    name: `stream-${Math.random().toString(36).slice(2, 8)}`,
    sandbox_template_id: "sb-ubuntu-26-04-minimal",
    region: REGION,
  });

  try {
    // Emit one line per second for 5 seconds, then a line on stderr.
    const command = [
      "sh",
      "-c",
      'i=1; while [ $i -le 5 ]; do echo "line $i"; sleep 1; i=$((i+1)); done; echo "(done)" >&2',
    ];

    let exitCode = 0;
    for await (const event of sandbox.execStream(command, { timeoutMs: 30_000 })) {
      if (event.type === "stdout") log(`stdout: ${event.data.trimEnd()}`);
      else if (event.type === "stderr") log(`stderr: ${event.data.trimEnd()}`);
      else exitCode = event.exitCode;
    }
    log(`exit ${exitCode}`);
  } finally {
    log("deleting sandbox…");
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
