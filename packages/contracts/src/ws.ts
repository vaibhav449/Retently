import { z } from "zod";

/** Every message on the `/events` socket, in both directions, uses this envelope. */
export const wsEnvelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
  request_id: z.string().min(1).optional(),
});

export type WsEnvelope = z.infer<typeof wsEnvelopeSchema>;
