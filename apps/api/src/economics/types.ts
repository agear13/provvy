export const FUNDING_MODES = ['ORG_PAYS', 'CHILD_DEDUCTION'] as const;
export type FundingMode = (typeof FUNDING_MODES)[number];

export const BASES = [
  'SHARE_BPS',
  'FIXED_ATOMIC',
  'TIERED',
  'OVERRIDE',
] as const;
export type Basis = (typeof BASES)[number];

export const PURPOSES = [
  'COMMISSION',
  'OVERRIDE',
  'REFERRAL',
  'RETAINER',
  'BONUS',
] as const;
export type Purpose = (typeof PURPOSES)[number];

export const HOLD_REASONS = [
  'CAP_EXCEEDED',
  'EXCEEDS_BASE',
  'STACKING_CAP',
  'FUNDING_AUTHORISATION',
  'DISCLOSURE_MISSING',
  'AMBIGUOUS_FUNDING',
  'NEGATIVE_NET',
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export type RejectionCode =
  | 'INVALID_CONFIGURATION'
  | 'CAP_PROVABLY_OVER'
  | 'STACKING_PROVABLY_OVER';

/** Authoritative obligation guard (§42). Funding mode and agreement version are not part of it. */
export const D3_OBLIGATION_KEY = [
  'sourceEventId',
  'beneficiaryId',
  'purpose',
] as const;

/** Legacy retry key only. A different commission structure must not slip past D3. */
export const RETRY_IDEMPOTENCY_KEY = [
  'sourceEventId',
  'commissionStructureId',
  'beneficiaryId',
] as const;

export interface Tier {
  lower: bigint;
  upper: bigint | null;
  rateBps: bigint;
}

export interface EconomicTerm {
  id: string;
  agreementVersionId: string;
  beneficiaryId: string;
  purpose: Purpose;
  basis: Basis;
  baseKey: string;
  shareBps?: bigint;
  fixedAmountAtomic?: bigint;
  fixedIndependentOfBase?: boolean;
  overrideBps?: bigint;
  childTermId?: string;
  tiers?: Tier[];
  tierMode?: 'MARGINAL' | 'WHOLE';
  /**
   * Null means the default, ORG_PAYS. CHILD_DEDUCTION is never inferred.
   * An unrecognised value is ambiguous and must hold.
   */
  fundingMode?: FundingMode | null;
  deductionAuthorised?: boolean | null;
  stackingCapAtomic?: bigint | null;
  obligationEligible: boolean;
  commissionStructureId: string;
  triggerType: string;
}

export interface Disclosure {
  id: string;
  childParticipantId: string;
  childAgreementVersionId: string;
  childAgreementExecuted: boolean;
  overrideAgreementVersionId: string;
  overrideTermId: string;
  disclosed: boolean;
  statementCode: string;
}

export interface AccrualEvent {
  id: string;
  occurredAt: string;
  bases: Record<string, bigint>;
  assetCode: string;
}

export interface AgreementVersionTerms {
  id: string;
  stackingCapBps?: bigint | null;
  terms: EconomicTerm[];
}

export interface ObligationDraft {
  sourceEventId: string;
  beneficiaryId: string;
  purpose: Purpose;
  amountAtomic: bigint;
  grossCommissionAtomic: bigint;
  overrideAmountAtomic: bigint;
  fundingMode: FundingMode;
  agreementVersionId: string;
  economicTermId: string;
  commissionStructureId: string;
  assetCode: string;
  childAgreementVersionId: string | null;
  disclosureId: string | null;
  splitGroupId: string;
}

export interface HoldDraft {
  sourceEventId: string;
  reason: HoldReason;
  agreementVersionId: string;
  financialEffect: 'NONE';
  eventBaseCapAtomic: bigint | null;
  eventBaseLimitAtomic: bigint | null;
  /** Review context only. Never a receivable and never a posted amount. */
  review: Record<string, string>;
}

export type EngineResult =
  | { kind: 'rejected'; code: RejectionCode; detail: string }
  | ({ kind: 'held' } & HoldDraft)
  | {
      kind: 'accrued';
      obligations: ObligationDraft[];
      eventBaseCapAtomic: bigint;
      eventBaseLimitAtomic: bigint;
    };

export class PartnerFundingForbiddenError extends Error {
  readonly code = 'PARTNER_CANNOT_SET_FUNDING_MODE' as const;
  constructor(readonly field: string) {
    super(`partner API cannot set or change funding mode (${field})`);
    this.name = 'PartnerFundingForbiddenError';
  }
}

export class PartnerWriteError extends Error {
  readonly code = 'PARTNER_WRITE_REJECTED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'PartnerWriteError';
  }
}

export class FundingWorkflowError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'FundingWorkflowError';
  }
}
