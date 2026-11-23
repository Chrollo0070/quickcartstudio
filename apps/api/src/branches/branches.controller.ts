import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request-meta';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  BranchDto,
  PublicBranchDto,
  StoreSettingsDto,
  createBranchSchema,
  updateBranchSchema,
  updateStoreSettingsSchema,
  type CreateBranchInput,
  type UpdateBranchInput,
  type UpdateStoreSettingsInput,
} from './dto';
import { BranchesService } from './branches.service';

@ApiTags('Branches')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List active branches (public store selection)' })
  @ApiOkResponse({ type: PublicBranchDto, isArray: true })
  async listPublic(): Promise<PublicBranchDto[]> {
    return this.branches.listPublic();
  }

  @Get('staff')
  @RequirePermissions('catalogue:read')
  @ApiOperation({ summary: 'List all branches with details (staff)' })
  @ApiOkResponse({ type: BranchDto, isArray: true })
  async list(): Promise<BranchDto[]> {
    return this.branches.list();
  }

  @Get(':id')
  @RequirePermissions('catalogue:read')
  @ApiOperation({ summary: 'Branch details' })
  @ApiOkResponse({ type: BranchDto })
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<BranchDto> {
    return this.branches.getById(id);
  }

  @Post()
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Create a branch (admin)' })
  @ApiOkResponse({ type: BranchDto })
  async create(
    @Body(new ZodValidationPipe(createBranchSchema)) body: CreateBranchInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<BranchDto> {
    return this.branches.create(body, { id: user.id, requestId: requestMeta(request).requestId });
  }

  @Patch(':id')
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Update a branch (admin)' })
  @ApiOkResponse({ type: BranchDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBranchSchema)) body: UpdateBranchInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<BranchDto> {
    return this.branches.update(id, body, {
      id: user.id,
      requestId: requestMeta(request).requestId,
    });
  }

  @Get(':id/settings')
  @RequirePermissions('catalogue:read')
  @ApiOperation({ summary: 'Store settings for a branch' })
  @ApiOkResponse({ type: StoreSettingsDto })
  async getSettings(@Param('id', ParseUUIDPipe) id: string): Promise<StoreSettingsDto> {
    return this.branches.getSettings(id);
  }

  @Patch(':id/settings')
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Update store settings (tax mode, loyalty, rounding)' })
  @ApiOkResponse({ type: StoreSettingsDto })
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStoreSettingsSchema)) body: UpdateStoreSettingsInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<StoreSettingsDto> {
    return this.branches.updateSettings(id, body, {
      id: user.id,
      requestId: requestMeta(request).requestId,
    });
  }
}
