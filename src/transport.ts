import {
  APIConnectionError,
  APITimeoutError,
  type ApiErrorBody,
  errorFromStatus,
} from "./errors.js";

// Minimal fetch signature the transport depends on, so a custom implementation
// (proxy, instrumentation, test double) can be injected via NeevAIOptions.fetch.
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// Resolved configuration the transport needs to issue a request.
export interface TransportOptions {
  baseURL: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: FetchLike;
}

// A single HTTP request described independently of the runtime.
export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  // Query parameters; entries with null/undefined values are omitted.
  query?: Record<string, string | number | undefined | null>;
  // JSON request body; serialized only when present.
  body?: unknown;
  // Caller-supplied cancellation signal, combined with the timeout.
  signal?: AbortSignal;
}

// Issues authenticated JSON requests with timeout and retry handling. One
// Transport instance is shared by every resource on a client.
export class Transport {
  private readonly opts: TransportOptions;

  constructor(opts: TransportOptions) {
    this.opts = opts;
  }

  // Performs the request and returns the parsed JSON body typed as T. A 204 (or
  // any empty body) resolves to undefined. Throws an APIError on a non-2xx
  // response and an APIConnectionError on transport failure.
  async request<T>(options: RequestOptions): Promise<T> {
    const url = this.buildUrl(options.path, options.query);
    const init = this.buildInit(options);

    let attempt = 0;
    // Retry transient failures (network errors, 429, 5xx) up to maxRetries.
    while (true) {
      let response: Response;
      try {
        response = await this.fetchWithTimeout(url, init, options.signal);
      } catch (err) {
        if (this.shouldRetry(attempt) && !isAbortByCaller(err, options.signal)) {
          await sleep(backoffMs(attempt));
          attempt++;
          continue;
        }
        throw toConnectionError(err, options.signal);
      }

      if (response.ok) {
        return (await parseBody(response)) as T;
      }

      if (this.shouldRetry(attempt) && isRetryableStatus(response.status)) {
        await sleep(retryDelayMs(response, attempt));
        attempt++;
        continue;
      }

      const body = (await parseBody(response)) as ApiErrorBody | undefined;
      throw errorFromStatus(
        response.status,
        body,
        response.headers.get("x-request-id") ?? undefined,
      );
    }
  }

  // Builds the absolute URL from the base, path, and non-empty query parameters.
  private buildUrl(path: string, query: RequestOptions["query"]): string {
    const url = new URL(path, ensureTrailingSlash(this.opts.baseURL));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  // Assembles the fetch init with auth header and serialized JSON body.
  private buildInit(options: RequestOptions): RequestInit {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.opts.apiKey}`,
      accept: "application/json",
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    return { method: options.method, headers, body };
  }

  // Runs fetch with an AbortController that fires on timeout or caller abort.
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      return await this.opts.fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  // True while another attempt remains within the retry budget.
  private shouldRetry(attempt: number): boolean {
    return attempt < this.opts.maxRetries;
  }
}

// Reads the body as JSON, returning undefined for empty (e.g. 204) responses.
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

// 429 and 5xx are safe to retry; other 4xx are caller errors and are not.
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// Converts a thrown fetch failure into the appropriate connection error.
function toConnectionError(err: unknown, signal: AbortSignal | undefined): APIConnectionError {
  if (isTimeoutAbort(err, signal)) {
    return new APITimeoutError("Request timed out", err);
  }
  if (isAbortByCaller(err, signal)) {
    return new APIConnectionError("Request aborted", err);
  }
  return new APIConnectionError("Request failed to reach the NeevAI API", err);
}

// An abort with a caller signal already aborted means the caller cancelled.
function isAbortByCaller(err: unknown, signal: AbortSignal | undefined): boolean {
  return isAbortError(err) && signal?.aborted === true;
}

// An abort with no caller cancellation means the timeout fired.
function isTimeoutAbort(err: unknown, signal: AbortSignal | undefined): boolean {
  return isAbortError(err) && signal?.aborted !== true;
}

// Detects the DOMException/Error raised when an AbortController aborts a fetch.
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
