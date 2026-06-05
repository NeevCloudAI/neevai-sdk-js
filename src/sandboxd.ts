import { type APIError, type ApiErrorBody, errorFromStatus } from "./errors.js";
import type { Dispatch } from "./http.js";

// Inputs needed to open a connection to a sandbox's daemon.
export interface SandboxConnectionOptions {
  // The sandbox's daemon base URL (Sandbox.connect_url).
  connectUrl: string;
  // Bearer API key; the gateway derives x-sandbox-id from the connect_url host.
  apiKey: string;
  // Shared transport; the no-retry dispatch, since sandbox calls are not idempotent.
  dispatch: Dispatch;
}

// A low-level request against the daemon, before body encoding/decoding.
interface DaemonRequest {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}

// Options for a file write.
export interface WriteFileOptions {
  // Working directory the path is resolved against, if relative.
  cwd?: string;
  // Caller cancellation signal.
  signal?: AbortSignal;
}

// Result of a successful file write.
export interface WriteFileResult {
  bytesWritten: number;
}

// Options for a file read.
export interface ReadFileOptions {
  // Working directory the path is resolved against, if relative.
  cwd?: string;
  // Caller cancellation signal.
  signal?: AbortSignal;
}

// A live connection to one sandbox's daemon (sandboxd), reached directly at the
// sandbox's connect_url. Construct via NeevAI.createSandboxConnection or, more
// commonly, access it through `sandbox.files` / `sandbox.exec`.
export class SandboxConnection {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly dispatch: Dispatch;
  // File operations on the sandbox filesystem.
  readonly files: SandboxFiles;

  constructor(opts: SandboxConnectionOptions) {
    this.base = opts.connectUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.dispatch = opts.dispatch;
    this.files = new SandboxFiles(this);
  }

  // Issues a request to the daemon and returns the raw Response, throwing a typed
  // APIError (mapped from the daemon's {reason_code, message}) on a non-2xx status.
  async request(req: DaemonRequest): Promise<Response> {
    const url = new URL(`${this.base}${req.path}`);
    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const headers = new Headers(req.headers);
    headers.set("authorization", `Bearer ${this.apiKey}`);
    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.body,
      signal: req.signal,
    });
    const response = await this.dispatch(request);
    if (!response.ok) throw await daemonError(response);
    return response;
  }
}

// Filesystem operations exposed by sandboxd. Reached via `sandbox.files`.
export class SandboxFiles {
  private readonly conn: SandboxConnection;

  constructor(conn: SandboxConnection) {
    this.conn = conn;
  }

  // Writes content to a path in the sandbox, returning the number of bytes written.
  async write(
    path: string,
    content: string | Uint8Array,
    options: WriteFileOptions = {},
  ): Promise<WriteFileResult> {
    const response = await this.conn.request({
      method: "POST",
      path: "/v1/files/write",
      query: { path, cwd: options.cwd },
      headers: { "content-type": "application/octet-stream" },
      body: content,
      signal: options.signal,
    });
    const body = (await response.json()) as { bytes_written: number };
    return { bytesWritten: body.bytes_written };
  }

  // Reads a file from the sandbox and returns its raw bytes (binary-safe).
  async read(path: string, options: ReadFileOptions = {}): Promise<Uint8Array> {
    const response = await this.conn.request({
      method: "POST",
      path: "/v1/files/read",
      headers: { "content-type": "application/json", accept: "application/octet-stream" },
      body: JSON.stringify({ path, cwd: options.cwd }),
      signal: options.signal,
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  // Reads a file from the sandbox and decodes it as a UTF-8 string.
  async readText(path: string, options: ReadFileOptions = {}): Promise<string> {
    return new TextDecoder().decode(await this.read(path, options));
  }
}

// Builds a typed APIError from a sandboxd error response. The daemon's body is
// {reason_code, message}; this maps it onto the SDK's {error, details} shape.
async function daemonError(response: Response): Promise<APIError> {
  const text = await response.text();
  let body: ApiErrorBody | undefined;
  if (text.length > 0) {
    try {
      const parsed = JSON.parse(text) as { reason_code?: string; message?: string };
      body = { error: parsed.reason_code ?? "", details: parsed.message };
    } catch {
      body = { error: "", details: text };
    }
  }
  return errorFromStatus(response.status, body, response.headers.get("x-request-id") ?? undefined);
}
