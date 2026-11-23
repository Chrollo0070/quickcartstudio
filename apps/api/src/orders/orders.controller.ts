import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { OrdersService } from './orders.service';

function sessionToken(request: Request): string | undefined {
  const header = request.headers['x-session-token'];
  return typeof header === 'string' && header.length >= 20 ? header : undefined;
}

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Order status (customer session token required)' })
  async getOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<unknown> {
    const token = sessionToken(request);
    if (!token) throw new ForbiddenException({ code: 'ORDER_ACCESS_DENIED' });
    return this.orders.getOrder(id, token);
  }

  @Public()
  @Get(':id/receipt')
  @ApiOperation({ summary: 'Issued receipt snapshot (customer session token required)' })
  async getReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<unknown> {
    const token = sessionToken(request);
    if (!token) throw new ForbiddenException({ code: 'ORDER_ACCESS_DENIED' });
    return this.orders.getReceipt(id, token);
  }
}
