// apps/api/src/merchant-settings/merchant-settings.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertMerchantSettingsDto } from './dto/upsert-merchant-settings.dto';

@Injectable()
export class MerchantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getByClerkOrgId(clerkOrgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { clerkOrgId },
      include: { settings: true },
    });

    if (!org || !org.settings) {
      // Option 1: return null and let the frontend handle "not configured yet"
      return null;
    }

    return org.settings;
  }

  async upsertByClerkOrgId(clerkOrgId: string, dto: UpsertMerchantSettingsDto) {
    // Ensure the organization exists
    const org = await this.prisma.organization.upsert({
      where: { clerkOrgId },
      create: { clerkOrgId },
      update: {},
    });

    // Upsert merchant settings for that org
    const settings = await this.prisma.merchantSettings.upsert({
      where: { orgId: org.id },
      create: {
        orgId: org.id,
        displayName: dto.displayName,
        logoKey: dto.logoKey ?? null,
        defaultCurrency: dto.defaultCurrency.toUpperCase(),
        functionalCurrency: dto.functionalCurrency.toUpperCase(),
        updatedByUserId: dto.updatedByUserId,
      },
      update: {
        displayName: dto.displayName,
        logoKey: dto.logoKey ?? null,
        defaultCurrency: dto.defaultCurrency.toUpperCase(),
        functionalCurrency: dto.functionalCurrency.toUpperCase(),
        updatedByUserId: dto.updatedByUserId,
      },
    });

    return settings;
  }
}
