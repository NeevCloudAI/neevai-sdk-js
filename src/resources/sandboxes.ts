import type { RequestContext, Scope } from "../client.js";
import { Sandbox } from "../sandbox.js";
import type {
  CreateSandboxParams,
  SandboxData,
  SandboxListResponse,
  SandboxMetricsResponse,
} from "../types.js";

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

// Query window for a metrics read, plus an optional scope override. All time
// fields are optional; the server defaults to the last hour.
export interface MetricsParams extends Scope {
  // Start of the window (RFC3339). Defaults to one hour before `to`.
  from?: string;
  // End of the window (RFC3339). Defaults to now.
  to?: string;
  // Resolution as a Go duration (e.g. "60s", "5m"). Server clamps to a sane range.
  step?: string;
}

// Sandbox lifecycle operations. Exposed as `client.sandboxes`. Every method
// returns a Sandbox handle (or page of handles) so callers can chain lifecycle
// actions on the result.
export class Sandboxes {
  private readonly ctx: RequestContext;

  constructor(ctx: RequestContext) {
    this.ctx = ctx;
  }

  // Creates a sandbox in the resolved org/project. The returned handle may still
  // be in the Pending phase — call `waitUntilReady` to block until it is Ready.
  async create(params: CreateSandboxParams, scope?: Scope): Promise<Sandbox> {
    const resolved = this.ctx.resolveScope(scope);
    const data = await this.ctx.transport.request<SandboxData>({
      method: "POST",
      path: collectionPath(resolved),
      body: params,
    });
    return new Sandbox(this.ctx, this, data, scope);
  }

  // Lists sandboxes in the resolved org/project, returning wrapped handles.
  async list(params: ListSandboxesParams = {}): Promise<SandboxPage> {
    const { page, limit, ...scope } = params;
    const resolved = this.ctx.resolveScope(scope);
    const res = await this.ctx.transport.request<SandboxListResponse>({
      method: "GET",
      path: collectionPath(resolved),
      query: { page, limit },
    });
    return {
      items: res.items.map((data) => new Sandbox(this.ctx, this, data, scope)),
      total: res.total,
      page: res.page,
      limit: res.limit,
    };
  }

  // Fetches a single sandbox by id.
  async get(id: string, scope?: Scope): Promise<Sandbox> {
    const resolved = this.ctx.resolveScope(scope);
    const data = await this.ctx.transport.request<SandboxData>({
      method: "GET",
      path: itemPath(resolved, id),
    });
    return new Sandbox(this.ctx, this, data, scope);
  }

  // Pauses a sandbox (scales it to zero replicas) and returns the updated handle.
  async pause(id: string, scope?: Scope): Promise<Sandbox> {
    const resolved = this.ctx.resolveScope(scope);
    const data = await this.ctx.transport.request<SandboxData>({
      method: "POST",
      path: `${itemPath(resolved, id)}/pause`,
    });
    return new Sandbox(this.ctx, this, data, scope);
  }

  // Resumes a paused sandbox (scales it to one replica) and returns the updated handle.
  async resume(id: string, scope?: Scope): Promise<Sandbox> {
    const resolved = this.ctx.resolveScope(scope);
    const data = await this.ctx.transport.request<SandboxData>({
      method: "POST",
      path: `${itemPath(resolved, id)}/resume`,
    });
    return new Sandbox(this.ctx, this, data, scope);
  }

  // Permanently deletes a sandbox, removing the Kubernetes CR and the DB row.
  async delete(id: string, scope?: Scope): Promise<void> {
    const resolved = this.ctx.resolveScope(scope);
    await this.ctx.transport.request<void>({
      method: "DELETE",
      path: itemPath(resolved, id),
    });
  }

  // Reads the live, tenant-scoped metric series for a sandbox.
  async metrics(id: string, params: MetricsParams = {}): Promise<SandboxMetricsResponse> {
    const { from, to, step, ...scope } = params;
    const resolved = this.ctx.resolveScope(scope);
    return this.ctx.transport.request<SandboxMetricsResponse>({
      method: "GET",
      path: `${itemPath(resolved, id)}/metrics`,
      query: { from, to, step },
    });
  }
}

// Builds the collection path for an org/project's sandboxes.
function collectionPath(scope: { orgId: string; projectId: string }): string {
  return `/api/v1beta1/orgs/${encodeURIComponent(scope.orgId)}/projects/${encodeURIComponent(scope.projectId)}/sandboxes`;
}

// Builds the path for a single sandbox by id.
function itemPath(scope: { orgId: string; projectId: string }, id: string): string {
  return `${collectionPath(scope)}/${encodeURIComponent(id)}`;
}
