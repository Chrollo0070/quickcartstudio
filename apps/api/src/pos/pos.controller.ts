import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CheckoutService } from '../checkout/checkout.service';
import { scanSchema, confirmSchema, type ScanInput } from '../checkout/dto';
import { PosService, type OperatorIdentity } from './pos.service';

const completeSchema = confirmSchema.extend({
  paymentMethod: z.enum(['CASH', 'MOCK']),
});
type CompleteInput = z.infer<typeof completeSchema>;

const refundRequestSchema = z.object({
  orderId: z.uuid(),
  reason: z.string().min(3).max(500),
  idempotencyKey: z.uuid(),
});
type RefundRequestInput = z.infer<typeof refundRequestSchema>;

const openShiftSchema = z.object({
  openingCash: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const closeShiftSchema = z.object({
  closingCash: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

function operatorFrom(user: AuthenticatedUser | undefined): OperatorIdentity {
  if (!user) {
    throw new Error('operator identity missing — JwtAuthGuard must run first');
  }
  return { id: user.id, branchId: user.branchId };
}

@ApiTags('POS')
@Controller('pos')
@RequirePermissions('pos:operate')
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly checkout: CheckoutService,
  ) {}

  @Post('sessions')
  @ApiOperation({ summary: 'Open a POS register session (operator-owned)' })
  async createSession(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.pos.createSession(operatorFrom(user), null);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Open/suspended POS sessions for the branch' })
  async listSessions(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.pos.listSessions(operatorFrom(user));
  }

  @Post('sessions/:id/items/scan')
  @ApiOperation({ summary: 'Add a scanned product (availability check, no reservation)' })
  async scan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(scanSchema)) body: ScanInput,
  ): Promise<unknown> {
    return this.checkout.operatorScan(id, body);
  }

  @Post('sessions/:id/suspend')
  @ApiOperation({ summary: 'Park a register sale' })
  async suspend(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.pos.suspendSession(id);
  }

  @Post('sessions/:id/resume')
  @ApiOperation({ summary: 'Resume a parked sale (revalidates prices)' })
  async resume(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.pos.resumeSession(id);
  }

  @Post('sessions/:id/complete')
  @ApiOperation({ summary: 'Confirm + settle immediately (cash or mock)' })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(completeSchema)) body: CompleteInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.pos.complete(
      id,
      {
        paymentMethod: body.paymentMethod,
        idempotencyKey: body.idempotencyKey,
        expectedQuoteHash: body.expectedQuoteHash,
      },
      operatorFrom(user),
    );
  }

  @Post('shifts')
  @ApiOperation({ summary: 'Open the cashier shift with an opening cash float' })
  async openShift(
    @Body(new ZodValidationPipe(openShiftSchema)) body: { openingCash: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.pos.openShift(operatorFrom(user), body.openingCash);
  }

  @Get('shifts/current')
  @ApiOperation({ summary: 'Current shift with a real, order-derived summary' })
  async currentShift(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.pos.currentShift(operatorFrom(user));
  }

  @Post('shifts/close')
  @ApiOperation({ summary: 'Close the shift with a counted closing cash' })
  async closeShift(
    @Body(new ZodValidationPipe(closeShiftSchema)) body: { closingCash: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.pos.closeShift(operatorFrom(user), body.closingCash);
  }

  @Post('refunds')
  @RequirePermissions('pos:refund:process')
  @ApiOperation({ summary: 'Request a full-order refund (cashier)' })
  async requestRefund(
    @Body(new ZodValidationPipe(refundRequestSchema)) body: RefundRequestInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.pos.requestRefund(
      body.orderId,
      body.reason,
      operatorFrom(user),
      body.idempotencyKey,
    );
  }

  @Get('refunds')
  @RequirePermissions('pos:refund:process')
  @ApiOperation({ summary: 'Pending refund requests' })
  async pendingRefunds(): Promise<unknown> {
    return this.pos.listPendingRefunds();
  }

  @Post('refunds/:id/approve')
  @RequirePermissions('orders:refund:approve')
  @ApiOperation({ summary: 'Approve a refund → stock RETURN (manager)' })
  async approveRefund(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.pos.approveRefund(id, operatorFrom(user));
  }
}
