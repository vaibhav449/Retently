import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Type-aware rules for Node packages. Each package adds its own
 * `tsconfigRootDir` so the parser finds the right tsconfig.
 */
export default defineConfig([
  globalIgnores(["**/dist/**", "**/coverage/**", "**/.turbo/**"]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
]);
