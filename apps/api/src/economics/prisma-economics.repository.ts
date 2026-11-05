import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgreementBook } from './agreement-book';
import {
  type AccrueInput,
  type ConfigureFundingInput,
  type EconomicsRepository,
  type RecordDisclosureInput,
} from './economics.repository';
import { classifyBatch } from './obligation-ledger';
import type { PersistResult } from './obligation-ledger';
import { PrismaService } from '../prisma/prisma.service';
import { accrueEvent } from './rules-engine';
import {
  FundingWorkflowError,
  type Disclosure,
  type EconomicTerm,
  type FundingMode,
  type HoldReason,
  type ObligationDraft,
  type Purpose,
  type Tier,
} from './types';

@Injectable()
export class PrismaEconomicsRepository implements EconomicsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async proposeRelationship(input: {
    externalRef: string;
    organizationId: string;
    displayName: string;
    sourceSystem: string;
  }): Promise<{ id: string }> {
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('provvy.actor_kind', 'api_client', true)`;
      await tx.partnerRelationshipProposal.create({
        data: {
          id,
          organizationId: input.organizationId,
          externalRef: input.externalRef,
          displayName: input.displayName,
          sourceSystem: input.sourceSystem,
        },
      });
    });
    return { id };
  }

  async configureFunding(input: ConfigureFundingInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('provvy.actor_kind', 'internal', true)`;
      const version = await tx.agreementVersion.findUnique({
        where: { id: input.versionId },
        include: { terms: true },
      });
      if (!version) throw new FundingWorkflowError('VERSION_NOT_FOUND');
      const book = new AgreementBook();
      book.addVersion({
        id: version.id,
        agreementId: version.agreementId,
        versionNumber: version.versionNumber,
        status: version.status as 'DRAFT' | 'EXECUTED' | 'SUPERSEDED',
        effectiveFrom: version.effectiveFrom.toISOString(),
        stackingCapBps:
          version.stackingCapBps == null
            ? null
            : BigInt(version.stackingCapBps),
        terms: version.terms.map(mapTerm),
      });
      const result = book.configureFunding({
        ...input,
        now: new Date().toISOString(),
      });
      if (version.status === 'DRAFT') {
        await tx.agreementVersion.update({
          where: { id: version.id },
          data: { status: 'SUPERSEDED' },
        });
      }
      await tx.agreementVersion.create({
        data: {
          id: result.version.id,
          agreementId: result.version.agreementId,
          versionNumber: result.version.versionNumber,
          status: result.version.status,
          effectiveFrom: new Date(result.version.effectiveFrom),
          stackingCapBps:
            result.version.stackingCapBps == null
              ? null
              : Number(result.version.stackingCapBps),
        },
      });
      await tx.economicTerm.createMany({
        data: orderTerms(result.version.terms).map(termToRow),
      });
      await tx.fundingModeAudit.create({
        data: {
          id: result.audit.id,
          agreementVersionId: result.audit.agreementVersionId,
          economicTermId: result.audit.economicTermId,
          actorId: result.audit.actorId,
          actorKind: result.audit.actorKind,
          fundingMode: result.audit.fundingMode,
          deductionAuthorised: result.audit.deductionAuthorised,
        },
      });
      return result;
    });
  }

  async recordDisclosure(
    input: RecordDisclosureInput,
  ): Promise<{ id: string }> {
    if (input.actorKind !== 'internal') {
      throw new FundingWorkflowError('INTERNAL_ACTOR_REQUIRED');
    }
    if (input.statementCode.trim() === '') {
      throw new FundingWorkflowError('DISCLOSURE_STATEMENT_REQUIRED');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('provvy.actor_kind', 'internal', true)`;
      const childVersion = await tx.agreementVersion.findUnique({
        where: { id: input.childAgreementVersionId },
      });
      if (!childVersion || childVersion.status !== 'EXECUTED') {
        throw new FundingWorkflowError(
          'CHILD_AGREEMENT_NOT_EXECUTED',
          'disclosure requires an executed child agreement version',
        );
      }
      await tx.childDeductionDisclosure.create({
        data: {
          id: input.id,
          childParticipantId: input.childParticipantId,
          childAgreementVersionId: input.childAgreementVersionId,
          overrideAgreementVersionId: input.overrideAgreementVersionId,
          overrideTermId: input.overrideTermId,
          disclosed: input.disclosed,
          statementCode: input.statementCode,
          childAgreementExecuted: true,
        },
      });
    });
    return { id: input.id };
  }

  async accrue(input: AccrueInput): Promise<PersistResult> {
    if (input.actorKind !== 'internal') {
      throw new FundingWorkflowError('INTERNAL_ACTOR_REQUIRED');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('provvy.actor_kind', 'internal', true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.event.id}))`;
      const version = await tx.agreementVersion.findUnique({
        where: { id: input.versionId },
        include: { terms: true },
      });
      if (!version) throw new FundingWorkflowError('VERSION_NOT_FOUND');
      if (version.status !== 'EXECUTED') {
        throw new FundingWorkflowError('VERSION_NOT_EXECUTED');
      }
      const disclosureRows = await tx.childDeductionDisclosure.findMany({
        where: { overrideAgreementVersionId: version.id },
      });
      const disclosures: Disclosure[] = disclosureRows.map((row) => ({
        id: row.id,
        childParticipantId: row.childParticipantId,
        childAgreementVersionId: row.childAgreementVersionId,
        childAgreementExecuted: row.childAgreementExecuted,
        overrideAgreementVersionId: row.overrideAgreementVersionId,
        overrideTermId: row.overrideTermId,
        disclosed: row.disclosed,
        statementCode: row.statementCode,
      }));
      const result = accrueEvent({
        event: input.event,
        version: {
          id: version.id,
          stackingCapBps:
            version.stackingCapBps == null
              ? null
              : BigInt(version.stackingCapBps),
          terms: version.terms.map(mapTerm),
        },
        disclosures,
      });
      if (result.kind === 'rejected') {
        return {
          status: 'REJECTED_CONFIGURATION',
          obligations: [],
          detail: result.detail,
        };
      }
      if (result.kind === 'held') {
        const existing = await tx.accrualHold.findUnique({
          where: { sourceEventId: result.sourceEventId },
        });
        if (existing) {
          const review =
            existing.detail &&
            typeof existing.detail === 'object' &&
            !Array.isArray(existing.detail)
              ? Object.fromEntries(
                  Object.entries(
                    existing.detail as Record<string, unknown>,
                  ).map(([key, value]) => [key, String(value)]),
                )
              : {};
          return {
            status:
              existing.reason === result.reason
                ? 'IDEMPOTENT'
                : 'REJECTED_DUPLICATE',
            guard:
              existing.reason === result.reason ? undefined : 'EVENT_DECISION',
            obligations: [],
            hold: {
              sourceEventId: existing.sourceEventId,
              reason: existing.reason as HoldReason,
              agreementVersionId: existing.agreementVersionId ?? version.id,
              financialEffect: 'NONE',
              eventBaseCapAtomic: existing.eventBaseCapAtomic,
              eventBaseLimitAtomic: existing.eventBaseLimitAtomic,
              review,
            },
          };
        }
        await tx.accrualHold.create({
          data: {
            id: randomUUID(),
            sourceEventId: result.sourceEventId,
            reason: result.reason,
            agreementVersionId: result.agreementVersionId,
            financialEffect: 'NONE',
            eventBaseCapAtomic: result.eventBaseCapAtomic,
            eventBaseLimitAtomic: result.eventBaseLimitAtomic,
            detail: result.review,
          },
        });
        return { status: 'CREATED', obligations: [], hold: result };
      }

      const existingRows = await tx.obligation.findMany({
        where: { sourceEventId: input.event.id },
      });
      const existing = existingRows.map(mapObligation);
      if (existing.length === 0) {
        await tx.obligation.createMany({
          data: result.obligations.map((row) =>
            obligationToRow(row, randomUUID()),
          ),
        });
        return { status: 'CREATED', obligations: result.obligations };
      }
      const verdict = classifyBatch(existing, result.obligations);
      if (verdict.identical) {
        return { status: 'IDEMPOTENT', obligations: existing };
      }
      return {
        status: 'REJECTED_DUPLICATE',
        guard: verdict.reject ?? 'D3',
        obligations: existing,
        detail: 'obligation guard rejected a second financial row',
      };
    });
  }
}

