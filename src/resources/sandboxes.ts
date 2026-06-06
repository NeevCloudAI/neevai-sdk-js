import type { Client } from "openapi-fetch";
import type { RequestContext, Scope } from "../client.js";
import type { paths } from "../generated/aiagent.js";
import { ensureOk, unwrap } from "../http.js";
import { Sandbox } from "../sandbox.js";
import type { SandboxConnection } from "../sandboxd.js";
import type {
  CreateSandboxParams,
  SandboxData,
  SandboxListResponse,
  SandboxMetricsResponse,
} from "../types.js";

// Spec path templates for the aiagent sandbox endpoints. openapi-fetch type-checks
// each call against these literal paths and the generated `paths` type.
const COLLECTION = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes";
const ITEM = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}";
const PAUSE = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/pause";
const RESUME = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/resume";
const METRICS = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/metrics";

// Parameters for listing sandboxes: pagination plus an optional scope override.
export interface ListSandboxesParams extends Scope {
  page?: number;
  limit?: number;
}

// A page of sandboxes, with the handles already wrapped and the paging metadata.
export interface SandboxPage {
  items: Sandbox[];
  total: number;
  page: number;
  limit: number;
}

// The time-window fields of a metrics read; shared by the resource method and the
// Sandbox handle. All optional — the server defaults to the last hour.
export interface MetricsQuery {
  // Start of the window (RFC3339). Defaults to one hour before `to`.
  from?: string;
  // End of the window (RFC3339). Defaults to now.
  to?: string;
  // Resolution as a Go duration (e.g. "60s", "5m"). Server clamps to a sane range.
  step?: string;
}

// Query window for a metrics read, plus an optional scope override.
export interface MetricsParams extends Scope, MetricsQuery {}

// Sandbox lifecycle operations. Exposed as `client.sandboxes`. Every method
// returns a Sandbox handle (or page of handles) so callers can chain lifecycle
// actions on the result.
export class Sandboxes {
  private readonly ctx: RequestContext;
  private readonly api: Client<paths>;

  constructor(ctx: RequestContext) {
    this.ctx = ctx;
    this.api = ctx.createTypedClient<paths>();
  }

  // Opens a connection to a sandbox daemon at the given connect_url. Used by the
  // Sandbox handle to back `sandbox.files` / `sandbox.exec`.
  connect(connectUrl: string): SandboxConnection {
    return this.ctx.createSandboxConnection(connectUrl);
  }

  // Creates a sandbox in the resolved org/project. The returned handle may still
  // be in the Pending phase — call `waitUntilReady` to block until it is Ready.
  async create(params: CreateSandboxParams, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(COLLECTION, {
      params: { path: { org_id: orgId, project_id: projectId } },
      body: params,
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Lists sandboxes in the resolved org/project, returning wrapped handles.
  async list(params: ListSandboxesParams = {}): Promise<SandboxPage> {
    const { page, limit, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(COLLECTION, {
      params: { path: { org_id: orgId, project_id: projectId }, query: { page, limit } },
    });
    const data = unwrap<SandboxListResponse>(res);
    return {
      items: data.items.map((item) => new Sandbox(this, item, scope)),
      total: data.total,
      page: data.page,
      limit: data.limit,
    };
  }

  // Fetches a single sandbox by id.
  async get(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Pauses a sandbox (scales it to zero replicas) and returns the updated handle.
  async pause(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(PAUSE, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Resumes a paused sandbox (scales it to one replica) and returns the updated handle.
  async resume(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(RESUME, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Permanently deletes a sandbox, removing the Kubernetes CR and the DB row.
  async delete(id: string, scope?: Scope): Promise<void> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.DELETE(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    ensureOk(res);
  }

  // Reads the live, tenant-scoped metric series for a sandbox.
  async metrics(id: string, params: MetricsParams = {}): Promise<SandboxMetricsResponse> {
    const { from, to, step, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(METRICS, {
      params: {
        path: { org_id: orgId, project_id: projectId, sandbox_id: id },
        query: { from, to, step },
      },
    });
    return unwrap<SandboxMetricsResponse>(res);
  }
}
