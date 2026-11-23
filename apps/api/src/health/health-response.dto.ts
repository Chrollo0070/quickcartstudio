import { ApiProperty } from '@nestjs/swagger';

/** Dependency checks reported by the health endpoint. */
export class HealthChecksDto {
  @ApiProperty({ enum: ['up', 'down'], description: 'Database round-trip status' })
  database!: 'up' | 'down';
}

/**
 * Public health report shape. Kept as an explicit DTO class (not the raw
 * service object) so the API contract is stable and documented in Swagger.
 */
export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'], description: 'Overall service health' })
  status!: 'ok' | 'degraded';

  @ApiProperty({ example: 'quickcart-api', description: 'Service identifier' })
  service!: string;

  @ApiProperty({ example: 'Supermarket self-checkout, POS and inventory platform' })
  description!: string;

  @ApiProperty({ format: 'date-time', description: 'Time the report was produced (UTC)' })
  timestamp!: string;

  @ApiProperty({ type: Number, description: 'Process uptime in seconds' })
  uptimeSeconds!: number;

  @ApiProperty({ type: HealthChecksDto, description: 'Dependency checks' })
  checks!: HealthChecksDto;
}
