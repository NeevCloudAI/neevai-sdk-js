import type { components } from "./generated/types.js";

// Clean, public-facing aliases over the generated OpenAPI schema types. Consumers
// import these instead of reaching into the generated `components` tree.

// A sandbox as returned by the API. The Sandbox handle class wraps this shape.
export type SandboxData = components["schemas"]["Sandbox"];

// Lifecycle phase reported by the control plane.
export type SandboxPhase = components["schemas"]["SandboxPhase"];

// Request body accepted by `sandboxes.create`.
export type CreateSandboxParams = components["schemas"]["CreateSandboxRequest"];

// A single environment variable passed to a sandbox.
export type EnvVar = components["schemas"]["EnvVar"];

// Paginated list payload returned by `sandboxes.list`.
export type SandboxListResponse = components["schemas"]["SandboxListResponse"];

// Metric series bundle returned by `sandboxes.metrics`.
export type SandboxMetricsResponse = components["schemas"]["SandboxMetricsResponse"];

// One named time series within a metrics response.
export type MetricSeries = components["schemas"]["MetricSeries"];
