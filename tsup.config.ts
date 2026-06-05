import { defineConfig } from "tsup";

// Build the SDK as dual ESM + CommonJS with type declarations so it works in
// Node, Bun, Deno, and edge runtimes regardless of the consumer's module system.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
