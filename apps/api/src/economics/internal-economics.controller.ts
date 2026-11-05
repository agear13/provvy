import { Body, Controller, Headers, Inject, Param, Post } from '@nestjs/common';
import {
  ECONOMICS_REPOSITORY,
  type EconomicsRepository,
} from './economics.repository';
import { rethrowEconomicsHttp } from './http';
import { assertAccrualBodyHasNoFundingMode } from './partner-write-schema';
import { FundingWorkflowError, type FundingMode } from './types';

@Controller('internal')
export class InternalEconomicsController {
  constructor(
    @Inject(ECONOMICS_REPOSITORY)
    private readonly economics: EconomicsRepository,
  ) {}

  @Post('agreement-versions/:versionId/terms/:termId/funding-mode')
  async configureFunding(
    @Param('versionId') versionId: string,
    @Param('termId') termId: string,
    @Headers('x-actor-kind') actorKind: string | undefined,
    @Headers('x-actor-id') actorId: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      if (actorKind !== 'internal') {
        throw new FundingWorkflowError('INTERNAL_ACTOR_REQUIRED');
      }
      const parsed = parseFundingBody(body);
      return await this.economics.configureFunding({
        actorKind,
        actorId: actorId ?? '',
        versionId,
        termId,
        fundingMode: parsed.fundingMode,
        deductionAuthorised: parsed.deductionAuthorised,
        newVersionId: parsed.newVersionId,
        effectiveFrom: parsed.effectiveFrom,
      });
    } catch (error) {
      rethrowEconomicsHttp(error);
    }
  }

  @Post('disclosures')
  async disclose(
    @Headers('x-actor-kind') actorKind: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      if (actorKind !== 'internal') {
        throw new FundingWorkflowError('INTERNAL_ACTOR_REQUIRED');
      }
      assertAccrualBodyHasNoFundingMode(body);
      const parsed = parseDisclosureBody(body);
      return await this.economics.recordDisclosure({ actorKind, ...parsed });
    } catch (error) {
      rethrowEconomicsHttp(error);
    }
  }

  @Post('events/accrue')
  async accrue(
    @Headers('x-actor-kind') actorKind: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      if (actorKind !== 'internal') {
        throw new FundingWorkflowError('INTERNAL_ACTOR_REQUIRED');
      }
      assertAccrualBodyHasNoFundingMode(body);
      const parsed = parseAccrualBody(body);
      return await this.economics.accrue({
        actorKind,
        versionId: parsed.versionId,
        event: parsed.event,
      });
    } catch (error) {
      rethrowEconomicsHttp(error);
    }
  }
}

function parseFundingBody(body: unknown): {
  fundingMode: FundingMode;
  deductionAuthorised: boolean;
  newVersionId: string;
  effectiveFrom?: string;
} {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw new FundingWorkflowError('FUNDING_BODY_INVALID');
  }
  const record = body as Record<string, unknown>;
  if (
    record.fundingMode !== 'ORG_PAYS' &&
    record.fundingMode !== 'CHILD_DEDUCTION'
  ) {
    throw new FundingWorkflowError(
      'FUNDING_MODE_INVALID',
      'funding mode must be ORG_PAYS or CHILD_DEDUCTION',
    );
  }
  if (typeof record.deductionAuthorised !== 'boolean') {
    throw new FundingWorkflowError('DEDUCTION_FLAG_INVALID');
  }
  if (
    typeof record.newVersionId !== 'string' ||
    record.newVersionId.trim() === ''
  ) {
    throw new FundingWorkflowError('NEW_VERSION_REQUIRED');
  }
  let effectiveFrom: string | undefined;
  if (typeof record.effectiveFrom === 'string') {
    effectiveFrom = record.effectiveFrom;
  } else if (record.effectiveFrom != null) {
    throw new FundingWorkflowError('EFFECTIVE_FROM_INVALID');
  }
  return {
    fundingMode: record.fundingMode,
    deductionAuthorised: record.deductionAuthorised,
    newVersionId: record.newVersionId,
    effectiveFrom,
  };
}

function parseAccrualBody(body: unknown): {
  versionId: string;
  event: {
    id: string;
    occurredAt: string;
    bases: Record<string, bigint>;
    assetCode: string;
  };
} {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw new FundingWorkflowError('ACCRUAL_BODY_INVALID');
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.versionId !== 'string' ||
    typeof record.eventId !== 'string'
  ) {
    throw new FundingWorkflowError('ACCRUAL_BODY_INVALID');
  }
  if (
    typeof record.occurredAt !== 'string' ||
    typeof record.assetCode !== 'string'
  ) {
    throw new FundingWorkflowError('ACCRUAL_BODY_INVALID');
  }
  if (
    record.bases == null ||
    typeof record.bases !== 'object' ||
    Array.isArray(record.bases)
  ) {
    throw new FundingWorkflowError('ACCRUAL_BODY_INVALID');
  }
  const bases: Record<string, bigint> = {};
  for (const [key, value] of Object.entries(record.bases)) {
    bases[key] = parseAtomic(value, key);
  }
  return {
    versionId: record.versionId,
    event: {
      id: record.eventId,
      occurredAt: record.occurredAt,
      bases,
      assetCode: record.assetCode,
    },
  };
}

function parseDisclosureBody(body: unknown): {
  id: string;
  childParticipantId: string;
  childAgreementVersionId: string;
  overrideAgreementVersionId: string;
  overrideTermId: string;
  disclosed: boolean;
  statementCode: string;
} {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw new FundingWorkflowError('DISCLOSURE_BODY_INVALID');
  }
  const record = body as Record<string, unknown>;
  for (const field of [
    'id',
    'childParticipantId',
    'childAgreementVersionId',
    'overrideAgreementVersionId',
    'overrideTermId',
    'statementCode',
  ] as const) {
    if (typeof record[field] !== 'string' || record[field].trim() === '') {
      throw new FundingWorkflowError('DISCLOSURE_BODY_INVALID');
    }
  }
  if (typeof record.disclosed !== 'boolean') {
    throw new FundingWorkflowError('DISCLOSURE_BODY_INVALID');
  }
  return {
    id: record.id as string,
    childParticipantId: record.childParticipantId as string,
    childAgreementVersionId: record.childAgreementVersionId as string,
    overrideAgreementVersionId: record.overrideAgreementVersionId as string,
    overrideTermId: record.overrideTermId as string,
    disclosed: record.disclosed,
    statementCode: record.statementCode as string,
  };
}

function parseAtomic(value: unknown, field: string): bigint {
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  throw new FundingWorkflowError(
    'ATOMIC_AMOUNT_INVALID',
    `${field} must be an integer atomic amount`,
  );
}
