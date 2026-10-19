import { z } from "zod";

/** 18+ only during the MVP (build-plan.md §11.3): no verifiable parental consent flow yet. */
export const MINIMUM_AGE = 18;
const MAXIMUM_AGE = 120;

/** Whole years between `dob` and `today`, compared as calendar dates in UTC. */
export function ageOn(dob: Date, today: Date): number {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Date of birth as sent at signup: "2004-05-01" from the form, or an ISO timestamp.
 * Outputs a Date at UTC midnight. Used by the form for an early message and by
 * Better Auth as the field validator, which is the check that counts.
 */
export const dobSchema = z.coerce
  .date({ error: "Enter a valid date of birth" })
  .transform((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())))
  .refine((dob) => dob.getTime() <= Date.now(), "Date of birth can't be in the future")
  .refine((dob) => ageOn(dob, new Date()) <= MAXIMUM_AGE, "Enter a valid date of birth")
  .refine(
    (dob) => ageOn(dob, new Date()) >= MINIMUM_AGE,
    `You must be ${MINIMUM_AGE} or older to use Retently`,
  );