function mapTerm(row: {
  id: string;
  agreementVersionId: string;
  beneficiaryId: string;
  purpose: string;
  basis: string;
  baseKey: string;
  shareBps: number | null;
  fixedAmountAtomic: bigint | null;
  fixedIndependentOfBase: boolean;
  overrideBps: number | null;
  childTermId: string | null;
  tierMode: string | null;
  tiers: Prisma.JsonValue;
  fundingMode: string;
  deductionAuthorised: boolean;
  stackingCapAtomic: bigint | null;
  obligationEligible: boolean;
  commissionStructureId: string;
  triggerType: string;
}): EconomicTerm {
  return {
    id: row.id,
    agreementVersionId: row.agreementVersionId,
    beneficiaryId: row.beneficiaryId,
    purpose: row.purpose as Purpose,
    basis: row.basis as EconomicTerm['basis'],
    baseKey: row.baseKey,
    shareBps: row.shareBps == null ? undefined : BigInt(row.shareBps),
    fixedAmountAtomic: row.fixedAmountAtomic ?? undefined,
    fixedIndependentOfBase: row.fixedIndependentOfBase,
    overrideBps: row.overrideBps == null ? undefined : BigInt(row.overrideBps),
    childTermId: row.childTermId ?? undefined,
    tierMode:
      row.tierMode === 'WHOLE' || row.tierMode === 'MARGINAL'
        ? row.tierMode
        : undefined,
    tiers: parseTiers(row.tiers),
    fundingMode: row.fundingMode as FundingMode,
    deductionAuthorised: row.deductionAuthorised,
    stackingCapAtomic: row.stackingCapAtomic ?? undefined,
    obligationEligible: row.obligationEligible,
    commissionStructureId: row.commissionStructureId,
    triggerType: row.triggerType,
  };
}

