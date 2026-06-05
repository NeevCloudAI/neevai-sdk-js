// Public entry point for @neevai/sdk. Re-exports the client, resource types,
// the Sandbox handle, and the typed error hierarchy.

export { NeevAI } from "./client.js";
export type { NeevAIOptions, Scope } from "./client.js";

export { Sandbox } from "./sandbox.js";
export type { WaitOptions } from "./sandbox.js";

export type {
  ListSandboxesParams,
  MetricsParams,
  SandboxPage,
} from "./resources/sandboxes.js";

export type {
  CreateSandboxParams,
  EnvVar,
  MetricSeries,
  SandboxData,
  SandboxListResponse,
  SandboxMetricsResponse,
  SandboxPhase,
} from "./types.js";

export {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NeevAIError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "./errors.js";
export type { ApiErrorBody } from "./errors.js";
