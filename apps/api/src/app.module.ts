import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { MerchantSettingsModule } from './merchant-settings/merchant-settings.module';
import { EconomicsModule } from './economics/economics.module';

@Module({
  imports: [PrismaModule, MerchantSettingsModule, EconomicsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
