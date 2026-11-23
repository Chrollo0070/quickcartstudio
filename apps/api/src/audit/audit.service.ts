import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/utils/paginate';
import type { PaginatedEnvelope } from '../common/dto/pagination.dto';
import type { AuditLogDto } from './audit.dto';
import type { ListAuditQuery } from './audit.query';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  branchId?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
  ip?: string | null;
}

/**
 * Append-only audit writer for sensitive actions (auth events, catalogue and
 * settings mutations, later: approvals, refunds, adjustments). Audit failures
 * are logged but never break the business action they observe.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: entry.actorUserId ?? undefined,
          branchId: entry.branchId ?? undefined,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? '00000000-0000-0000-0000-000000000000',
          metadata: (entry.metadata as Prisma.InputJsonObject | undefined) ?? undefined,
          requestId: entry.requestId ?? undefined,
          ip: entry.ip ?? undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit entry "${entry.action}"`, error);
    }
  }

  async listEntries(query: ListAuditQuery): Promise<PaginatedEnvelope<AuditLogDto>> {
    const where = {
      entityType: query.entityType,
      entityId: query.entityId,
      actorUserId: query.actorUserId,
      branchId: query.branchId,
      action: query.action,
    };
    const { skip, take } = paginate(query);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        branchId: row.branchId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }
}
