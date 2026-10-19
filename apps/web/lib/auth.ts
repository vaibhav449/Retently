import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { dobSchema } from "./age";
import { getDb } from "./db";
import { getServerEnv } from "./env";

function createAuth() {
  const env = getServerEnv();
  return betterAuth({
    appName: "Retently",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Better Auth is a library, not a service: it stores users and sessions
    // in our own Postgres through the Prisma client (packages/db).
    database: prismaAdapter(getDb(), { provider: "postgresql", transaction: true }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // Off until there is an email provider; planned before real users (Phase 3).
      requireEmailVerification: false,
    },
    user: {
      additionalFields: {
        // Validated on the server for every signup and update. The validator's
        // output (a Date) is what gets stored, so under-18 signups never reach the DB.
        dob: { type: "date", required: true, input: true, validator: { input: dobSchema } },
        // Set only by a future consent flow, never by the client.
        parentConsentAt: { type: "date", required: false, input: false },
      },
    },
    // Lets server actions set auth cookies. Must stay the last plugin.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Created on first use, so importing this module needs no secrets (see env.ts). */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
