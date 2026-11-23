import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateBranchInput,
  PublicBranchDto,
  BranchDto,
  StoreSettingsDto,
  UpdateBranchInput,
  UpdateStoreSettingsInput,
} from './dto';

const PUBLIC_SELECT = { id: true, code: true, name: true, city: true } as const;

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Public listing for store selection (self-checkout welcome screen). */
  async listPublic(): Promise<PublicBranchDto[]> {
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: PUBLIC_SELECT,
      orderBy: { name: 'asc' },
    });
    return branches;
  }

  async list(): Promise<BranchDto[]> {
    const branches = await this.prisma.branch.findMany({ orderBy: { name: 'asc' } });
    return branches.map((b) => this.toDto(b));
  }

  async getById(id: string): Promise<BranchDto> {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) {
      throw new NotFoundException({ message: 'Branch not found', code: 'BRANCH_NOT_FOUND' });
    }
    return this.toDto(branch);
  }

  async create(
    input: CreateBranchInput,
    actor: { id: string; requestId?: string },
  ): Promise<BranchDto> {
    const branch = await this.prisma.branch.create({ data: input });
    await this.prisma.storeSettings.create({
      data: { branchId: branch.id },
    });
    await this.audit.log({
      actorUserId: actor.id,
      branchId: branch.id,
      action: 'branch.create',
      entityType: 'Branch',
      entityId: branch.id,
      metadata: { code: branch.code },
      requestId: actor.requestId,
    });
    return this.toDto(branch);
  }

  async update(
    id: string,
    input: UpdateBranchInput,
    actor: { id: string; requestId?: string },
  ): Promise<BranchDto> {
    const branch = await this.prisma.branch.update({ where: { id }, data: input });
    await this.audit.log({
      actorUserId: actor.id,
      branchId: branch.id,
      action: 'branch.update',
      entityType: 'Branch',
      entityId: branch.id,
      metadata: { fields: Object.keys(input) },
      requestId: actor.requestId,
    });
    return this.toDto(branch);
  }

  async getSettings(branchId: string): Promise<StoreSettingsDto> {
    const settings = await this.prisma.storeSettings.findUnique({ where: { branchId } });
    if (!settings) {
      throw new NotFoundException({
        message: 'Store settings not found',
        code: 'SETTINGS_NOT_FOUND',
      });
    }
    return {
      taxMode: settings.taxMode,
      roundingMode: settings.roundingMode,
      loyaltyEarnRate: settings.loyaltyEarnRate.toString(),
      loyaltyRedeemRate: settings.loyaltyRedeemRate.toString(),
      loyaltyMinRedeemPoints: settings.loyaltyMinRedeemPoints,
      loyaltyMaxRedeemPercent: settings.loyaltyMaxRedeemPercent.toString(),
      invoicePrefix: settings.invoicePrefix,
      timezone: settings.timezone,
    };
  }

  async updateSettings(
    branchId: string,
    input: UpdateStoreSettingsInput,
    actor: { id: string; requestId?: string },
  ): Promise<StoreSettingsDto> {
    const settings = await this.prisma.storeSettings.update({
      where: { branchId },
      data: input,
    });
    await this.audit.log({
      actorUserId: actor.id,
      branchId,
      action: 'branch.settings.update',
      entityType: 'StoreSettings',
      entityId: settings.id,
      metadata: { fields: Object.keys(input) },
      requestId: actor.requestId,
    });
    return this.getSettings(branchId);
  }

  private toDto(branch: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    gstin: string | null;
    phone: string | null;
    isActive: boolean;
  }): BranchDto {
    return {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      address: branch.address,
      city: branch.city,
      state: branch.state,
      gstin: branch.gstin,
      phone: branch.phone,
      isActive: branch.isActive,
    };
  }
}
