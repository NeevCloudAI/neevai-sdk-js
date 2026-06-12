/**
 * Snapshot & fork — does a workspace file survive each path?
 *
 * Flow: create a sandbox → write a file → take a snapshot → fork a new sandbox
 * from the LIVE state → fork another from the SNAPSHOT → restore the original in
 * place from the snapshot → re-read the file on each and report PASS/FAIL. A
 * sandbox can be forked from either a live sandbox or a snapshot, so both paths
 * are exercised. Every step logs what it is doing (with elapsed time) so the flow
 * is easy to follow.
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

// Retry a runtime call while the data-plane endpoint is still routing. A freshly
// forked or restored sandbox reports Ready before the gateway has a route to its
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

// Inspect a Ready sandbox two ways and report whether FILE survived: an `ls -la`
// via exec (so the workspace contents are printed verbatim) and a direct file
// read (so a missing file shows up as a 404 and a changed file as a content
// mismatch).
async function checkFile(sandbox: Sandbox, label: string): Promise<void> {
  const ls = await sandbox.exec(["sh", "-c", "ls -la"]);
  log(`  [${label}] ls -la (exit ${ls.exitCode}):`);
  for (const line of ls.stdout.trimEnd().split("\n")) log(`      ${line}`);
  try {
    const got = await sandbox.files.readText(FILE);
    log(`  [${label}] read ${FILE} = ${JSON.stringify(got.trim())}`);
    log(
      got === CONTENT
        ? `  RESULT (${label}): file survived ✅`
        : `  RESULT (${label}): file exists but content changed ⚠️`,
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
  let forkLive: Sandbox | undefined;
  let forkSnap: Sandbox | undefined;
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

    // Step 4a: fork a brand-new sandbox from the source's *current* live state.
    // `fork` snapshots the live state atomically and seeds the new sandbox from
    // it; the source keeps running. Then check the file came across.
    log("step 4a: forking a new sandbox from the LIVE state…");
    forkLive = await neev.sandboxes.fork(source.id, `fork-live-${Date.now()}`);
    await forkLive.waitUntilReady();
    log(`  fork-live ${forkLive.id} ready — reading ${FILE}…`);
    await whileEndpointSettles("fork-live", () => checkFile(forkLive as Sandbox, "fork-live"));

    // Step 4b: fork another sandbox FROM THE SNAPSHOT. Passing `from_snapshot`
    // restores the new sandbox from that snapshot instead of cold-starting from
    // the image; the region must match the snapshot's origin. Then check the file.
    log("step 4b: forking a new sandbox from the SNAPSHOT…");
    forkSnap = await neev.sandboxes.create({
      name: `fork-snap-${Date.now()}`,
      from_snapshot: snapshot.id,
      region: process.env.NEEV_REGION,
    });
    await forkSnap.waitUntilReady();
    log(`  fork-snapshot ${forkSnap.id} ready — reading ${FILE}…`);
    await whileEndpointSettles("fork-snapshot", () =>
      checkFile(forkSnap as Sandbox, "fork-snapshot"),
    );

    // Step 5: restore the original sandbox in place from the snapshot, wait for
    // it to come back Ready, then check the file is restored.
    log("step 5: restoring the source in place from the snapshot…");
    await source.restore(snapshot.id);
    await source.waitUntilReady();
    log(`  restored phase=${source.phase} — reading ${FILE}…`);
    await whileEndpointSettles("restore", () => checkFile(source, "restore"));
  } finally {
    // Always clean up everything this example created.
    log("cleanup: deleting sandboxes and snapshot…");
    await Promise.all([
      source.delete().catch(() => undefined),
      forkLive?.delete().catch(() => undefined),
      forkSnap?.delete().catch(() => undefined),
      snapshot ? neev.sandboxes.deleteSnapshot(snapshot.id).catch(() => undefined) : undefined,
    ]);
    log("  cleaned up.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
