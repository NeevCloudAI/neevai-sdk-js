import createClient, { type Client } from "openapi-fetch";
import { NeevAIError } from "./errors.js";
import { type Dispatch, type FetchLike, RawClient, createDispatch } from "./http.js";
import { Sandboxes } from "./resources/sandboxes.js";
import { SandboxConnection } from "./sandboxd.js";

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

// Internal contract the resource classes depend on. Provides both a typed,
// spec-driven client (createTypedClient) and an untyped escape hatch (raw) for
// endpoints that do not have an OpenAPI spec yet — both share one transport.
export interface RequestContext {
  // Builds an openapi-fetch client for a service's generated `paths` type.
  createTypedClient<Paths extends {}>(): Client<Paths>;
  // Untyped client for spec-less endpoints.
  readonly raw: RawClient;
  // Opens a data-plane connection to a sandbox daemon at its connect_url. Uses a
  // no-retry transport so non-idempotent data-plane calls never double-fire.
  createDataPlaneClient(connectUrl: string): SandboxConnection;
  // Resolves the effective org/project for a call.
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
  // Untyped client for endpoints that do not have an OpenAPI spec yet.
  readonly raw: RawClient;
  // Sandbox lifecycle operations.
  readonly sandboxes: Sandboxes;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly dispatch: Dispatch;
  private readonly dataDispatch: Dispatch;
  private readonly defaultOrgId?: string;
  private readonly defaultProjectId?: string;

  constructor(options: NeevAIOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("NEEVCLOUD_API_KEY");
    if (!apiKey) {
      throw new NeevAIError(
        "Missing API key. Pass `apiKey` or set the NEEVCLOUD_API_KEY environment variable.",
      );
    }

    const baseFetch = options.fetch ?? globalThis.fetch;
    if (!baseFetch) {
      throw new NeevAIError(
        "No global fetch found. Use Node 18+, Bun, Deno, or pass a `fetch` implementation.",
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = options.baseURL ?? readEnv("NEEVCLOUD_BASE_URL") ?? DEFAULT_BASE_URL;
    this.defaultOrgId = options.orgId ?? readEnv("NEEVCLOUD_ORG_ID");
    this.defaultProjectId = options.projectId ?? readEnv("NEEVCLOUD_PROJECT_ID");
    const boundFetch = baseFetch.bind(globalThis);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dispatch = createDispatch({
      fetch: boundFetch,
      timeoutMs,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    });
    // The data plane never retries: exec/write are not idempotent, so a retried
    // 5xx could run a command or write a file twice.
    this.dataDispatch = createDispatch({ fetch: boundFetch, timeoutMs, maxRetries: 0 });

    this.raw = new RawClient({ baseUrl: this.baseUrl, apiKey, dispatch: this.dispatch });
    this.sandboxes = new Sandboxes(this);
  }

  // Opens a data-plane connection to a sandbox daemon at its connect_url, backed
  // by this client's bearer auth and the no-retry transport.
  createDataPlaneClient(connectUrl: string): SandboxConnection {
    return new SandboxConnection({ connectUrl, apiKey: this.apiKey, dispatch: this.dataDispatch });
  }

  // Builds a typed openapi-fetch client for a service's generated `paths` type,
  // backed by this client's shared transport and bearer auth.
  createTypedClient<Paths extends {}>(): Client<Paths> {
    return createClient<Paths>({
      baseUrl: this.baseUrl,
      fetch: this.dispatch,
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
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
