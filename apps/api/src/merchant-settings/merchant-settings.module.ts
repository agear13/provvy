// apps/api/src/merchant-settings/merchant-settings.module.ts
import { Module } from '@nestjs/common';
import { MerchantSettingsService } from './merchant-settings.service';
import { MerchantSettingsController } from './merchant-settings.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [MerchantSettingsService],
  controllers: [MerchantSettingsController],
})
export class MerchantSettingsModule {}
