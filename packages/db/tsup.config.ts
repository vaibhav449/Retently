import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
});
