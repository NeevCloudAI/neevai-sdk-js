/**
 * Create a sandbox, wait for it to become Ready, read its metrics, then clean up.
 *
 * Run with:
 *   NEEVAI_API_KEY=... NEEVAI_ORG_ID=... NEEVAI_PROJECT_ID=... \
 *     npx tsx examples/create-sandbox.ts
 */
import { NeevAI } from "@neevai/sdk";

// Construct the client from NEEVAI_* environment variables.
const neev = new NeevAI();

async function main(): Promise<void> {
  // Provision a sandbox from a container image.
  const sandbox = await neev.sandboxes.create({
    name: "example-agent",
    image: "ghcr.io/neevcloud/agent-base:latest",
  });
  console.log(`created ${sandbox.id} (phase: ${sandbox.phase})`);

  // Block until the control plane reports the sandbox as Ready.
  await sandbox.waitUntilReady();
  console.log(`ready at ${sandbox.connectUrl ?? "(no connect url)"}`);

  // Read the live metric series for the sandbox.
  const metrics = await sandbox.metrics();
  console.log(`metric series: ${metrics.series.map((s) => s.metric).join(", ")}`);

  // Pause to release compute, then delete to clean up.
  await sandbox.pause();
  console.log(`paused (replicas: ${sandbox.replicas})`);
  await sandbox.delete();
  console.log("deleted");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
