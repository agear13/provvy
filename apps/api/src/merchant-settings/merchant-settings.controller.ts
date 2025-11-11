// apps/api/src/merchant-settings/merchant-settings.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MerchantSettingsService } from './merchant-settings.service';
import { UpsertMerchantSettingsDto } from './dto/upsert-merchant-settings.dto';

@Controller('orgs')
export class MerchantSettingsController {
  constructor(private readonly merchantSettingsService: MerchantSettingsService) {}

  @Get(':clerkOrgId/settings')
  async getSettings(@Param('clerkOrgId') clerkOrgId: string) {
    const settings = await this.merchantSettingsService.getByClerkOrgId(clerkOrgId);
    return settings ?? { configured: false };
  }

  @Post(':clerkOrgId/settings')
  async upsertSettings(
    @Param('clerkOrgId') clerkOrgId: string,
    @Body() body: UpsertMerchantSettingsDto,
  ) {
    const settings = await this.merchantSettingsService.upsertByClerkOrgId(
      clerkOrgId,
      body,
    );
    return { configured: true, settings };
  }
}
