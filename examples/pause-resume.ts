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
    const presentBefore = await inspect(sandbox, "before");
    log(`  baseline: file present = ${presentBefore}`);

    // Step 4: pause — stops billable runtime (scales replicas to zero).
    log("step 4: pausing…");
    await sandbox.pause();
    log(`  paused phase=${sandbox.phase} replicas=${sandbox.replicas}`);

    // Step 5: resume / restart — scales back to one replica; wait until Ready.
    log("step 5: resuming…");
    await sandbox.resume();
    log(`  resume issued phase=${sandbox.phase} — waiting until Ready…`);
    await sandbox.waitUntilReady({ timeoutMs: 300_000 });
    log(`  ready again phase=${sandbox.phase} connectUrl=${sandbox.connectUrl}`);

    // Step 6: inspect the workspace AFTER resume and report the verdict.
    log("step 6: inspecting workspace after resume…");
    const survived = await inspect(sandbox, "after");
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
