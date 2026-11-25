import base from "@repo/eslint-config/base";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["out/**"]),
  base,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
]);
