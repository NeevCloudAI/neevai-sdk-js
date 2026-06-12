/**
 * Snapshot & fork — does a workspace file survive each path?
 *
 * Flow: create a sandbox → write a file → take a snapshot → fork a new sandbox
 * from the live state and re-read the file there → restore the original from the
 * snapshot and re-read the file → report PASS/FAIL for each path. Every step logs
 * what it is doing (with elapsed time) so the flow is easy to follow.
 *
 * Run (targets the Neev production API by default; override with NEEV_BASE_URL,
 * and pin a region with NEEV_REGION — e.g. on dev):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/snapshot-fork.ts
 */
import { Neev, NotFoundError } from "@neevcloud/sdk";
import type { Sandbox, SnapshotData } from "@neevcloud/sdk";

// Tiny logger with elapsed-ms prefixes so the timing of each step is visible.
const start = Date.now();
const log = (msg: string) => console.log(`[+${String(Date.now() - start).padStart(6)}ms] ${msg}`);

// Reads NEEV_API_KEY / NEEV_BASE_URL / NEEV_ORG_ID / NEEV_PROJECT_ID from the env.
const neev = new Neev();

const FILE = "state.txt";
const CONTENT = "captured before snapshot\n";

// Poll a snapshot until it is Ready (or fails / times out). A snapshot is created
// Pending and must reach Ready before it can be restored or relied upon.
async function waitForSnapshot(id: string, timeoutMs = 120_000): Promise<SnapshotData> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await neev.sandboxes.getSnapshot(id);
    if (snap.status === "Ready") return snap;
    if (snap.status === "Failed")
      throw new Error(`snapshot ${id} failed: ${snap.error_message ?? ""}`);
    if (Date.now() > deadline) throw new Error(`snapshot ${id} not ready within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Read FILE from a Ready sandbox and report whether it matches what was written.
// A 404 means the workspace did not carry the file across the snapshot/fork.
async function checkFile(sandbox: Sandbox, label: string): Promise<void> {
  try {
    const got = await sandbox.files.readText(FILE);
    log(`  ${label}: content = ${JSON.stringify(got.trim())}`);
    log(
      got === CONTENT
        ? `  RESULT (${label}): file survived ✅`
        : `  RESULT (${label}): file changed ⚠️`,
    );
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    log(`  RESULT (${label}): file is gone (404) ❌`);
  }
}

async function main(): Promise<void> {
  // Step 1: create the source sandbox. Only `name` is required — the server
  // defaults the template and region. Set NEEV_REGION (e.g. on dev) to pin one.
  log("step 1: creating source sandbox…");
  const source = await neev.sandboxes.create({
    name: `snapshot-fork-${Date.now()}`,
    region: process.env.NEEV_REGION,
  });
  log(`  created id=${source.id} phase=${source.phase}`);

  // Forks are created lazily inside the try so cleanup can always reach them.
  let fork: Sandbox | undefined;
  let snapshot: SnapshotData | undefined;

  try {
    // Step 1b: wait until the source is Ready and has a runtime endpoint.
    log("step 1b: waiting until source is Ready…");
    await source.waitUntilReady();
    log(`  ready phase=${source.phase} connectUrl=${source.connectUrl}`);

    // Step 2: write a file and read it back to confirm it is there.
    log(`step 2: writing ${FILE} (${CONTENT.length} bytes) and reading it back…`);
    await source.files.write(FILE, CONTENT);
    const before = await source.files.readText(FILE);
    log(`  content BEFORE snapshot = ${JSON.stringify(before.trim())}`);

    // Step 3: capture a snapshot of the source and wait until it is Ready.
    log("step 3: snapshotting the source…");
    const pending = await source.snapshot({ name: "demo-snap" });
    snapshot = await waitForSnapshot(pending.id);
    log(`  snapshot ${snapshot.id} ready (${snapshot.size_bytes ?? "?"} bytes)`);

    // Step 4: fork a brand-new sandbox from the source's *current* live state
    // (fork snapshots the live state atomically; it does not consume the
    // snapshot from step 3). Then check the file came across.
    log("step 4: forking a new sandbox from the live state…");
    fork = await neev.sandboxes.fork(source.id, "snapshot-fork");
    await fork.waitUntilReady();
    log(`  fork ${fork.id} ready — reading ${FILE}…`);
    await checkFile(fork, "fork");

    // Step 5: restore the original sandbox in place from the snapshot, wait for
    // it to come back Ready, then check the file is restored.
    log("step 5: restoring the source from the snapshot…");
    await source.restore(snapshot.id);
    await source.waitUntilReady();
    log(`  restored phase=${source.phase} — reading ${FILE}…`);
    await checkFile(source, "restore");
  } finally {
    // Always clean up everything this example created.
    log("cleanup: deleting sandboxes and snapshot…");
    await Promise.all([
      source.delete().catch(() => undefined),
      fork?.delete().catch(() => undefined),
      snapshot ? neev.sandboxes.deleteSnapshot(snapshot.id).catch(() => undefined) : undefined,
    ]);
    log("  cleaned up.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
