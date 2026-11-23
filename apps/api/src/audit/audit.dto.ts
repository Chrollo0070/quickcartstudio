import { ApiProperty } from '@nestjs/swagger';

export class AuditLogDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  actorUserId!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  branchId!: string | null;

  @ApiProperty({ example: 'catalogue.product.create' })
  action!: string;

  @ApiProperty({ example: 'Product' })
  entityType!: string;

  @ApiProperty({ format: 'uuid' })
  entityId!: string;

  @ApiProperty({ nullable: true, type: Object })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String })
  requestId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
