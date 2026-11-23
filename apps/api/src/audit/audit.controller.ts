import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';
import { AuditLogDto } from './audit.dto';
import { ListAuditQuery, listAuditQuerySchema } from './audit.query';

@ApiTags('Audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:view')
  @ApiOperation({ summary: 'List audit log entries (paginated, newest first)' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(AuditLogDto) } },
        meta: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  async list(
    @Query(new ZodValidationPipe(listAuditQuerySchema)) query: ListAuditQuery,
  ): Promise<unknown> {
    return this.audit.listEntries(query);
  }
}
