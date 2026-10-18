import { z } from "zod";

export const serviceNameSchema = z.enum(["web", "realtime", "worker"]);

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: serviceNameSchema,
  uptimeSeconds: z.number().int().nonnegative(),
});

export type ServiceName = z.infer<typeof serviceNameSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
