import { Module } from '@nestjs/common';
import { ECONOMICS_REPOSITORY } from './economics.repository';
import { InternalEconomicsController } from './internal-economics.controller';
import { PartnerRelationshipsController } from './partner-relationships.controller';
import { PrismaEconomicsRepository } from './prisma-economics.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PartnerRelationshipsController, InternalEconomicsController],
  providers: [
    PrismaEconomicsRepository,
    { provide: ECONOMICS_REPOSITORY, useExisting: PrismaEconomicsRepository },
  ],
})
export class EconomicsModule {}
