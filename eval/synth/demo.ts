import type { Database } from "@repo/db";
import { hashPassword } from "better-auth/crypto";
import { seededUuid } from "./ids";
import type { Student } from "./student";

/**
 * The documented credential of the demo student (REQ §4, eval/README.md): sign in with it on dev
 * or staging to open /review and /exams as someone with weeks of history. Never created in
 * production (safety.ts).
 */
export const DEMO_EMAIL = "demo@synthetic.invalid";
export const DEMO_PASSWORD = "synthetic-demo";

/**
 * An email/password account for the demo student, as Better Auth's sign-up writes it: provider
 * "credential", account id = user id, the password hashed by Better Auth's own scrypt. The hash
 * is salted, so it differs between runs; accounts are auth data, not part of V7's comparison.
 */
export async function createDemoCredential(
  db: Database,
  student: Student,
  at: Date,
): Promise<void> {
  if (student.email !== DEMO_EMAIL) throw new Error(`${student.id} is not the demo student`);
  await db.account.create({
    data: {
      id: seededUuid(student.id, "account"),
      userId: student.id,
      accountId: student.id,
      providerId: "credential",
      password: await hashPassword(DEMO_PASSWORD),
      createdAt: at,
      updatedAt: at,
    },
  });
}
