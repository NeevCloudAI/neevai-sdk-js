import {
  APIConnectionError,
  APITimeoutError,
  type ApiErrorBody,
  errorFromStatus,
} from "./errors.js";

// A fetch implementation compatible with the global `fetch`. Used as the base
// transport; defaults to the runtime's global fetch.
export type FetchLike = typeof fetch;

// The shared low-level transport: sends one Request and resolves to its Response,
// applying a timeout and retrying transient failures. Its signature matches what
// openapi-fetch expects for its `fetch` option, so the same instance backs both
// the typed (spec-driven) client and the untyped RawClient.
export type Dispatch = (request: Request) => Promise<Response>;

// Inputs needed to build a Dispatch.
export interface DispatchOptions {
  fetch: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}

// Builds a Dispatch that wraps a base fetch with a per-attempt timeout and
// exponential-backoff retries on network errors, 429, and 5xx responses.
export function createDispatch(opts: DispatchOptions): Dispatch {
  const { fetch: base, timeoutMs, maxRetries } = opts;
  return async (request: Request): Promise<Response> => {
    const callerSignal = request.signal;
    let attempt = 0;
    // Retry transient failures up to maxRetries; each attempt gets a fresh clone
    // (a Request body can only be read once) and its own timeout controller.
    while (true) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", onAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await base(request.clone(), { signal: controller.signal });
        if (!response.ok && isRetryableStatus(response.status) && attempt < maxRetries) {
          await sleep(retryDelayMs(response, attempt));
          attempt++;
          continue;
        }
        return response;
      } catch (err) {
        if (isCallerAbort(err, callerSignal)) {
          throw new APIConnectionError("Request aborted by caller", err);
        }
        if (attempt < maxRetries) {
          await sleep(backoffMs(attempt));
          attempt++;
          continue;
        }
        if (isAbortError(err)) {
          throw new APITimeoutError("Request timed out", err);
        }
        throw new APIConnectionError("Request failed to reach the NeevAI API", err);
      } finally {
        clearTimeout(timer);
        callerSignal.removeEventListener("abort", onAbort);
      }
    }
  };
}

// Configuration for the untyped client.
export interface RawClientOptions {
  baseUrl: string;
  apiKey: string;
  dispatch: Dispatch;
}

// A single untyped request for an endpoint that has no OpenAPI spec yet.
export interface RawRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  // Path relative to the base URL, e.g. "/api/v1beta1/.../widgets".
  path: string;
  // Query parameters; null/undefined entries are omitted.
  query?: Record<string, string | number | undefined | null>;
  // JSON request body, serialized when present.
  body?: unknown;
  // Caller cancellation signal, combined with the per-request timeout.
  signal?: AbortSignal;
}

// Untyped HTTP client for spec-less endpoints. Shares the same Dispatch (and thus
// the same auth, timeout, retry, and error mapping) as the typed client. Callers
// supply the response type parameter and hand-write the wrapper around it.
export class RawClient {
  private readonly opts: RawClientOptions;

  constructor(opts: RawClientOptions) {
    this.opts = opts;
  }

  // Issues the request and returns the parsed JSON body typed as T. An empty body
  // (e.g. 204) resolves to undefined. Throws an APIError on a non-2xx response.
  async request<T>(req: RawRequest): Promise<T> {
    const url = new URL(req.path, ensureTrailingSlash(this.opts.baseUrl));
    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.opts.apiKey}`,
      accept: "application/json",
    };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(req.body);
    }

    const request = new Request(url, { method: req.method, headers, body, signal: req.signal });
    const response = await this.opts.dispatch(request);
    const parsed = await parseBody(response);
    if (!response.ok) {
      throw errorFromStatus(response.status, toErrorBody(parsed), requestId(response));
    }
    return parsed as T;
  }
}

// The shape of one openapi-fetch result, narrowed to what unwrap/ensureOk need.
interface FetchResult {
  error?: unknown;
  response: Response;
}

// Returns the typed data from an openapi-fetch result, or throws a typed APIError
// when the response was not 2xx.
export function unwrap<T>(result: FetchResult & { data?: T }): T {
  if (!result.response.ok) {
    throw errorFromStatus(
      result.response.status,
      toErrorBody(result.error),
      requestId(result.response),
    );
  }
  return result.data as T;
}

// Throws a typed APIError when an openapi-fetch result was not 2xx; used for
// no-content responses where there is no data to return.
export function ensureOk(result: FetchResult): void {
  if (!result.response.ok) {
    throw errorFromStatus(
      result.response.status,
      toErrorBody(result.error),
      requestId(result.response),
    );
  }
}

// Reads the body as JSON, returning undefined for an empty body.
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

// Coerces an unknown error payload into the API error body shape when possible.
function toErrorBody(value: unknown): ApiErrorBody | undefined {
  if (value && typeof value === "object" && "error" in value) {
    return value as ApiErrorBody;
  }
  return undefined;
}

// Extracts the x-request-id response header for support correlation.
function requestId(response: Response): string | undefined {
  return response.headers.get("x-request-id") ?? undefined;
}

// 429 and 5xx are safe to retry; other 4xx are caller errors and are not.
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// True when the failure is the caller's own signal aborting, not the timeout.
function isCallerAbort(err: unknown, signal: AbortSignal): boolean {
  return isAbortError(err) && signal.aborted;
}

// Detects the error raised when an AbortController aborts a fetch.
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// Picks the delay before the next retry, honoring a Retry-After header if sent.
function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return backoffMs(attempt);
}

// Exponential backoff (250ms base, capped at 8s) with full jitter.
function backoffMs(attempt: number): number {
  const base = Math.min(250 * 2 ** attempt, 8000);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

// Resolves after the given number of milliseconds.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Guarantees a trailing slash so URL resolution treats the base as a directory.
function ensureTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}
