import { defineConfig } from "vitest/config";

// Test runner config. Coverage is measured against the runtime source only —
// the generated types, the type-only alias module, and the barrel are excluded.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/types.ts", "src/index.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
