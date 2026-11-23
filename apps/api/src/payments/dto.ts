import { z } from 'zod';

export const intentSchema = z.object({
  orderId: z.uuid(),
  /** Client-generated UUID — retried intent creations return the same payment. */
  idempotencyKey: z.uuid(),
});
export type IntentInput = z.infer<typeof intentSchema>;
