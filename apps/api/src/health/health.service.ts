import { Injectable } from '@nestjs/common';
import { SERVICE_NAME } from '@quickcart/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { HealthChecksDto, HealthResponseDto } from './health-response.dto';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness + dependency probe. The database check is a real round trip
   * (`SELECT 1`) — not a cached flag — because this endpoint is what operators
   * (and later, orchestration readiness gates) will trust.
   */
  async check(): Promise<HealthResponseDto> {
    let database: HealthChecksDto['database'] = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: SERVICE_NAME,
      description: 'Supermarket self-checkout, POS and inventory platform',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks: { database },
    };
  }
}
