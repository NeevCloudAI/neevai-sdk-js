import { describe, expect, it } from "vitest";
import {
  DeadlineExceededError,
  InternalServerError,
  Neev,
  NeevError,
  NotFoundError,
  PermissionDeniedError,
} from "../src/index.js";
import { json, mockFetch, sandboxData } from "./helpers.js";

// Builds a client and a Ready sandbox handle (with a connect_url), queueing the
// create response plus any daemon responses the test needs after it.
async function readySandbox(connectUrl: string | null, daemonQueue: Array<Response | Error>) {
  const mock = mockFetch([
    json(201, sandboxData({ connect_url: connectUrl, phase: "Ready" })),
    ...daemonQueue,
  ]);
  const neev = new Neev({
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

  describe("files.read", () => {
    it("posts the path and returns raw bytes", async () => {
      const bytes = new Uint8Array([1, 2, 3, 255]);
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        new Response(bytes, { status: 200 }),
      ]);
      const out = await sandbox.files.read("/work/data.bin", { cwd: "/work" });

      expect(Array.from(out)).toEqual([1, 2, 3, 255]);
      const call = calls[1];
      expect(call?.method).toBe("POST");
      expect(call?.url).toBe("https://sbx.sandboxes.example/v1/files/read");
      expect(call?.body).toEqual({ path: "/work/data.bin", cwd: "/work" });
    });

    it("readText decodes the bytes as UTF-8", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        new Response("héllo", { status: 200 }),
      ]);
      const text = await sandbox.files.readText("/work/a.txt");
      expect(text).toBe("héllo");
    });

    it("maps a read error to a typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(404, { reason_code: "not_found", message: "missing" }),
      ]);
      await expect(sandbox.files.read("/missing")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("files.list", () => {
    it("lists entries and maps them to camelCase", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, {
          entries: [
            {
              name: "a.txt",
              type: "file",
              path: "work/a.txt",
              size: 12,
              mode: 420,
              permissions: "rw-r--r--",
              modified_time: "2026-06-05T00:00:00Z",
            },
            {
              name: "link",
              type: "symlink",
              path: "work/link",
              size: 0,
              mode: 511,
              permissions: "rwxrwxrwx",
              modified_time: "2026-06-05T00:00:00Z",
              symlink_target: "a.txt",
            },
          ],
        }),
      ]);
      const entries = await sandbox.files.list("/work", { recursive: true, maxCount: 50 });

      expect(entries).toHaveLength(2);
      expect(entries[0]?.modifiedTime).toBe("2026-06-05T00:00:00Z");
      expect(entries[1]?.symlinkTarget).toBe("a.txt");
      const call = calls[1];
      expect(call?.url).toBe("https://sbx.sandboxes.example/v1/files/list");
      expect(call?.body).toEqual({
        path: "/work",
        recursive: true,
        max_count: 50,
      });
    });

    it("maps a list error to a typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(403, { reason_code: "permission_denied", message: "nope" }),
      ]);
      await expect(sandbox.files.list("/work")).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  describe("exec", () => {
    // Builds an NDJSON exec stream Response from frame objects.
    function ndjson(frames: unknown[]): Response {
      const text = frames.map((f) => JSON.stringify(f)).join("\n");
      return new Response(text, { status: 200 });
    }

    it("drains the NDJSON stream into buffered stdout/stderr/exitCode", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stdout", data: btoa("hello ") },
          { type: "stderr", data: btoa("warn") },
          { type: "stdout", data: btoa("world") },
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const result = await sandbox.exec("echo", { args: ["hi"] });

      expect(result.stdout).toBe("hello world");
      expect(result.stderr).toBe("warn");
      expect(result.exitCode).toBe(0);
      const call = calls[1];
      expect(call?.url).toBe("https://sbx.sandboxes.example/v1/exec");
      expect(call?.body).toEqual({ command: "echo", args: ["hi"] });
    });

    it("maps an argv array to command + args", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "exit", exit_code: 0 }]),
      ]);
      await sandbox.exec(["python", "/work/x.py"]);
      expect(calls[1]?.body).toEqual({ command: "python", args: ["/work/x.py"] });
    });

    it("returns a non-zero exit code without throwing", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stderr", data: btoa("boom") },
          { type: "exit", exit_code: 2 },
        ]),
      ]);
      const result = await sandbox.exec("false");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe("boom");
    });

    it("maps a terminal error frame to the matching typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stdout", data: btoa("partial") },
          { type: "error", reason_code: "deadline_exceeded", message: "timed out" },
        ]),
      ]);
      const err = await sandbox.exec("sleep", { args: ["999"] }).catch((e) => e);
      expect(err).toBeInstanceOf(DeadlineExceededError);
      expect((err as DeadlineExceededError).details).toBe("timed out");
    });

    it("maps a non-5xx error frame to its typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "error", reason_code: "permission_denied", message: "denied" }]),
      ]);
      await expect(sandbox.exec("whoami")).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("maps the env record to a K=V array on the wire", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "exit", exit_code: 0 }]),
      ]);
      await sandbox.exec("env", { env: { FOO: "bar", BAZ: "qux" } });
      expect((calls[1]?.body as { env: string[] }).env).toEqual(["FOO=bar", "BAZ=qux"]);
    });

    it("returns empty output when no stdout/stderr frames arrive", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "exit", exit_code: 0 }]),
      ]);
      const result = await sandbox.exec("true");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });

    it("decodes a multi-byte UTF-8 char split across two frames", async () => {
      // "é" is 0xC3 0xA9; deliver each byte in a separate stdout frame.
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stdout", data: btoa(String.fromCharCode(0xc3)) },
          { type: "stdout", data: btoa(String.fromCharCode(0xa9)) },
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const result = await sandbox.exec("printf");
      expect(result.stdout).toBe("é");
    });

    it("throws when the stream ends without an exit frame", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "stdout", data: btoa("partial") }]),
      ]);
      await expect(sandbox.exec("sleep")).rejects.toThrow(/exit status/);
    });

    it("throws when args are given both in the argv array and options.args", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", []);
      await expect(sandbox.exec(["git", "status"], { args: ["-s"] })).rejects.toBeInstanceOf(
        NeevError,
      );
    });
  });
});
