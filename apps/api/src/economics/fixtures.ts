import type {
  AccrualEvent,
  AgreementVersionTerms,
  Disclosure,
  EconomicTerm,
} from './types';

export function n(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

export function term(
  partial: Partial<EconomicTerm> &
    Pick<EconomicTerm, 'id' | 'beneficiaryId' | 'basis' | 'purpose'>,
): EconomicTerm {
  const agreementVersionId = partial.agreementVersionId ?? 'v1';
  return {
    baseKey: 'EVENT',
    obligationEligible: true,
    triggerType: 'SALE',
    fundingMode: null,
    deductionAuthorised: null,
    ...partial,
    agreementVersionId,
    commissionStructureId: partial.commissionStructureId ?? agreementVersionId,
  };
}

export function version(
  id: string,
  terms: EconomicTerm[],
  stackingCapBps?: bigint,
): AgreementVersionTerms {
  return { id, terms, stackingCapBps: stackingCapBps ?? null };
}

export function event(
  id: string,
  bases: Record<string, number | bigint>,
  occurredAt = '2026-02-01T00:00:00.000Z',
): AccrualEvent {
  const mapped: Record<string, bigint> = {};
  for (const [key, value] of Object.entries(bases)) {
    mapped[key] = n(value);
  }
  return { id, occurredAt, assetCode: 'USD', bases: mapped };
}

export function disclosure(
  partial: Partial<Disclosure> & Pick<Disclosure, 'overrideTermId'>,
): Disclosure {
  return {
    id: partial.id ?? `disc:${partial.overrideTermId}`,
    childParticipantId: partial.childParticipantId ?? 'rep',
    childAgreementVersionId: partial.childAgreementVersionId ?? 'child-v1',
    childAgreementExecuted: partial.childAgreementExecuted ?? true,
    overrideAgreementVersionId: partial.overrideAgreementVersionId ?? 'v1',
    overrideTermId: partial.overrideTermId,
    disclosed: partial.disclosed ?? true,
    statementCode: partial.statementCode ?? 'CHILD-DEDUCTION-DISCLOSED',
  };
}
