/** Where `npm run db:seed` would write, for the line it prints before anything else (REQ §4). */
export interface Target {
  host: string;
  port: string;
  database: string;
  /** The host is this machine. */
  local: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

/** The host, port and database of a postgres:// URL. A host in `?host=` wins, as for libpq. */
export function describeTarget(databaseUrl: string): Target {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new UnsafeTargetError("DATABASE_URL is not a URL");
  }
  const host = url.searchParams.get("host") || url.hostname || "localhost";
  return {
    host,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "(default)",
    local: LOCAL_HOSTS.has(host.toLowerCase()),
  };
}

/**
 * Safe by default (REQ §4): only a database on this machine, unless `allowRemote` (the
 * --allow-remote flag). Throws before anything connects, so a refusal never writes.
 */
export function checkTarget(databaseUrl: string, opts: { allowRemote: boolean }): Target {
  const target = describeTarget(databaseUrl);
  if (!target.local && !opts.allowRemote) {
    throw new UnsafeTargetError(
      `refusing to seed ${target.host}: only localhost is seeded without --allow-remote`,
    );
  }
  return target;
}

/**
 * The demo student's password is a real way in, so it is never created in production
 * (NODE_ENV=production, as REVIEW_TEST_CLOCK is ignored there). Seed with --no-demo instead.
 */
export function checkDemoAllowed(env: Readonly<Record<string, string | undefined>>, demo: boolean) {
  if (demo && env.NODE_ENV === "production") {
    throw new UnsafeTargetError(
      "refusing to create the demo sign-in in production (NODE_ENV=production): pass --no-demo",
    );
  }
}
