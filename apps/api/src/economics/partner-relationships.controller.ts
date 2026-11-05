import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import {
  ECONOMICS_REPOSITORY,
  type EconomicsRepository,
} from './economics.repository';
import { rethrowEconomicsHttp } from './http';
import { parsePartnerPropose } from './partner-write-schema';

@Controller('partner/relationships')
export class PartnerRelationshipsController {
  constructor(
    @Inject(ECONOMICS_REPOSITORY)
    private readonly economics: EconomicsRepository,
  ) {}

  @Post()
  async propose(
    @Body() body: unknown,
    @Headers('x-source-system') sourceSystem?: string,
  ) {
    try {
      const parsed = parsePartnerPropose(body);
      return await this.economics.proposeRelationship({
        ...parsed,
        sourceSystem: sourceSystem?.trim() || 'partner',
      });
    } catch (error) {
      rethrowEconomicsHttp(error);
    }
  }
}
