/**
 * Create a sandbox that auto-expires after a TTL, so an abandoned sandbox is
 * reclaimed without an explicit delete.
 *
 * Run with (targets the Neev production API by default; override with
 * NEEV_BASE_URL, and the region with NEEV_REGION):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/create-sandbox-with-ttl.ts
 */
import { Neev } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

async function main(): Promise<void> {
  // Provision a sandbox that the platform auto-shuts-down one hour after
  // creation. Template and region use the platform defaults; set NEEV_REGION to
  // pin a region (e.g. on dev). Omit `lifecycle` for a sandbox with no expiry.
  const sandbox = await neev.sandboxes.create({
    name: "ephemeral-agent",
    region: process.env.NEEV_REGION,
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
