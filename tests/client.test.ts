import { describe, expect, it } from "vitest";
import { Neev, NeevError } from "../src/index.js";
import { mockFetch } from "./helpers.js";

describe("Neev client", () => {
  it("throws when no API key is provided", () => {
    expect(() => new Neev({ orgId: "o", projectId: "p" })).toThrow(NeevError);
  });

  it("uses the default production base URL", async () => {
    const { fetch, calls } = mockFetch([new Response(null, { status: 204 })]);
    const client = new Neev({
      apiKey: "k",
      orgId: "o",
      projectId: "p",
      maxRetries: 0,
      fetch,
    });
    await client.sandboxes.delete("sb");
    expect(calls[0]?.url).toContain("https://api.ai.neevcloud.com/agent/api/v1beta1");
  });

  it("honors an explicit baseURL override", async () => {
    const { fetch, calls } = mockFetch([new Response(null, { status: 204 })]);
    const client = new Neev({
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
    const client = new Neev({
      apiKey: "secret-key",
      orgId: "o",
      projectId: "p",
      maxRetries: 0,
      fetch,
    });
    await client.sandboxes.delete("sb");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer secret-key");
  });

  it("throws when no fetch implementation is available", () => {
    const original = globalThis.fetch;
    // Simulate a runtime without a global fetch.
    (globalThis as { fetch?: typeof fetch }).fetch = undefined;
    try {
      expect(() => new Neev({ apiKey: "k", orgId: "o", projectId: "p" })).toThrow(/fetch/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("requires org and project at call time", async () => {
    const { fetch } = mockFetch([]);
    const client = new Neev({ apiKey: "k", fetch });
    await expect(client.sandboxes.get("sb")).rejects.toThrow(/orgId/);
  });
});