function termToRow(term: EconomicTerm): Prisma.EconomicTermCreateManyInput {
  return {
    id: term.id,
    agreementVersionId: term.agreementVersionId,
    beneficiaryId: term.beneficiaryId,
    purpose: term.purpose,
    basis: term.basis,
    baseKey: term.baseKey,
    shareBps: term.shareBps == null ? null : Number(term.shareBps),
    fixedAmountAtomic: term.fixedAmountAtomic ?? null,
    fixedIndependentOfBase: term.fixedIndependentOfBase ?? false,
    overrideBps: term.overrideBps == null ? null : Number(term.overrideBps),
    childTermId: term.childTermId ?? null,
    tierMode: term.tierMode ?? null,
    tiers: tiersToJson(term.tiers),
    fundingMode: term.fundingMode ?? 'ORG_PAYS',
    deductionAuthorised: term.deductionAuthorised === true,
    stackingCapAtomic: term.stackingCapAtomic ?? null,
    obligationEligible: term.obligationEligible,
    commissionStructureId: term.commissionStructureId,
    triggerType: term.triggerType,
  };
}

function obligationToRow(
  row: ObligationDraft,
  id: string,
): Prisma.ObligationCreateManyInput {
  return {
    id,
    sourceEventId: row.sourceEventId,
    beneficiaryId: row.beneficiaryId,
    purpose: row.purpose,
    amountAtomic: row.amountAtomic,
    grossCommissionAtomic: row.grossCommissionAtomic,
    overrideAmountAtomic: row.overrideAmountAtomic,
    fundingMode: row.fundingMode,
    agreementVersionId: row.agreementVersionId,
    economicTermId: row.economicTermId,
    commissionStructureId: row.commissionStructureId,
    assetCode: row.assetCode,
    childAgreementVersionId: row.childAgreementVersionId,
    disclosureId: row.disclosureId,
    splitGroupId: row.splitGroupId,
  };
}

function mapObligation(row: {
  sourceEventId: string;
  beneficiaryId: string;
  purpose: string;
  amountAtomic: bigint;
  grossCommissionAtomic: bigint;
  overrideAmountAtomic: bigint;
  fundingMode: string;
  agreementVersionId: string;
  economicTermId: string;
  commissionStructureId: string;
  assetCode: string;
  childAgreementVersionId: string | null;
  disclosureId: string | null;
  splitGroupId: string;
}): ObligationDraft {
  return {
    sourceEventId: row.sourceEventId,
    beneficiaryId: row.beneficiaryId,
    purpose: row.purpose as Purpose,
    amountAtomic: row.amountAtomic,
    grossCommissionAtomic: row.grossCommissionAtomic,
    overrideAmountAtomic: row.overrideAmountAtomic,
    fundingMode: row.fundingMode as FundingMode,
    agreementVersionId: row.agreementVersionId,
    economicTermId: row.economicTermId,
    commissionStructureId: row.commissionStructureId,
    assetCode: row.assetCode,
    childAgreementVersionId: row.childAgreementVersionId,
    disclosureId: row.disclosureId,
    splitGroupId: row.splitGroupId,
  };
}

function orderTerms(terms: EconomicTerm[]): EconomicTerm[] {
  const pending = [...terms];
  const ready: EconomicTerm[] = [];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const index = pending.findIndex(
      (term) => term.childTermId == null || seen.has(term.childTermId),
    );
    if (index < 0) {
      throw new FundingWorkflowError('TERM_CYCLE');
    }
    const [next] = pending.splice(index, 1);
    ready.push(next);
    seen.add(next.id);
  }
  return ready;
}

function tiersToJson(
  tiers: Tier[] | undefined,
): Prisma.InputJsonValue | undefined {
  if (!tiers) return undefined;
  return tiers.map((tier) => ({
    lower: tier.lower.toString(),
    upper: tier.upper == null ? null : tier.upper.toString(),
    rateBps: tier.rateBps.toString(),
  }));
}

function parseTiers(value: Prisma.JsonValue): Tier[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => {
    const row = entry as {
      lower: string;
      upper: string | null;
      rateBps: string;
    };
    return {
      lower: BigInt(row.lower),
      upper: row.upper == null ? null : BigInt(row.upper),
      rateBps: BigInt(row.rateBps),
    };
  });
}
