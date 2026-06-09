import type { Scope } from "./client.js";
import { NeevError } from "./errors.js";
import type { MetricsQuery, Sandboxes } from "./resources/sandboxes.js";
import { SandboxFiles } from "./sandboxd.js";
import type { ExecOptions, ExecResult, SandboxConnection } from "./sandboxd.js";
import type {
  SandboxData,
  SandboxMetricsResponse,
  SandboxPhase,
  SandboxResources,
} from "./types.js";

// Options controlling how long `waitUntilReady` polls before giving up.
export interface WaitOptions {
  // Maximum time to wait for the Ready phase, in milliseconds. Defaults to 120000.
  timeoutMs?: number;
  // Delay between status polls, in milliseconds. Defaults to 2000.
  pollIntervalMs?: number;
}

// Default overall wait budget for waitUntilReady, in milliseconds.
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
// Default delay between status polls, in milliseconds.
const DEFAULT_POLL_INTERVAL_MS = 2_000;

// A live handle to a single sandbox. Carries the latest known server state and
// offers lifecycle actions that operate on this sandbox in place. Construct via
// the `sandboxes` resource rather than directly.
export class Sandbox {
  private readonly sandboxes: Sandboxes;
  private readonly scope?: Scope;
  private state: SandboxData;
  // Cached daemon connection and the connect_url it was built for, so the
  // connection is reused across calls but rebuilt if the URL changes.
  private conn?: SandboxConnection;
  private connUrl?: string;
  // Cached files facade; its connection is resolved lazily on first use.
  private filesProxy?: SandboxFiles;

  constructor(sandboxes: Sandboxes, data: SandboxData, scope?: Scope) {
    this.sandboxes = sandboxes;
    this.state = data;
    this.scope = scope;
  }

  // Sandbox UUID.
  get id(): string {
    return this.state.id;
  }

  // Human-readable sandbox name.
  get name(): string {
    return this.state.name;
  }

  // Current lifecycle phase as last seen from the server.
  get phase(): SandboxPhase {
    return this.state.phase;
  }

  // Desired replica count (0 when paused, 1 when running).
  get replicas(): number {
    return this.state.replicas;
  }

  // Direct address of the sandbox daemon, or null when not configured.
  get connectUrl(): string | null {
    return this.state.connect_url ?? null;
  }

  // Region slug the sandbox runs in.
  get region(): string {
    return this.state.region;
  }

  // Catalogue template id the sandbox was created from, or null when unknown.
  get templateId(): string | null {
    return this.state.sandbox_template_id ?? null;
  }

  // Compute size the sandbox was provisioned with, or undefined when defaulted.
  get resources(): SandboxResources | undefined {
    return this.state.resources;
  }

  // Filesystem operations on this sandbox's daemon. Each operation resolves the
  // connection lazily: if the sandbox has no connect_url yet, the first call
  // waits until it is Ready to obtain one.
  get files(): SandboxFiles {
    if (!this.filesProxy) {
      this.filesProxy = new SandboxFiles(() => this.ensureConnection());
    }
    return this.filesProxy;
  }

  // Runs a command in the sandbox and returns its buffered output. If the sandbox
  // has no connect_url yet, waits until it is Ready first. A non-zero exit code is
  // returned, not thrown.
  async exec(command: string | string[], options: ExecOptions = {}): Promise<ExecResult> {
    const conn = await this.ensureConnection();
    return conn.exec(command, options);
  }

  // Full raw sandbox record exactly as returned by the API.
  get data(): SandboxData {
    return this.state;
  }

  // Returns the raw record so JSON.stringify(sandbox) emits the API shape.
  toJSON(): SandboxData {
    return this.state;
  }

  // Re-fetches the sandbox and updates this handle's state in place.
  async refresh(): Promise<this> {
    const fresh = await this.sandboxes.get(this.id, this.scope);
    this.state = fresh.data;
    return this;
  }

  // Pauses the sandbox (scales to zero replicas) and updates this handle.
  async pause(): Promise<this> {
    const next = await this.sandboxes.pause(this.id, this.scope);
    this.state = next.data;
    return this;
  }

  // Resumes the sandbox (scales to one replica) and updates this handle.
  async resume(): Promise<this> {
    const next = await this.sandboxes.resume(this.id, this.scope);
    this.state = next.data;
    return this;
  }

  // Permanently deletes the sandbox.
  async delete(): Promise<void> {
    await this.sandboxes.delete(this.id, this.scope);
  }

  // Reads the live metric series for this sandbox.
  async metrics(params: MetricsQuery = {}): Promise<SandboxMetricsResponse> {
    return this.sandboxes.metrics(this.id, { ...params, ...this.scope });
  }

  // Resolves the daemon connection for this sandbox, caching it by connect_url.
  // When connect_url is not yet known (a freshly-created Pending sandbox), waits
  // until the sandbox is Ready to obtain one. The cached connection is rebuilt if
  // the connect_url changes (e.g. across a resume). Throws if the sandbox is Ready
  // but still exposes no connect_url.
  private async ensureConnection(): Promise<SandboxConnection> {
    if (!this.state.connect_url) {
      await this.waitUntilReady();
    }
    const connectUrl = this.state.connect_url;
    if (!connectUrl) {
      throw new NeevError(
        `Sandbox ${this.id} is Ready but has no connect_url; runtime operations are unavailable.`,
      );
    }
    if (!this.conn || this.connUrl !== connectUrl) {
      this.conn = this.sandboxes.connect(connectUrl);
      this.connUrl = connectUrl;
    }
    return this.conn;
  }

  // Polls until the sandbox reaches the Ready phase, then resolves with this
  // handle. Fails fast if the sandbox is Paused (it will never become Ready on
  // its own) and throws a NeevError if the timeout elapses first.
  async waitUntilReady(options: WaitOptions = {}): Promise<this> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;

    // Poll the live phase until Ready, a terminal Paused state, or the deadline.
    while (true) {
      if (this.phase === "Ready") return this;
      if (this.phase === "Paused") {
        throw new NeevError(
          `Sandbox ${this.id} is Paused and will not become Ready; call resume() first.`,
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new NeevError(
          `Sandbox ${this.id} did not become Ready within ${timeoutMs}ms (phase: ${this.phase}).`,
        );
      }
      await sleep(Math.min(pollIntervalMs, remaining));
      await this.refresh();
    }
  }
}

// Resolves after the given number of milliseconds.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
