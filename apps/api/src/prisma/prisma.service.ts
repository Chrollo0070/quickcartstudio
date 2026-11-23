import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Application-wide Prisma client. Registered once in the global PrismaModule
 * so every feature module shares the same connection pool. In later phases,
 * transactional services (pricing, order completion, stock ledger) receive
 * this instance and use `prisma.$transaction` with explicit isolation levels.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: 10,
      }),
      log: [
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch {
      console.warn('[QuickCart] Database not connected — Prisma client running offline');
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect();
    } catch {
      // Ignore disconnect errors when database was not connected
    }
  }
}
