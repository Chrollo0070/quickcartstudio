import { z } from 'zod';

export const listAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  entityType: z.string().min(1).max(100).optional(),
  entityId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  action: z.string().min(1).max(100).optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
