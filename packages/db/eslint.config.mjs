import base from "@repo/eslint-config/base";
import { defineConfig } from "eslint/config";

export default defineConfig([
  base,
  { ignores: ["src/generated/**"] },
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
]);
