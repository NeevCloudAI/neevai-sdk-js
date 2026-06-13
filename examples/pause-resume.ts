/**
 * Pause / resume — does a workspace file survive a pause/resume cycle?
 *
 * Flow: create a sandbox → write a file → list + read it back → pause → resume →
 * list + read the file again, reporting whether it survived. Each step logs what
 * it is doing (with elapsed time), and every check is cross-confirmed two ways —
 * an `ls -la` of the workspace via exec AND a direct file read — so the result is
 * unambiguous.
 *
 * Run (targets the Neev production API by default; override with NEEV_BASE_URL,
 * and pin a region with NEEV_REGION — e.g. on dev):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/pause-resume.ts
 */
import { Neev, NotFoundError } from "@neevcloud/sdk";
import type { Sandbox } from "@neevcloud/sdk";

// Tiny logger with elapsed-ms prefixes so the lifecycle timing is visible.
const start = Date.now();
const log = (msg: string) => console.log(`[+${String(Date.now() - start).padStart(6)}ms] ${msg}`);

// Reads NEEV_API_KEY / NEEV_BASE_URL / NEEV_ORG_ID / NEEV_PROJECT_ID from the env.
const neev = new Neev();

const FILE = "note.txt";
const CONTENT = "hello from before pause\n";

// Retry a runtime call while the data-plane endpoint is still routing. After a
// resume the control plane reports Ready before the gateway has a route to the new
// pod, so the first calls can fail with a transient 502/503 ("no route to host").
// Runtime calls are not auto-retried by the SDK, so we retry here briefly.
async function whileEndpointSettles<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const transient = status === 502 || status === 503 || status === 504;
      if (!transient || Date.now() > deadline) throw err;
      log(`  [${label}] endpoint not routable yet (HTTP ${status}); retrying…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Poll the sandbox until it reaches the given phase (or times out). Used to wait
// out the asynchronous pause — which returns while still "Pausing" — before
// resuming, so the settling pause does not clobber the resume.
async function waitForPhase(sandbox: Sandbox, phase: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sandbox.refresh();
    if (sandbox.phase === phase) return;
    if (Date.now() > deadline) {
      throw new Error(
        `sandbox did not reach ${phase} within ${timeoutMs}ms (phase=${sandbox.phase})`,
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Inspect the workspace two ways and report whether FILE is present with the
// expected content: an `ls -la` via exec (so the directory contents are printed
// verbatim) and a direct file read (so a missing file shows up as a 404).
// Returns true only when the file exists and its content is unchanged.
async function inspect(sandbox: Sandbox, label: string): Promise<boolean> {
  const ls = await sandbox.exec(["sh", "-c", "ls -la"]);
  log(`  [${label}] ls -la (exit ${ls.exitCode}):`);
  for (const line of ls.stdout.trimEnd().split("\n")) log(`      ${line}`);
  try {
    const content = await sandbox.files.readText(FILE);
    log(`  [${label}] read ${FILE} = ${JSON.stringify(content.trim())}`);
    return content === CONTENT;
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    log(`  [${label}] read ${FILE} → 404 not_found (the file is gone)`);
    return false;
  }
}

async function main(): Promise<void> {
  // Step 1: create a sandbox. Only `name` is required — the server defaults the
  // template and region. Set NEEV_REGION (e.g. on dev) to pin a region.
  log("step 1: creating sandbox…");
  const sandbox = await neev.sandboxes.create({
    name: `pause-resume-${Date.now()}`,
    region: process.env.NEEV_REGION,
  });
  log(`  created id=${sandbox.id} phase=${sandbox.phase}`);

  try {
    // Step 1b: block until the sandbox is Ready and has a runtime endpoint.
    log("step 1b: waiting until Ready…");
    await sandbox.waitUntilReady();
    log(`  ready phase=${sandbox.phase} connectUrl=${sandbox.connectUrl}`);

    // Step 2: write a file into the workspace (paths are workspace-relative).
    log(`step 2: writing ${FILE} (${CONTENT.length} bytes)…`);
    const { bytesWritten } = await sandbox.files.write(FILE, CONTENT);
    log(`  wrote ${bytesWritten} bytes`);

    // Step 3: confirm the file is there BEFORE pausing (baseline).
    log("step 3: inspecting workspace before pause…");
    const presentBefore = await whileEndpointSettles("before", () => inspect(sandbox, "before"));
    log(`  baseline: file present = ${presentBefore}`);

    // Step 4: pause — stops billable runtime (scales replicas to zero). Pausing is
    // asynchronous: the call returns immediately with phase "Pausing" while the
    // workspace is snapshotted and the pod scaled down in the background. Wait until
    // it has fully settled to "Paused" before resuming, otherwise the in-flight
    // pause would clobber the resume and the sandbox would bounce back to Paused.
    log("step 4: pausing…");
    await sandbox.pause();
    log(`  pause issued phase=${sandbox.phase} — waiting until Paused…`);
    await waitForPhase(sandbox, "Paused");
    log(`  paused phase=${sandbox.phase} replicas=${sandbox.replicas}`);

    // Step 5: resume / restart — scales back to one replica; wait until Ready.
    log("step 5: resuming…");
    await sandbox.resume();
    log(`  resume issued phase=${sandbox.phase} — waiting until Ready…`);
    await sandbox.waitUntilReady({ timeoutMs: 300_000 });
    log(`  ready again phase=${sandbox.phase} connectUrl=${sandbox.connectUrl}`);

    // Step 6: inspect the workspace AFTER resume and report the verdict. The
    // endpoint may take a moment to route to the freshly resumed pod.
    log("step 6: inspecting workspace after resume…");
    const survived = await whileEndpointSettles("after", () => inspect(sandbox, "after"));
    log(
      survived
        ? "RESULT: the file survived pause/resume ✅"
        : "RESULT: the file did NOT survive pause/resume ❌",
    );
  } finally {
    // Always clean up, even if a step above failed.
    log("cleanup: deleting the sandbox…");
    await sandbox.delete().catch(() => undefined);
    log("  deleted.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
