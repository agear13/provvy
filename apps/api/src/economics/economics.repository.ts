import type { PartnerProposeRelationship } from './partner-write-schema';
import type { PersistResult } from './obligation-ledger';
import type { FundingAudit, StoredVersion } from './agreement-book';
import type { AccrualEvent, FundingMode } from './types';

export const ECONOMICS_REPOSITORY = Symbol('ECONOMICS_REPOSITORY');

export interface ConfigureFundingInput {
  actorKind: string;
  actorId: string;
  versionId: string;
  termId: string;
  fundingMode: FundingMode;
  deductionAuthorised: boolean;
  newVersionId: string;
  effectiveFrom?: string;
}

export interface AccrueInput {
  actorKind: string;
  versionId: string;
  event: AccrualEvent;
}

export interface RecordDisclosureInput {
  actorKind: string;
  id: string;
  childParticipantId: string;
  childAgreementVersionId: string;
  overrideAgreementVersionId: string;
  overrideTermId: string;
  disclosed: boolean;
  statementCode: string;
}

export interface EconomicsRepository {
  proposeRelationship(
    input: PartnerProposeRelationship & { sourceSystem: string },
  ): Promise<{ id: string }>;
  configureFunding(
    input: ConfigureFundingInput,
  ): Promise<{ version: StoredVersion; audit: FundingAudit }>;
  accrue(input: AccrueInput): Promise<PersistResult>;
  recordDisclosure(input: RecordDisclosureInput): Promise<{ id: string }>;
}
