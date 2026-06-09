/**
 * Shared model configuration for the agent examples.
 *
 * Every example drives the same NeevCloud model — `gpt-oss-120b` — over the
 * OpenAI-compatible Neev inference endpoint. Each framework builds its own model
 * object from these values; only the wiring differs.
 */

// The NeevCloud model all examples use.
export const NEEV_MODEL = "gpt-oss-120b";

// OpenAI-compatible Neev inference base URL. Override with NEEV_INFERENCE_BASE_URL.
export const NEEV_INFERENCE_BASE_URL =
  process.env.NEEV_INFERENCE_BASE_URL ?? "https://inference.ai.neevcloud.com/v1";

// Resolves the API key for the inference endpoint, falling back to NEEV_API_KEY
// so a single-key setup works. Throws if neither is set.
export function neevInferenceApiKey(): string {
  const key = process.env.NEEV_INFERENCE_API_KEY ?? process.env.NEEV_API_KEY;
  if (!key) {
    throw new Error(
      "Missing model API key. Set NEEV_INFERENCE_API_KEY (or NEEV_API_KEY) for the inference endpoint.",
    );
  }
  return key;
}
