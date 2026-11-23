import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { BranchesModule } from './branches/branches.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CheckoutModule } from './checkout/checkout.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PosModule } from './pos/pos.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { InventoryModule } from './inventory/inventory.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Modular monolith root. Global middleware chain: ThrottlerGuard (default
 * 100 req/min per IP, tightened per-route) → JwtAuthGuard (verifies token AND
 * loads the live user; @Public routes skip) → RolesGuard (@Roles /
 * @RequirePermissions metadata). Phase 0 wired only infrastructure; Phase 1
 * adds auth, branches and catalogue.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        // E2E suites share one IP; NODE_ENV=test relaxes the global limit
        // (route-level limits scale the same way via routeThrottle()).
        limit: process.env.NODE_ENV === 'test' ? 5_000 : 100,
      },
    ]),
    PrismaModule,
    AuditModule,
    AuthModule,
    BranchesModule,
    CatalogueModule,
    CheckoutModule,
    OrdersModule,
    PaymentsModule,
    PosModule,
    DashboardModule,
    InventoryModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
