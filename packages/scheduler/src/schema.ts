import { z } from "zod";

/**
 * A CardState as read back from card_state.state (jsonb). Parse every state read from the
 * database, so a corrupt row fails loudly instead of producing a wrong schedule.
 * Loose on purpose: FSRS and SM-2 states carry fields of their own.
 */
export const cardStateSchema = z.looseObject({
  kind: z.enum(["fsrs", "sm2", "placeholder"]),
  last_review_at: z.iso.datetime().nullable(),
  due_at: z.iso.datetime().nullable(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
});

/** An FSRS state: zeros until the first review, then D in [1, 10] and S > 0. */
export const fsrsCardStateSchema = cardStateSchema.extend({
  kind: z.literal("fsrs"),
  difficulty: z.number().min(0).max(10),
  stability: z.number().nonnegative(),
  scheduled_days: z.number().int().nonnegative(),
});
