import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  FundingWorkflowError,
  PartnerFundingForbiddenError,
  PartnerWriteError,
} from './types';

export function rethrowEconomicsHttp(error: unknown): never {
  if (error instanceof PartnerFundingForbiddenError) {
    throw new ForbiddenException({ error: error.code, message: error.message });
  }
  if (
    error instanceof FundingWorkflowError &&
    error.code === 'INTERNAL_ACTOR_REQUIRED'
  ) {
    throw new ForbiddenException({ error: error.code, message: error.message });
  }
  if (
    error instanceof FundingWorkflowError ||
    error instanceof PartnerWriteError
  ) {
    throw new BadRequestException({
      error: error.code,
      message: error.message,
    });
  }
  throw error;
}
