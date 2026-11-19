import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Trace from the monorepo root so the standalone build includes files outside apps/web.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The "Generate questions" route publishes with amqplib: a plain Node require, traced into the
  // standalone build, instead of a bundled copy.
  serverExternalPackages: ["amqplib"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
