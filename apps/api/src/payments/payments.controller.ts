import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { routeThrottle } from '../common/utils/route-throttle';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from './payments.service';
import { intentSchema, type IntentInput } from './dto';

function sessionToken(request: Request): string | undefined {
  const header = request.headers['x-session-token'];
  return typeof header === 'string' && header.length >= 20 ? header : undefined;
}

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
  ) {}

  @Public()
  @Post('intent')
  @ApiOperation({ summary: 'Create a payment intent for a pending order' })
  async createIntent(
    @Body(new ZodValidationPipe(intentSchema)) body: IntentInput,
    @Req() request: Request,
  ): Promise<unknown> {
    const token = sessionToken(request);
    if (!token) throw new ForbiddenException({ code: 'ORDER_ACCESS_DENIED' });
    await this.orders.assertSessionOwnsOrder(body.orderId, token);
    return this.payments.createIntent(body.orderId, body.idempotencyKey);
  }

  /**
   * Demo settlement: the server emits the signed MOCK callback itself, so the
   * same verify → settle path as a real webhook executes end-to-end.
   */
  @Public()
  @Post(':id/mock-settle')
  @Throttle(routeThrottle(20))
  @ApiOperation({ summary: 'Demo: settle a MOCK payment via the signed webhook path' })
  async mockSettle(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<unknown> {
    const token = sessionToken(request);
    if (!token) throw new ForbiddenException({ code: 'ORDER_ACCESS_DENIED' });
    const payment = (await this.payments.getPayment(id)) as { orderId: string };
    await this.orders.assertSessionOwnsOrder(payment.orderId, token);
    return this.payments.mockSettle(id);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Payment status (customer session token required)' })
  async getPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<unknown> {
    const token = sessionToken(request);
    if (!token) throw new ForbiddenException({ code: 'ORDER_ACCESS_DENIED' });
    const payment = (await this.payments.getPayment(id)) as { orderId: string };
    await this.orders.assertSessionOwnsOrder(payment.orderId, token);
    return payment;
  }

  /**
   * Provider webhooks. The raw (untouched) body is required — HMACs are
   * computed over exact bytes. Signature verification happens BEFORE any DB
   * access; duplicates are idempotent 2xx no-ops.
   */
  @Public()
  @Post('webhooks/:provider')
  @Throttle(routeThrottle(300))
  @ApiOperation({ summary: 'Provider webhook (signature-verified, idempotent)' })
  async webhook(
    @Param('provider') provider: string,
    @Req() request: Request & { rawBody?: Buffer },
  ): Promise<unknown> {
    const rawBody =
      request.rawBody?.toString('utf8') ?? (typeof request.body === 'string' ? request.body : '');
    return this.payments.handleWebhook(provider.toUpperCase(), request.headers, rawBody);
  }
}
