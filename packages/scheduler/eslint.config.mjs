import base from "@repo/eslint-config/base";
import { defineConfig } from "eslint/config";

// The scheduler is pure (04-scheduler.md §2): the same inputs must give the same output forever,
// because card_state is rebuilt by replaying review_log. TypeScript already rejects Node globals
// (tsconfig extends base.json, which has no Node types); these rules catch what it cannot.
const CLOCK =
  "packages/scheduler is pure: take `now: Date` as an argument instead of reading the clock.";
const RANDOM =
  "packages/scheduler is pure: no randomness, so a replay always gives the same result.";
const IO = "packages/scheduler is pure: no database, LLM, network or file system.";

export default defineConfig([
  base,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: CLOCK },
        { object: "performance", property: "now", message: CLOCK },
        { object: "Math", property: "random", message: RANDOM },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: CLOCK },
        { selector: "CallExpression[callee.name='Date']", message: CLOCK },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: ["fs", "net", "http", "https", "child_process"].map((name) => ({
            name,
            message: IO,
          })),
          patterns: [{ group: ["@repo/*", "node:*"], message: IO }],
        },
      ],
    },
  },
]);
