import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { routeThrottle } from '../common/utils/route-throttle';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CheckoutSessionDto,
  attachCustomerSchema,
  type AttachCustomerInput,
  ConfirmResultDto,
  SearchProductDto,
  confirmSchema,
  createSessionSchema,
  quoteSchema,
  scanSchema,
  searchQuerySchema,
  updateItemSchema,
  type ConfirmInput,
  type CreateSessionInput,
  type QuoteInput,
  type ScanInput,
  type SearchQueryInput,
  type UpdateItemInput,
} from './dto';
import { CheckoutService } from './checkout.service';
import { CheckoutSessionGuard } from './checkout.guard';

@ApiTags('Checkout')
@UseGuards(CheckoutSessionGuard)
@Controller('checkout/sessions')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Start a self-checkout session (returns possession token)' })
  async create(
    @Body(new ZodValidationPipe(createSessionSchema)) body: CreateSessionInput,
  ): Promise<{ sessionId: string; sessionToken: string; expiresAt: string }> {
    return this.checkout.createSession(body.branchId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Session state with cart items and live prices' })
  @ApiOkResponse({ type: CheckoutSessionDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.checkout.getSession(id);
  }

  @Public()
  @Post(':id/customer')
  @ApiOperation({ summary: 'Attach a walk-in customer by phone (loyalty path)' })
  async attachCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(attachCustomerSchema)) body: AttachCustomerInput,
  ): Promise<unknown> {
    return this.checkout.attachCustomer(id, body);
  }

  @Public()
  @Get(':id/search')
  @ApiOperation({ summary: 'Manual product search fallback for the scanner' })
  async search(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryInput,
  ): Promise<SearchProductDto[]> {
    return this.checkout.search(id, query) as Promise<SearchProductDto[]>;
  }

  @Public()
  @Post(':id/items/scan')
  @Throttle(routeThrottle(120))
  @ApiOperation({ summary: 'Add one unit of a scanned product (reserves stock)' })
  async scan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(scanSchema)) body: ScanInput,
  ): Promise<unknown> {
    return this.checkout.scan(id, body);
  }

  @Public()
  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Change an item quantity (adjusts the reservation)' })
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodValidationPipe(updateItemSchema)) body: UpdateItemInput,
  ): Promise<unknown> {
    return this.checkout.updateItem(id, itemId, body);
  }

  @Public()
  @Delete(':id/items/:itemId')
  @ApiOperation({ summary: 'Remove an item (releases its reservation)' })
  async removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<unknown> {
    return this.checkout.removeItem(id, itemId);
  }

  @Public()
  @Post(':id/quote')
  @ApiOperation({ summary: 'Server-authoritative totals (+ optional coupon)' })
  async quote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(quoteSchema)) body: QuoteInput,
  ): Promise<{ quote: unknown }> {
    return this.checkout.quote(id, body);
  }

  @Public()
  @Post(':id/confirm')
  @ApiOperation({
    summary: 'Create the PENDING_PAYMENT order (payment settles in Phase 3)',
  })
  @ApiOkResponse({ type: ConfirmResultDto })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(confirmSchema)) body: ConfirmInput,
  ): Promise<unknown> {
    return this.checkout.confirm(id, body);
  }

  @Public()
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel the session and release reservations' })
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.checkout.cancel(id);
  }
}
