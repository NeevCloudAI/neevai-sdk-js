import { describe, expect, it } from "vitest";
import { Neev, NotFoundError, Sandbox } from "../src/index.js";
import { json, mockFetch, sandboxData } from "./helpers.js";

// Builds a client backed by the given queued responses.
function client(queue: Array<Response | Error>) {
  const mock = mockFetch(queue);
  return {
    neev: new Neev({
      apiKey: "k",
      orgId: "org_test",
      projectId: "proj_test",
      maxRetries: 0,
      fetch: mock.fetch,
    }),
    calls: mock.calls,
  };
}

describe("sandboxes resource", () => {
  it("creates a sandbox from a template and returns a handle", async () => {
    const { neev, calls } = client([json(201, sandboxData({ name: "demo" }))]);
    const sb = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    expect(sb).toBeInstanceOf(Sandbox);
    expect(sb.name).toBe("demo");
    expect(sb.templateId).toBe("sb-ubuntu-26-04-minimal");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/api/v1beta1/orgs/org_test/projects/proj_test/sandboxes");
    expect(calls[0]?.body).toEqual({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
  });

  it("lists sandboxes with pagination and wraps items as handles", async () => {
    const { neev, calls } = client([
      json(200, {
        items: [sandboxData(), sandboxData({ id: "22222222-2222-2222-2222-222222222222" })],
        total: 2,
        page: 1,
        limit: 20,
      }),
    ]);
    const page = await neev.sandboxes.list({ page: 1, limit: 20 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toBeInstanceOf(Sandbox);
    expect(calls[0]?.url).toContain("page=1");
    expect(calls[0]?.url).toContain("limit=20");
  });

  it("targets the pause and resume sub-paths", async () => {
    const { neev, calls } = client([
      json(200, sandboxData({ phase: "Paused", replicas: 0 })),
      json(200, sandboxData({ phase: "Ready", replicas: 1 })),
    ]);
    const paused = await neev.sandboxes.pause("sb-1");
    expect(paused.phase).toBe("Paused");
    expect(calls[0]?.url).toMatch(/\/sandboxes\/sb-1\/pause$/);

    const resumed = await neev.sandboxes.resume("sb-1");
    expect(resumed.phase).toBe("Ready");
    expect(calls[1]?.url).toMatch(/\/sandboxes\/sb-1\/resume$/);
  });

  it("reads metrics with the query window", async () => {
    const { neev, calls } = client([
      json(200, {
        sandbox_id: "sb-1",
        from: "2026-06-05T00:00:00Z",
        to: "2026-06-05T01:00:00Z",
        step: "60s",
        series: [],
      }),
    ]);
    const metrics = await neev.sandboxes.metrics("sb-1", { step: "60s" });
    expect(metrics.sandbox_id).toBe("sb-1");
    expect(calls[0]?.url).toMatch(/\/sandboxes\/sb-1\/metrics\?step=60s$/);
  });

  it("throws a typed error from the openapi-fetch client on a 404", async () => {
    const { neev } = client([
      json(404, { error: "not_found", details: "gone" }, { "x-request-id": "r1" }),
    ]);
    const err = await neev.sandboxes.get("missing").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
    expect((err as NotFoundError).requestId).toBe("r1");
  });

  it("applies a per-call scope override", async () => {
    const { neev, calls } = client([json(200, sandboxData())]);
    await neev.sandboxes.get("sb-1", { orgId: "other_org", projectId: "other_proj" });
    expect(calls[0]?.url).toContain("/orgs/other_org/projects/other_proj/");
  });

  it("exposes region, template id, and resources on the handle", async () => {
    const { neev } = client([
      json(
        200,
        sandboxData({
          region: "dev",
          sandbox_template_id: "sb-ubuntu-26-04-minimal",
          resources: { cpu: 2, memory_gb: 4, disk_gb: 20 },
        }),
      ),
    ]);
    const sb = await neev.sandboxes.get("sb-1");
    expect(sb.region).toBe("dev");
    expect(sb.templateId).toBe("sb-ubuntu-26-04-minimal");
    expect(sb.resources).toEqual({ cpu: 2, memory_gb: 4, disk_gb: 20 });
  });

  it("reports null template id when the server omits it", async () => {
    const { neev } = client([json(200, sandboxData({ sandbox_template_id: null }))]);
    const sb = await neev.sandboxes.get("sb-1");
    expect(sb.templateId).toBeNull();
    expect(sb.resources).toBeUndefined();
  });
});
