/**
 * Create a sandbox that auto-expires after a TTL, so an abandoned sandbox is
 * reclaimed without an explicit delete.
 *
 * Run with (targets the Neev production API by default; override with
 * NEEV_BASE_URL):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/create-sandbox-with-ttl.ts
 */
import { Neev } from "@neev/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

// Production region for sandbox provisioning.
const REGION = "as-south-1";

async function main(): Promise<void> {
  // Pick a runtime template from the platform catalogue.
  const templates = await neev.templates.list();
  const template = templates.items.find((t) => t.status === "active") ?? templates.items[0];
  if (!template) throw new Error("no sandbox templates available");

  // Provision a sandbox that the platform auto-shuts-down one hour after
  // creation. Omit `lifecycle` for a sandbox with no expiry.
  const sandbox = await neev.sandboxes.create({
    name: "ephemeral-agent",
    sandbox_template_id: template.id,
    region: REGION,
    lifecycle: { ttl_seconds: 3600 },
  });
  console.log(`created ${sandbox.id}; auto-expires ~1h from now (phase: ${sandbox.phase})`);

  // Use it as normal; no explicit cleanup is required once the TTL elapses.
  await sandbox.waitUntilReady();
  console.log(`ready at ${sandbox.connectUrl ?? "(no connect url)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
