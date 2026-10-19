import { z } from "zod";

/** GET /api/realtime-token. Fetch a fresh token before every socket (re)connect. */
export const realtimeTokenResponseSchema = z.object({
  token: z.string().min(1),
  /** Seconds until the token stops being accepted for new connections. */
  expires_in: z.number().int().positive(),
});

export type RealtimeTokenResponse = z.infer<typeof realtimeTokenResponseSchema>;
