// Public entry point for @neev/sdk. Re-exports the client, resource types,
// the Sandbox handle, and the typed error hierarchy.

export { Neev } from "./client.js";
export type { NeevOptions, Scope } from "./client.js";

export { RawClient } from "./http.js";
export type { FetchLike, RawRequest } from "./http.js";

export { Sandbox } from "./sandbox.js";
export type { WaitOptions } from "./sandbox.js";

export { SandboxConnection, SandboxFiles } from "./sandboxd.js";
export type {
  ExecOptions,
  ExecResult,
  FileEntry,
  ListFilesOptions,
  ReadFileOptions,
  WriteFileOptions,
  WriteFileResult,
} from "./sandboxd.js";

export type {
  ListSandboxesParams,
  MetricsParams,
  MetricsQuery,
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
  DeadlineExceededError,
  InternalServerError,
  NeevError,
  NotFoundError,
  PermissionDeniedError,
  PreconditionFailedError,
  RateLimitError,
} from "./errors.js";
export type { ApiErrorBody } from "./errors.js";
