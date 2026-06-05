import { describe, expect, it } from "vitest";
import { APITimeoutError, NotFoundError, RateLimitError } from "../src/index.js";
import { type FetchLike, Transport } from "../src/transport.js";
import { json } from "./helpers.js";

// Builds a transport with test-friendly defaults over the given fetch.
function transport(fetch: FetchLike) {
  return new Transport({
    baseURL: "http://localhost:7010",
    apiKey: "k",
    timeoutMs: 50,
    maxRetries: 2,
    fetch,
  });
}

describe("Transport", () => {
  it("parses a JSON success body", async () => {
    const t = transport(async () => json(200, { ok: true }));
    const res = await t.request<{ ok: boolean }>({ method: "GET", path: "/x" });
    expect(res.ok).toBe(true);
  });

  it("returns undefined for an empty 204 body", async () => {
    const t = transport(async () => new Response(null, { status: 204 }));
    const res = await t.request<void>({ method: "DELETE", path: "/x" });
    expect(res).toBeUndefined();
  });

  it("omits null/undefined query parameters", async () => {
    let seen = "";
    const t = transport(async (url) => {
      seen = url;
      return json(200, {});
    });
    await t.request({
      method: "GET",
      path: "/x",
      query: { page: 2, limit: undefined, step: null },
    });
    expect(seen).toContain("page=2");
    expect(seen).not.toContain("limit");
    expect(seen).not.toContain("step");
  });

  it("maps a 404 to NotFoundError with code, details, and request id", async () => {
    const t = transport(async () =>
      json(404, { error: "not_found", details: "no such sandbox" }, { "x-request-id": "req-123" }),
    );
    const err = await t.request({ method: "GET", path: "/x" }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
    expect(err.details).toBe("no such sandbox");
    expect(err.requestId).toBe("req-123");
  });

  it("retries a 429 and then succeeds", async () => {
    let attempts = 0;
    const t = transport(async () => {
      attempts++;
      return attempts === 1 ? json(429, { error: "slow_down" }) : json(200, { ok: true });
    });
    const res = await t.request<{ ok: boolean }>({ method: "GET", path: "/x" });
    expect(res.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it("gives up after exhausting retries on 429", async () => {
    const t = transport(async () => json(429, { error: "slow_down" }));
    await expect(t.request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("raises APITimeoutError when the request exceeds the timeout", async () => {
    // A fetch that never resolves until its abort signal fires.
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const t = new Transport({
      baseURL: "http://localhost:7010",
      apiKey: "k",
      timeoutMs: 10,
      maxRetries: 0,
      fetch: hanging,
    });
    await expect(t.request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(APITimeoutError);
  });
});
