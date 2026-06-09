import { type APIError, type ApiErrorBody, NeevError, errorFromStatus } from "./errors.js";
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

// Options for listing a directory.
export interface ListFilesOptions {
  // Working directory the path is resolved against, if relative.
  cwd?: string;
  // Recurse into subdirectories. Defaults to false (server-side).
  recursive?: boolean;
  // Maximum number of entries to return.
  maxCount?: number;
  // Caller cancellation signal.
  signal?: AbortSignal;
}

// A single directory entry returned by `files.list`.
export interface FileEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  // Path relative to the sandbox workspace root.
  path: string;
  size: number;
  // Raw Unix mode bits, including file-type bits; use `permissions` for the rwx view.
  mode: number;
  // 9-character rwx permission string (e.g. "rwxr-xr-x").
  permissions: string;
  // Last-modified timestamp (RFC3339).
  modifiedTime: string;
  // Target path when the entry is a symlink.
  symlinkTarget?: string;
}

// Options for running a command in the sandbox.
export interface ExecOptions {
  // Arguments, when the command is given as a bare program name. Ignored if
  // `command` is already an argv array.
  args?: string[];
  // Working directory for the command.
  cwd?: string;
  // Extra environment variables, merged over the sandbox's environment.
  env?: Record<string, string>;
  // Wall-clock timeout in milliseconds; the server clamps to its ceiling.
  timeoutMs?: number;
  // Data piped to the command's standard input.
  stdin?: string;
  // Caller cancellation signal.
  signal?: AbortSignal;
}

// Buffered result of a command. A non-zero exitCode is NOT an error. stdout and
// stderr are decoded as UTF-8 text (not binary-safe); the daemon does not report
// output truncation on this path, so output is captured in full.
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// A live connection to one sandbox's daemon (sandboxd), reached directly at the
// sandbox's connect_url. Construct via Neev.createSandboxConnection or, more
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

  // Runs a command in the sandbox and returns its buffered output. `command` may
  // be a program name (with `options.args`) or a full argv array. The NDJSON
  // response is drained to completion; a non-zero exit code is returned, not thrown.
  async exec(command: string | string[], options: ExecOptions = {}): Promise<ExecResult> {
    if (Array.isArray(command) && options.args && options.args.length > 0) {
      throw new NeevError(
        "exec: pass arguments either in the command array or via options.args, not both.",
      );
    }
    const argv = Array.isArray(command) ? command : [command, ...(options.args ?? [])];
    const [program, ...args] = argv;
    const env = options.env
      ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`)
      : undefined;
    const response = await this.request({
      method: "POST",
      path: "/v1/exec",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({
        command: program,
        args,
        cwd: options.cwd,
        env,
        timeout_ms: options.timeoutMs,
        stdin: options.stdin,
      }),
      signal: options.signal,
    });
    return drainExec(response);
  }
}

// Resolves the daemon connection for a file operation. The Sandbox handle
// supplies an async resolver that waits until the sandbox is Ready and caches
// the connection; a concrete SandboxConnection is wrapped as an already-resolved
// provider. Resolving per call lets `sandbox.files` stay a synchronous getter
// while the underlying connect_url may only arrive once the sandbox is Ready.
export type ConnectionResolver = () => Promise<SandboxConnection>;

// Filesystem operations exposed by sandboxd. Reached via `sandbox.files`.
export class SandboxFiles {
  private readonly resolve: ConnectionResolver;

  constructor(conn: SandboxConnection | ConnectionResolver) {
    this.resolve = typeof conn === "function" ? conn : () => Promise.resolve(conn);
  }

  // Writes content to a path in the sandbox, returning the number of bytes written.
  async write(
    path: string,
    content: string | Uint8Array,
    options: WriteFileOptions = {},
  ): Promise<WriteFileResult> {
    const conn = await this.resolve();
    const response = await conn.request({
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
    const conn = await this.resolve();
    const response = await conn.request({
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

  // Lists directory entries at a path in the sandbox.
  async list(path: string, options: ListFilesOptions = {}): Promise<FileEntry[]> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/files/list",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        cwd: options.cwd,
        recursive: options.recursive,
        max_count: options.maxCount,
      }),
      signal: options.signal,
    });
    const body = (await response.json()) as { entries: RawEntry[] };
    return body.entries.map(toFileEntry);
  }
}

// The wire shape of a directory entry as emitted by sandboxd.
interface RawEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  path: string;
  size: number;
  mode: number;
  permissions: string;
  modified_time: string;
  symlink_target?: string;
}

// One NDJSON frame of an exec stream.
interface ExecFrame {
  type: "stdout" | "stderr" | "exit" | "error";
  // Base64-encoded chunk for stdout/stderr frames.
  data?: string;
  // Process exit status, present on the terminal "exit" frame.
  exit_code?: number;
  // Failure detail on a terminal "error" frame.
  reason_code?: string;
  message?: string;
}

// sandboxd reason codes mapped to the HTTP status the SDK keys error types on.
const REASON_STATUS: Record<string, number> = {
  permission_denied: 403,
  invalid_argument: 400,
  not_found: 404,
  failed_precondition: 412,
  resource_exhausted: 429,
  deadline_exceeded: 504,
  unavailable: 503,
  internal: 500,
};

// Drains an NDJSON exec stream to completion, accumulating stdout/stderr bytes
// and the exit code. Bytes are collected then decoded once so a multi-byte UTF-8
// sequence split across frames is not corrupted. A terminal "error" frame throws;
// a stream that ends without an exit status throws (e.g. server-side timeout).
async function drainExec(response: Response): Promise<ExecResult> {
  const text = await response.text();
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  let exitCode: number | undefined;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const frame = JSON.parse(trimmed) as ExecFrame;
    switch (frame.type) {
      case "stdout":
        if (frame.data) stdout.push(decodeBase64(frame.data));
        break;
      case "stderr":
        if (frame.data) stderr.push(decodeBase64(frame.data));
        break;
      case "exit":
        exitCode = frame.exit_code ?? 0;
        break;
      case "error":
        throw errorFromStatus(
          (frame.reason_code && REASON_STATUS[frame.reason_code]) || 500,
          { error: frame.reason_code ?? "", details: frame.message },
          undefined,
        );
    }
  }

  if (exitCode === undefined) {
    throw new NeevError(
      "exec stream ended without an exit status (the command may have timed out).",
    );
  }
  return { stdout: decodeUtf8(stdout), stderr: decodeUtf8(stderr), exitCode };
}

// Decodes a base64 string to bytes using the runtime's global atob.
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Concatenates byte chunks and decodes them as a single UTF-8 string.
function decodeUtf8(chunks: Uint8Array[]): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(buffer);
}

// Maps a sandboxd entry onto the SDK's camelCase FileEntry.
function toFileEntry(entry: RawEntry): FileEntry {
  return {
    name: entry.name,
    type: entry.type,
    path: entry.path,
    size: entry.size,
    mode: entry.mode,
    permissions: entry.permissions,
    modifiedTime: entry.modified_time,
    symlinkTarget: entry.symlink_target,
  };
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
