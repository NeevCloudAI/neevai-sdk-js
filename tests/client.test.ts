import { describe, expect, it } from "vitest";
import { NeevAI, NeevAIError } from "../src/index.js";
import { mockFetch } from "./helpers.js";

describe("NeevAI client", () => {
  it("throws when no API key is provided", () => {
    expect(() => new NeevAI({ orgId: "o", projectId: "p" })).toThrow(NeevAIError);
  });

  it("derives the base URL from the env shorthand", async () => {
    const { fetch, calls } = mockFetch([new Response(null, { status: 204 })]);
    const client = new NeevAI({
      apiKey: "k",
      orgId: "o",
      projectId: "p",
      env: "stg",
      maxRetries: 0,
      fetch,
    });
    await client.sandboxes.delete("sb");
    expect(calls[0]?.url).toContain("https://agent.stg.ai.neevcloud.com");
  });

  it("honors an explicit baseURL override", async () => {
    const { fetch, calls } = mockFetch([new Response(null, { status: 204 })]);
    const client = new NeevAI({
      apiKey: "k",
      orgId: "o",
      projectId: "p",
      baseURL: "http://localhost:7010",
      maxRetries: 0,
      fetch,
    });
    await client.sandboxes.delete("sb");
    expect(calls[0]?.url).toContain("http://localhost:7010/api/v1beta1");
  });

  it("attaches the bearer token to requests", async () => {
    const { fetch, calls } = mockFetch([new Response(null, { status: 204 })]);
    const client = new NeevAI({
      apiKey: "secret-key",
      orgId: "o",
      projectId: "p",
      maxRetries: 0,
      fetch,
    });
    await client.sandboxes.delete("sb");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer secret-key");
  });

  it("requires org and project at call time", async () => {
    const { fetch } = mockFetch([]);
    const client = new NeevAI({ apiKey: "k", fetch });
    await expect(client.sandboxes.get("sb")).rejects.toThrow(/orgId/);
  });
});
