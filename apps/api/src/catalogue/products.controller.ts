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
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { routeThrottle } from '../common/utils/route-throttle';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request-meta';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  ProductDetailDto,
  ProductDto,
  TaxCategoryDto,
  addBarcodeSchema,
  barcodeLookupQuerySchema,
  createBrandSchema,
  createCategorySchema,
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
  type AddBarcodeInput,
  type BarcodeLookupQuery,
  type CreateBrandInput,
  type CreateCategoryInput,
  type CreateProductInput,
  type ListProductsQuery,
  type UpdateProductInput,
} from './dto';
import { ProductsService } from './products.service';

@ApiTags('Catalogue')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Staff branch scoping: admins without a home branch may pass ?branchId. */
  private resolveBranch(user: AuthenticatedUser, query?: { branchId?: string }): string | null {
    return user.branchId ?? query?.branchId ?? null;
  }

  @Get()
  @RequirePermissions('catalogue:read')
  @ApiOperation({ summary: 'List/search products (paginated)' })
  async list(
    @Query(new ZodValidationPipe(listProductsQuerySchema)) query: ListProductsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.products.list(query, this.resolveBranch(user, query));
  }

  @Get('barcode/:barcode')
  @RequirePermissions('catalogue:read')
  @Throttle(routeThrottle(120))
  @ApiOperation({ summary: 'Scan lookup by barcode (branch price/availability/stock)' })
  async byBarcode(
    @Param('barcode') barcode: string,
    @Query(new ZodValidationPipe(barcodeLookupQuerySchema)) query: BarcodeLookupQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductDetailDto> {
    return this.products.getByBarcode(barcode, this.resolveBranch(user, query));
  }

  @Get(':id')
  @RequirePermissions('catalogue:read')
  @ApiOperation({ summary: 'Product detail' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductDetailDto> {
    return this.products.getById(id, this.resolveBranch(user));
  }

  @Post()
  @RequirePermissions('catalogue:write')
  @ApiOperation({ summary: 'Create a product with optional barcodes (admin/manager)' })
  async create(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ProductDto> {
    return this.products.create(body, { id: user.id, requestId: requestMeta(request).requestId });
  }

  @Patch(':id')
  @RequirePermissions('catalogue:write')
  @ApiOperation({ summary: 'Update product fields (admin/manager)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ProductDto> {
    return this.products.update(id, body, {
      id: user.id,
      requestId: requestMeta(request).requestId,
    });
  }

  @Post(':id/barcodes')
  @RequirePermissions('catalogue:write')
  @ApiOperation({ summary: 'Register an additional barcode' })
  async addBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addBarcodeSchema)) body: AddBarcodeInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ProductDto> {
    return this.products.addBarcode(id, body, {
      id: user.id,
      requestId: requestMeta(request).requestId,
    });
  }

  @Delete(':id/barcodes/:barcodeId')
  @RequirePermissions('catalogue:write')
  @ApiOperation({ summary: 'Remove a barcode (at least one must remain)' })
  async removeBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ProductDto> {
    return this.products.removeBarcode(id, barcodeId, {
      id: user.id,
      requestId: requestMeta(request).requestId,
    });
  }
}

@ApiTags('Catalogue')
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly products: ProductsService) {}

  @Get('tax-categories')
  @RequirePermissions('catalogue:read')
  @ApiOperation({ summary: 'Tax categories with rates' })
  async taxCategories(): Promise<TaxCategoryDto[]> {
    return this.products.listTaxCategories();
  }

  @Post('categories')
  @RequirePermissions('catalogue:write')
  @ApiOperation({ summary: 'Create (or fetch by slug) a category' })
  async createCategory(
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.products.createCategory(body, {
      id: user.id,
      requestId: requestMeta(request).requestId,
    });
  }

  @Post('brands')
  @RequirePermissions('catalogue:write')
  @ApiOperation({ summary: 'Create (or fetch by slug) a brand' })
  async createBrand(
    @Body(new ZodValidationPipe(createBrandSchema)) body: CreateBrandInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.products.createBrand(body, {
      id: user.id,
      requestId: requestMeta(request).requestId,
    });
  }
}
