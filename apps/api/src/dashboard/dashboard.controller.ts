import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard')
@RequirePermissions('dashboard:view:branch')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('recent-orders')
  @ApiOperation({ summary: 'Latest orders for the live feed (branch-scoped)' })
  async recentOrders(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.dashboard.recentOrders({ branchId: user.branchId });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Today: gross sales, orders, average basket, payment mix' })
  async summary(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.dashboard.summary({ branchId: user.branchId });
  }

  @Get('sales')
  @ApiOperation({ summary: 'Sales by hour, last 24h (completed orders)' })
  async sales(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.dashboard.salesByHour({ branchId: user.branchId });
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Top products by units sold' })
  async topProducts(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.dashboard.topProducts({ branchId: user.branchId });
  }
}
