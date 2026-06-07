// Typed error hierarchy for the SDK. Every failure surfaces as a NeevError
// subclass so callers can branch on `instanceof` rather than parsing strings.

// Shape of the JSON error body returned by the API (components.schemas.ErrorResponse).
export interface ApiErrorBody {
  error: string;
  details?: string;
}

// Base class for every error thrown by the SDK.
export class NeevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

// Raised when a request never produced an HTTP response — DNS failure, connection
// reset, or a client-side timeout/abort.
export class APIConnectionError extends NeevError {
  // The underlying cause (e.g. the fetch TypeError or AbortError), when available.
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

// Raised when the request was aborted because it exceeded the configured timeout.
export class APITimeoutError extends APIConnectionError {}

// Raised for any non-2xx HTTP response. Subclasses pin specific status codes.
export class APIError extends NeevError {
  // HTTP status code of the response.
  readonly status: number;
  // Stable error code from the API body (`error` field), when present.
  readonly code?: string;
  // Human-readable detail from the API body (`details` field), when present.
  readonly details?: string;
  // Value of the `x-request-id` response header, for support correlation.
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody | undefined, requestId: string | undefined) {
    super(buildMessage(status, body, requestId));
    this.status = status;
    this.code = body?.error;
    this.details = body?.details;
    this.requestId = requestId;
  }
}

// 400 — request was malformed or failed validation.
export class BadRequestError extends APIError {}
// 401 — missing, invalid, or expired API key.
export class AuthenticationError extends APIError {}
// 403 — authenticated but not allowed to touch this org/project/resource.
export class PermissionDeniedError extends APIError {}
// 404 — the requested resource does not exist.
export class NotFoundError extends APIError {}
// 409 — the resource already exists or conflicts with current state.
export class ConflictError extends APIError {}
// 412 — a precondition failed (e.g. unsupported protocol version).
export class PreconditionFailedError extends APIError {}
// 429 — rate limit exceeded.
export class RateLimitError extends APIError {}
// 504 — the operation exceeded the server's deadline.
export class DeadlineExceededError extends APIError {}
// 5xx — the server failed to handle a valid request.
export class InternalServerError extends APIError {}

// Composes a readable message from the status line and any API-provided detail.
function buildMessage(
  status: number,
  body: ApiErrorBody | undefined,
  requestId: string | undefined,
): string {
  const parts = [`HTTP ${status}`];
  if (body?.error) parts.push(body.error);
  if (body?.details) parts.push(`(${body.details})`);
  if (requestId) parts.push(`[request-id: ${requestId}]`);
  return parts.join(" ");
}

// Maps an HTTP status code and parsed body onto the most specific APIError subclass.
export function errorFromStatus(
  status: number,
  body: ApiErrorBody | undefined,
  requestId: string | undefined,
): APIError {
  switch (status) {
    case 400:
      return new BadRequestError(status, body, requestId);
    case 401:
      return new AuthenticationError(status, body, requestId);
    case 403:
      return new PermissionDeniedError(status, body, requestId);
    case 404:
      return new NotFoundError(status, body, requestId);
    case 409:
      return new ConflictError(status, body, requestId);
    case 412:
      return new PreconditionFailedError(status, body, requestId);
    case 429:
      return new RateLimitError(status, body, requestId);
    case 504:
      return new DeadlineExceededError(status, body, requestId);
    default:
      if (status >= 500) return new InternalServerError(status, body, requestId);
      return new APIError(status, body, requestId);
  }
}
