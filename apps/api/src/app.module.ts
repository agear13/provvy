import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { MerchantSettingsModule } from './merchant-settings/merchant-settings.module';

@Module({
  imports: [PrismaModule, MerchantSettingsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
