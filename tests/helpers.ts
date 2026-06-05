import type { FetchLike } from "../src/http.js";
import type { SandboxData } from "../src/types.js";

// A single recorded fetch call, for asserting method/url/headers/body in tests.
export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

// A scripted fetch and the log of calls made against it.
export interface MockFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
}

// Builds a JSON Response with the given status, body, and headers.
export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const init: ResponseInit = { status, headers: { ...headers } };
  if (body === undefined) {
    return new Response(null, init);
  }
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...headers },
  });
}

// Creates a base fetch that returns the queued responses in order, recording
// every call. The dispatch layer and openapi-fetch both call fetch with a
// Request, so the recorder reads method/url/headers/body off the Request. A
// queued Error simulates a transport-level failure.
export function mockFetch(queue: Array<Response | Error>): MockFetch {
  const calls: RecordedCall[] = [];
  const pending = [...queue];
  const fetch: FetchLike = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const text = await req.clone().text();
    calls.push({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: text.length > 0 ? JSON.parse(text) : undefined,
    });
    const next = pending.shift();
    if (!next) throw new Error("mockFetch: no more queued responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

// Builds a Sandbox record with sensible defaults, overridable per field.
export function sandboxData(overrides: Partial<SandboxData> = {}): SandboxData {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    org_id: "org_test",
    project_id: "proj_test",
    name: "test-sandbox",
    namespace: "ns-test",
    region: "as-south-1",
    image: "ghcr.io/neevcloud/sandbox-python:3.12",
    phase: "Pending",
    replicas: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}
