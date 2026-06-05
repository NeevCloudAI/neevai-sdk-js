import { describe, expect, it } from "vitest";
import { InternalServerError, NeevAI, NotFoundError } from "../src/index.js";
import { json, mockFetch, sandboxData } from "./helpers.js";

// Builds a client and a Ready sandbox handle (with a connect_url), queueing the
// create response plus any daemon responses the test needs after it.
async function readySandbox(connectUrl: string | null, daemonQueue: Array<Response | Error>) {
  const mock = mockFetch([
    json(201, sandboxData({ connect_url: connectUrl, phase: "Ready" })),
    ...daemonQueue,
  ]);
  const neev = new NeevAI({
    apiKey: "k",
    orgId: "org_test",
    projectId: "proj_test",
    fetch: mock.fetch,
  });
  const sandbox = await neev.sandboxes.create({ name: "demo", image: "img" });
  return { sandbox, calls: mock.calls };
}

describe("sandboxd", () => {
  it("throws when the sandbox has no connect_url yet", async () => {
    const { sandbox } = await readySandbox(null, []);
    expect(() => sandbox.files).toThrow(/connect_url/);
  });

  describe("files.write", () => {
    it("posts raw content to the connect_url host with bearer auth", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { bytes_written: 11 }),
      ]);
      const result = await sandbox.files.write("/work/a.txt", "hello world");

      expect(result.bytesWritten).toBe(11);
      const call = calls[1];
      expect(call?.method).toBe("POST");
      expect(call?.url).toBe("https://sbx.sandboxes.example/v1/files/write?path=%2Fwork%2Fa.txt");
      expect(call?.headers.get("authorization")).toBe("Bearer k");
      expect(call?.body).toBe("hello world");
    });

    it("includes cwd in the query when provided", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { bytes_written: 1 }),
      ]);
      await sandbox.files.write("a.txt", "x", { cwd: "/work" });
      expect(calls[1]?.url).toContain("cwd=%2Fwork");
    });

    it("maps a daemon error (reason_code/message) to a typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(404, { reason_code: "not_found", message: "no such path" }),
      ]);
      const err = await sandbox.files.write("/missing", "x").catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe("not_found");
      expect((err as NotFoundError).details).toBe("no such path");
    });

    it("does not retry on a 5xx", async () => {
      // Only one 5xx is queued; a retry would consume a second (absent) response
      // and throw a different error, so a clean InternalServerError proves no retry.
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(503, { reason_code: "unavailable", message: "down" }),
      ]);
      await expect(sandbox.files.write("/a", "b")).rejects.toBeInstanceOf(InternalServerError);
    });

    it("sends a Uint8Array body as raw octet-stream bytes", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { bytes_written: 4 }),
      ]);
      await sandbox.files.write("/b.bin", new Uint8Array([0, 1, 2, 255]));
      expect(Array.from(calls[1]?.bodyBytes ?? [])).toEqual([0, 1, 2, 255]);
      expect(calls[1]?.headers.get("content-type")).toBe("application/octet-stream");
    });

    it("maps a non-JSON error body to details", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        new Response("Bad Gateway", { status: 502 }),
      ]);
      const err = await sandbox.files.write("/a", "b").catch((e) => e);
      expect(err).toBeInstanceOf(InternalServerError);
      expect((err as InternalServerError).details).toBe("Bad Gateway");
    });
  });

  describe("connection", () => {
    it("reuses a single daemon connection across calls", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { bytes_written: 1 }),
        json(200, { bytes_written: 1 }),
      ]);
      await sandbox.files.write("/a", "x");
      await sandbox.files.write("/b", "y");
      expect(calls[1]?.url).toContain("https://sbx.sandboxes.example/");
      expect(calls[2]?.url).toContain("https://sbx.sandboxes.example/");
    });
  });
});
