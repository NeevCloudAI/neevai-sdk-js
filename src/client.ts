import { NeevAIError } from "./errors.js";
import { Sandboxes } from "./resources/sandboxes.js";
import { type FetchLike, Transport } from "./transport.js";

// Per-call override of the org/project the request targets. When omitted, the
// client-level defaults (constructor args or NEEVCLOUD_* env vars) are used.
export interface Scope {
  orgId?: string;
  projectId?: string;
}

// Configuration accepted by the NeevAI constructor. Every field is optional and
// falls back to a NEEVCLOUD_* environment variable or a built-in default.
export interface NeevAIOptions {
  // Bearer API key. Falls back to NEEVCLOUD_API_KEY. Required.
  apiKey?: string;
  // Default organization id. Falls back to NEEVCLOUD_ORG_ID.
  orgId?: string;
  // Default project id. Falls back to NEEVCLOUD_PROJECT_ID.
  projectId?: string;
  // Base URL of the NeevAI API. Falls back to NEEVCLOUD_BASE_URL, then the default host.
  baseURL?: string;
  // Per-request timeout in milliseconds. Defaults to 60000.
  timeoutMs?: number;
  // Maximum retries for transient failures (network, 429, 5xx). Defaults to 2.
  maxRetries?: number;
  // Custom fetch implementation. Defaults to the runtime's global fetch.
  fetch?: FetchLike;
}

// Internal contract the resource classes depend on, so they need only the
// transport and scope resolution rather than the whole client surface.
export interface RequestContext {
  readonly transport: Transport;
  resolveScope(scope?: Scope): { orgId: string; projectId: string };
}

// Default base URL of the NeevAI agent API.
const DEFAULT_BASE_URL = "https://agent.ai.neevcloud.com";
// Default per-request timeout in milliseconds.
const DEFAULT_TIMEOUT_MS = 60_000;
// Default number of retries for transient failures.
const DEFAULT_MAX_RETRIES = 2;

// The NeevAI platform client. Construct once and reuse; resource namespaces such
// as `sandboxes` hang off the instance.
export class NeevAI implements RequestContext {
  // HTTP transport shared by all resources on this client.
  readonly transport: Transport;
  // Sandbox lifecycle operations.
  readonly sandboxes: Sandboxes;

  private readonly defaultOrgId?: string;
  private readonly defaultProjectId?: string;

  constructor(options: NeevAIOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("NEEVCLOUD_API_KEY");
    if (!apiKey) {
      throw new NeevAIError(
        "Missing API key. Pass `apiKey` or set the NEEVCLOUD_API_KEY environment variable.",
      );
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new NeevAIError(
        "No global fetch found. Use Node 18+, Bun, Deno, or pass a `fetch` implementation.",
      );
    }

    this.defaultOrgId = options.orgId ?? readEnv("NEEVCLOUD_ORG_ID");
    this.defaultProjectId = options.projectId ?? readEnv("NEEVCLOUD_PROJECT_ID");

    this.transport = new Transport({
      baseURL: options.baseURL ?? readEnv("NEEVCLOUD_BASE_URL") ?? DEFAULT_BASE_URL,
      apiKey,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      fetch: fetchImpl.bind(globalThis),
    });

    this.sandboxes = new Sandboxes(this);
  }

  // Resolves the effective org/project for a call, preferring the per-call
  // override and falling back to the client defaults. Throws if either is unset.
  resolveScope(scope?: Scope): { orgId: string; projectId: string } {
    const orgId = scope?.orgId ?? this.defaultOrgId;
    const projectId = scope?.projectId ?? this.defaultProjectId;
    if (!orgId) {
      throw new NeevAIError(
        "Missing orgId. Set it on the client, via NEEVCLOUD_ORG_ID, or per call.",
      );
    }
    if (!projectId) {
      throw new NeevAIError(
        "Missing projectId. Set it on the client, via NEEVCLOUD_PROJECT_ID, or per call.",
      );
    }
    return { orgId, projectId };
  }
}

// Reads an environment variable when running on a platform that exposes
// `process.env`; returns undefined on runtimes without it.
function readEnv(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return undefined;
}
