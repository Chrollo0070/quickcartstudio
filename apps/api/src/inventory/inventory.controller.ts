import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request-meta';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  adjustmentSchema,
  goodsReceiptSchema,
  listMovementsQuerySchema,
  purchaseOrderSchema,
  submitCountSchema,
  type AdjustmentInput,
  type GoodsReceiptInput,
  type ListMovementsQuery,
  type PurchaseOrderInput,
  type SubmitCountInput,
} from './dto';
import { InventoryService, type Actor } from './inventory.service';

function actorFrom(user: AuthenticatedUser | undefined, request: Request): Actor {
  if (!user) throw new Error('JwtAuthGuard must run first');
  return { id: user.id, branchId: user.branchId, requestId: requestMeta(request).requestId };
}

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'Branch stock balances with low-stock flags' })
  async balances(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.inventory.listBalances(user.branchId ?? '');
  }

  @Get('movements')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'Immutable stock movement ledger (paginated)' })
  async movements(
    @Query(new ZodValidationPipe(listMovementsQuerySchema)) query: ListMovementsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.inventory.listMovements(user.branchId ?? '', query);
  }

  @Get('alerts')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'Low-stock products + near-expiry batches (7 days)' })
  async alerts(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.inventory.alerts(user.branchId ?? '');
  }

  @Post('receipts')
  @RequirePermissions('inventory:receive')
  @ApiOperation({ summary: 'Goods receipt: batches + balances + ledger (one tx)' })
  async receive(
    @Body(new ZodValidationPipe(goodsReceiptSchema)) body: GoodsReceiptInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.inventory.receiveGoods(body, actorFrom(user, request));
  }

  @Post('adjustments')
  @RequirePermissions('inventory:adjust')
  @ApiOperation({ summary: 'Manual stock adjustment (mandatory reason + audit)' })
  async adjust(
    @Body(new ZodValidationPipe(adjustmentSchema)) body: AdjustmentInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.inventory.adjust(body, actorFrom(user, request));
  }

  @Post('counts')
  @RequirePermissions('inventory:adjust')
  @ApiOperation({ summary: 'Open a stock count (system snapshot per product)' })
  async createCount(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.inventory.createCount(actorFrom(user, request));
  }

  @Post('counts/:id/submit')
  @RequirePermissions('inventory:adjust')
  @ApiOperation({ summary: 'Submit counted quantities → PENDING_APPROVAL' })
  async submitCount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(submitCountSchema)) body: SubmitCountInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.inventory.submitCount(id, body, actorFrom(user, request));
  }

  @Post('counts/:id/approve')
  @RequirePermissions('inventory:adjust:approve')
  @ApiOperation({ summary: 'Approve count → one adjustment movement per variance' })
  async approveCount(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.inventory.approveCount(id, actorFrom(user, request));
  }

  @Get('counts')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'Recent stock counts' })
  async counts(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.inventory.listCounts(user.branchId ?? '');
  }

  @Post('purchase-orders')
  @RequirePermissions('procurement:write')
  @ApiOperation({ summary: 'Create a purchase order (DRAFT)' })
  async createPo(
    @Body(new ZodValidationPipe(purchaseOrderSchema)) body: PurchaseOrderInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.inventory.createPurchaseOrder(body, actorFrom(user, request));
  }

  @Post('purchase-orders/:id/submit')
  @RequirePermissions('procurement:write')
  @ApiOperation({ summary: 'Submit a purchase order' })
  async submitPo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.inventory.submitPurchaseOrder(id, actorFrom(user, request));
  }

  @Get('purchase-orders')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'Recent purchase orders' })
  async listPos(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.inventory.listPurchaseOrders(user.branchId ?? '');
  }
}
