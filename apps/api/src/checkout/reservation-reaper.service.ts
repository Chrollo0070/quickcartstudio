import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Reservation reaper (ADR-004): expires ACTIVE reservations past their TTL and
 * releases the held `reserved` stock with RESERVATION_RELEASE ledger rows.
 *
 * Complements the lazy expiry in CheckoutService (which only triggers when an
 * abandoned session is accessed again — dead sessions would otherwise hold
 * stock indefinitely). In-process interval for the MVP; swaps to a BullMQ
 * repeatable job when Redis lands (documented in implementation-status).
 */
@Injectable()
export class ReservationReaperService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(ReservationReaperService.name);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Unit tests never boot the Nest app, so the interval only exists in the
    // real server (and in E2E runs, where the reaper must also work).
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Release every ACTIVE reservation past its TTL. Returns rows released. */
  async sweep(): Promise<number> {
    const expired = await this.prisma.stockReservation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      select: { id: true, branchId: true, productId: true, quantity: true, sessionId: true },
      take: 200,
    });
    for (const reservation of expired) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE "InventoryBalance"
            SET "reserved" = GREATEST(0, "reserved" - ${reservation.quantity}), "updatedAt" = now()
            WHERE "branchId" = ${reservation.branchId}::uuid AND "productId" = ${reservation.productId}::uuid`;
          await tx.stockMovement.create({
            data: {
              branchId: reservation.branchId,
              productId: reservation.productId,
              type: 'RESERVATION_RELEASE',
              quantity: reservation.quantity.negated(),
              reason: 'Reservation expired (reaper)',
              refType: 'checkout_session',
              refId: reservation.sessionId,
            },
          });
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { status: 'EXPIRED' },
          });
        });
      } catch (error) {
        // A lost race (session settled/cancelled concurrently) is fine — the
        // next sweep re-evaluates whatever is still ACTIVE.
        this.logger.warn(
          `Reaper skipped reservation ${reservation.id}: ${(error as Error).message}`,
        );
      }
    }
    if (expired.length > 0) {
      this.logger.log(`Released ${expired.length} expired reservation(s)`);
    }
    return expired.length;
  }
}
