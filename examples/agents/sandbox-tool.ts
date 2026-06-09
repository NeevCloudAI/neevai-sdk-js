/**
 * Shared, framework-agnostic helper used by the agent examples in this folder.
 *
 * `SandboxCodeExecutor` wraps `@neev/sdk` and exposes two capabilities an agent
 * can call as tools: run Python and run shell commands inside a gVisor-isolated
 * Neev sandbox. It provisions a single sandbox lazily on first use and reuses it
 * across calls, then tears it down on `cleanup()`.
 *
 * The same executor instance is passed to the LangChain, Genkit, and Vercel AI
 * SDK examples so each file only contains the framework-specific wiring.
 */
import { Neev, type Sandbox } from "@neev/sdk";

// The buffered output of one sandbox command, shaped for an LLM to read.
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Options for the executor. Defaults target the public sandbox catalogue.
export interface SandboxCodeExecutorOptions {
  // Catalogue template id the sandbox is created from. Use a Python-capable
  // template for `runPython`.
  templateId?: string;
  // Region to provision in. Defaults to the production region `as-south-1`.
  region?: string;
  // Prefix for the generated sandbox name.
  namePrefix?: string;
}

// A reusable code executor backed by one Neev sandbox. Construct once per agent
// run, share it across tools, and call `cleanup()` when the run finishes.
export class SandboxCodeExecutor {
  private readonly neev: Neev;
  private readonly templateId: string;
  private readonly region: string;
  private readonly namePrefix: string;
  private sandbox?: Sandbox;

  constructor(options: SandboxCodeExecutorOptions = {}) {
    // Reads NEEV_API_KEY / NEEV_ORG_ID / NEEV_PROJECT_ID from the environment
    // and targets the Neev production API by default (override with NEEV_BASE_URL).
    this.neev = new Neev();
    this.templateId = options.templateId ?? "sb-ubuntu-26-04-minimal";
    this.region = options.region ?? "as-south-1";
    this.namePrefix = options.namePrefix ?? "agent-demo";
  }

  // Provisions the sandbox on first use and reuses it afterwards. `files`/`exec`
  // auto-wait until the sandbox is Ready, so no explicit poll is needed here.
  private async ensure(): Promise<Sandbox> {
    if (!this.sandbox) {
      const suffix = Math.random().toString(36).slice(2, 8);
      this.sandbox = await this.neev.sandboxes.create({
        name: `${this.namePrefix}-${suffix}`,
        sandbox_template_id: this.templateId,
        region: this.region,
      });
    }
    return this.sandbox;
  }

  // Writes the given Python source into the sandbox and runs it with python3.
  // Paths are workspace-relative (the daemon rejects absolute paths). Requires a
  // python-capable template; the minimal catalogue images do not ship python3.
  async runPython(code: string): Promise<RunResult> {
    const sandbox = await this.ensure();
    await sandbox.files.write("snippet.py", code);
    return sandbox.exec(["python3", "snippet.py"]);
  }

  // Runs a shell command inside the sandbox. Uses `sh`, which is present on the
  // minimal catalogue images (they do not ship bash).
  async runShell(command: string): Promise<RunResult> {
    const sandbox = await this.ensure();
    return sandbox.exec(["sh", "-c", command]);
  }

  // Deletes the sandbox if one was provisioned. Safe to call when none was.
  async cleanup(): Promise<void> {
    if (this.sandbox) {
      await this.sandbox.delete();
      this.sandbox = undefined;
    }
  }
}

// Renders a RunResult as a compact text block for an LLM tool response.
export function formatRunResult(result: RunResult): string {
  const parts = [`exit code: ${result.exitCode}`];
  if (result.stdout.trim().length > 0) parts.push(`stdout:\n${result.stdout.trim()}`);
  if (result.stderr.trim().length > 0) parts.push(`stderr:\n${result.stderr.trim()}`);
  return parts.join("\n");
}
