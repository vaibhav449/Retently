import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they are bundled into dist/.
  // Everything in this app's "dependencies" stays external and is installed in the image.
  noExternal: [/^@repo\//],
});
