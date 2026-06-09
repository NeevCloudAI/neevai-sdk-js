/**
 * Create a sandbox, wait for it to become Ready, read its metrics, then clean up.
 *
 * Run with (targets the Neev production API by default; override with
 * NEEV_BASE_URL):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/create-sandbox.ts
 */
import { Neev } from "@neev/sdk";

// Construct the client from NEEV_* environment variables. Targets the Neev
// production API by default.
const neev = new Neev();

// Production region for sandbox provisioning.
const REGION = "as-south-1";

async function main(): Promise<void> {
  // Pick a runtime template from the platform catalogue. Create resolves the
  // image and default command from the chosen template.
  const templates = await neev.templates.list();
  const template = templates.items.find((t) => t.status === "active") ?? templates.items[0];
  if (!template) throw new Error("no sandbox templates available");

  // Provision a sandbox from the selected template in the production region.
  const sandbox = await neev.sandboxes.create({
    name: "example-agent",
    sandbox_template_id: template.id,
    region: REGION,
  });
  console.log(`created ${sandbox.id} from ${template.id} (phase: ${sandbox.phase})`);

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
