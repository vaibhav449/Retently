import {
  type ExamInput,
  type ExamUpdate,
  examInputSchema,
  examUpdateSchema,
  topicKeySchema,
} from "@repo/contracts";
import type { z } from "zod";
import type { ExamConfig } from "../config";
import { localDaysBetween } from "../time";

/** Why an exam request was refused. Nothing is written when one of these is thrown. */
export type ExamErrorCode =
  /** The body is not an exam: not JSON, unknown fields, nothing to change, or too many notes. */
  | "invalid_request"
  /** exam_date is not a date, or is before the user's local today. */
  | "invalid_date"
  /** exam_date is more than a year ahead (EM-12). */
  | "date_too_far"
  /** target_retention is missing a number or outside 0.8–0.97 (07 §6; refused, not clamped). */
  | "invalid_target"
  /** topic_keys is empty. */
  | "empty_scope"
  /** A topic key is malformed, or names a note the user cannot read (or that does not exist). */
  | "unreadable_scope"
  /** The user already has the most upcoming exams allowed (EM-12). */
  | "too_many_exams"
  /** No such exam for this user: missing, someone else's, or not a uuid. */
  | "not_found";

/** The HTTP status of each code. */
export const EXAM_ERROR_STATUS: Record<ExamErrorCode, number> = {
  invalid_request: 400,
  invalid_date: 400,
  date_too_far: 400,
  invalid_target: 400,
  empty_scope: 400,
  unreadable_scope: 400,
  too_many_exams: 400,
  not_found: 404,
};

export class ExamError extends Error {
  constructor(
    readonly code: ExamErrorCode,
    message: string,
    /** The request field at fault, when there is one. */
    readonly field?: "exam_date" | "topic_keys" | "target_retention",
  ) {
    super(message);
    this.name = "ExamError";
  }
}

/** The source id of a topic key "src:<uuid>", or null when it is not one. Pure. */
export function parseTopicKey(key: string): string | null {
  return topicKeySchema.safeParse(key).success ? key.slice("src:".length) : null;
}

/** The first problem of a body that failed its schema, as an exam error code. */
function errorOf(error: z.ZodError): ExamError {
  const issue = error.issues[0];
  const field = issue?.path[0];
  if (field === "exam_date") {
    return new ExamError("invalid_date", "exam_date must be a date, YYYY-MM-DD.", field);
  }
  if (field === "target_retention") {
    return new ExamError(
      "invalid_target",
      "target_retention must be a number from 0.8 to 0.97.",
      field,
    );
  }
  if (field === "topic_keys") {
    if (issue?.code === "too_small" && issue.path.length === 1) {
      return new ExamError("empty_scope", "Choose at least one note for the exam.", field);
    }
    if (issue?.code === "too_big" && issue.path.length === 1) {
      return new ExamError("invalid_request", "An exam covers at most 200 notes.", field);
    }
    return new ExamError("unreadable_scope", "Each topic key must be src:<note source id>.", field);
  }
  return new ExamError("invalid_request", issue?.message ?? "Not an exam.");
}

/** POST /api/exams' body, or an ExamError. Pure. */
export function parseExamInput(body: unknown): ExamInput {
  const parsed = examInputSchema.safeParse(body);
  if (!parsed.success) throw errorOf(parsed.error);
  return parsed.data;
}

/** PATCH /api/exams/:id's body, or an ExamError. Pure. */
export function parseExamUpdate(body: unknown): ExamUpdate {
  const parsed = examUpdateSchema.safeParse(body);
  if (!parsed.success) throw errorOf(parsed.error);
  return parsed.data;
}

/**
 * exam_date is the user's local today or later, and at most cfg.maxDaysAhead days ahead (ER1.4,
 * EM-12). Throws an ExamError. Pure.
 */
export function checkExamDate(examDate: string, today: string, cfg: ExamConfig): void {
  const daysAhead = localDaysBetween(today, examDate);
  if (daysAhead < 0) {
    throw new ExamError("invalid_date", "The exam date is in the past.", "exam_date");
  }
  if (daysAhead > cfg.maxDaysAhead) {
    throw new ExamError(
      "date_too_far",
      `The exam date is more than ${cfg.maxDaysAhead} days away.`,
      "exam_date",
    );
  }
}
