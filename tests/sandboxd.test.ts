import { describe, expect, it } from "vitest";
import { InternalServerError, NeevAI, NotFoundError } from "../src/index.js";
import { json, mockFetch, sandboxData } from "./helpers.js";

// Builds a client and a Ready sandbox handle (with a connect_url), queueing the
// create response plus any data-plane responses the test needs after it.
async function readySandbox(connectUrl: string | null, dataPlaneQueue: Array<Response | Error>) {
  const mock = mockFetch([
    json(201, sandboxData({ connect_url: connectUrl, phase: "Ready" })),
    ...dataPlaneQueue,
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

describe("sandboxd data-plane", () => {
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

    it("does not retry the data plane on a 5xx", async () => {
      // Only one 5xx is queued; a retry would consume a second (absent) response
      // and throw a different error, so a clean InternalServerError proves no retry.
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(503, { reason_code: "unavailable", message: "down" }),
      ]);
      await expect(sandbox.files.write("/a", "b")).rejects.toBeInstanceOf(InternalServerError);
    });
  });
});
