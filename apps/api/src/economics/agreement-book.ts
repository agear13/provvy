import { accrueEvent } from './rules-engine';
import { ObligationLedger, type PersistResult } from './obligation-ledger';
import {
  FundingWorkflowError,
  type AccrualEvent,
  type Disclosure,
  type EconomicTerm,
  type FundingMode,
} from './types';

export interface StoredVersion {
  id: string;
  agreementId: string;
  versionNumber: number;
  status: 'DRAFT' | 'EXECUTED' | 'SUPERSEDED';
  effectiveFrom: string;
  stackingCapBps?: bigint | null;
  terms: EconomicTerm[];
}

export interface FundingAudit {
  id: string;
  agreementVersionId: string;
  economicTermId: string;
  actorId: string;
  actorKind: 'internal';
  fundingMode: FundingMode;
  deductionAuthorised: boolean;
  createdAt: string;
}

export interface ConfigureFundingCommand {
  actorKind: string;
  actorId: string;
  versionId: string;
  termId: string;
  fundingMode: FundingMode;
  deductionAuthorised: boolean;
  newVersionId: string;
  now: string;
  effectiveFrom?: string;
}

/**
 * Versioned agreements plus the ledger. Executed versions are copied
 * forward; their term rows and any posted obligations are not edited.
 */
export class AgreementBook {
  readonly versions: StoredVersion[] = [];
  readonly disclosures: Disclosure[] = [];
  readonly audits: FundingAudit[] = [];
  readonly ledger = new ObligationLedger();

  addVersion(version: StoredVersion): void {
    this.versions.push(structuredClone(version));
  }

  addDisclosure(disclosure: Disclosure): void {
    this.disclosures.push(structuredClone(disclosure));
  }

  getVersion(id: string): StoredVersion | undefined {
    const found = this.versions.find((row) => row.id === id);
    return found ? structuredClone(found) : undefined;
  }

  selectExecuted(
    agreementId: string,
    occurredAt: string,
  ): StoredVersion | undefined {
    const matches = this.versions
      .filter(
        (row) =>
          row.agreementId === agreementId &&
          row.status === 'EXECUTED' &&
          row.effectiveFrom <= occurredAt,
      )
      .sort((a, b) => b.versionNumber - a.versionNumber);
    return matches[0] ? structuredClone(matches[0]) : undefined;
  }

  /**
   * Funding changes always append a new version. The source version's
   * economic fields stay as they were. Drafts may be marked superseded;
   * executed versions are not modified at all.
   */
  configureFunding(command: ConfigureFundingCommand): {
    version: StoredVersion;
    audit: FundingAudit;
  } {
    if (command.actorKind !== 'internal' || command.actorId.trim() === '') {
      throw new FundingWorkflowError(
        'INTERNAL_ACTOR_REQUIRED',
        'only an internal workflow can set funding mode',
      );
    }
    if (
      command.fundingMode !== 'ORG_PAYS' &&
      command.fundingMode !== 'CHILD_DEDUCTION'
    ) {
      throw new FundingWorkflowError('FUNDING_MODE_INVALID');
    }
    if (
      command.fundingMode === 'CHILD_DEDUCTION' &&
      command.deductionAuthorised !== true
    ) {
      throw new FundingWorkflowError(
        'DEDUCTION_NOT_AUTHORISED',
        'CHILD_DEDUCTION requires explicit authorisation on the new version',
      );
    }
    if (
      command.fundingMode === 'ORG_PAYS' &&
      command.deductionAuthorised === true
    ) {
      throw new FundingWorkflowError(
        'AMBIGUOUS_FUNDING',
        'ORG_PAYS cannot be stored together with deduction authorisation',
      );
    }

    const index = this.versions.findIndex(
      (row) => row.id === command.versionId,
    );
    if (index < 0) throw new FundingWorkflowError('VERSION_NOT_FOUND');
    const source = this.versions[index];
    if (source.status === 'SUPERSEDED') {
      throw new FundingWorkflowError('VERSION_NOT_CURRENT');
    }

    const sourceTerm = source.terms.find((row) => row.id === command.termId);
    if (!sourceTerm) throw new FundingWorkflowError('TERM_NOT_FOUND');
    if (sourceTerm.basis !== 'OVERRIDE') {
      throw new FundingWorkflowError('FUNDING_MODE_IS_FOR_OVERRIDES');
    }

    const next = cloneVersion(source, command.newVersionId);
    if (command.effectiveFrom) {
      next.version.effectiveFrom = command.effectiveFrom;
    }
    const clonedTerm = next.terms.find(
      (row) => row.economicTermIdOrigin === command.termId,
    );
    if (!clonedTerm) throw new FundingWorkflowError('TERM_NOT_FOUND');
    clonedTerm.term.fundingMode = command.fundingMode;
    clonedTerm.term.deductionAuthorised = command.deductionAuthorised;

    if (source.status === 'DRAFT') {
      source.status = 'SUPERSEDED';
    }

    this.versions.push(next.version);
    const audit: FundingAudit = {
      id: `audit:${command.newVersionId}:${command.termId}`,
      agreementVersionId: next.version.id,
      economicTermId: clonedTerm.term.id,
      actorId: command.actorId,
      actorKind: 'internal',
      fundingMode: command.fundingMode,
      deductionAuthorised: command.deductionAuthorised,
      createdAt: command.now,
    };
    this.audits.push(audit);
    return {
      version: structuredClone(next.version),
      audit: structuredClone(audit),
    };
  }

  execute(versionId: string): StoredVersion {
    const version = this.versions.find((row) => row.id === versionId);
    if (!version) throw new FundingWorkflowError('VERSION_NOT_FOUND');
    if (version.status !== 'DRAFT') {
      throw new FundingWorkflowError('ONLY_DRAFT_CAN_EXECUTE');
    }
    for (const term of version.terms) {
      if (
        term.fundingMode === 'CHILD_DEDUCTION' &&
        term.deductionAuthorised !== true
      ) {
        throw new FundingWorkflowError('DEDUCTION_NOT_AUTHORISED');
      }
    }
    version.status = 'EXECUTED';
    return structuredClone(version);
  }

  async accrue(event: AccrualEvent, versionId: string): Promise<PersistResult> {
    const version = this.versions.find((row) => row.id === versionId);
    if (!version) throw new FundingWorkflowError('VERSION_NOT_FOUND');
    if (version.status !== 'EXECUTED') {
      throw new FundingWorkflowError('VERSION_NOT_EXECUTED');
    }
    const result = accrueEvent({
      event,
      version: {
        id: version.id,
        stackingCapBps: version.stackingCapBps,
        terms: version.terms,
      },
      disclosures: this.disclosures,
    });
    return this.ledger.persist(result);
  }
}

function cloneVersion(
  source: StoredVersion,
  newVersionId: string,
): {
  version: StoredVersion;
  terms: { term: EconomicTerm; economicTermIdOrigin: string }[];
} {
  const idMap = new Map<string, string>();
  for (const term of source.terms) {
    idMap.set(term.id, `${newVersionId}:${term.id}`);
  }
  const linked: { term: EconomicTerm; economicTermIdOrigin: string }[] = [];
  const terms = source.terms.map((term) => {
    const cloned = structuredClone(term);
    const origin = term.id;
    cloned.id = idMap.get(term.id) as string;
    cloned.agreementVersionId = newVersionId;
    cloned.commissionStructureId = newVersionId;
    if (cloned.childTermId) {
      cloned.childTermId = idMap.get(cloned.childTermId) ?? cloned.childTermId;
    }
    linked.push({ term: cloned, economicTermIdOrigin: origin });
    return cloned;
  });
  return {
    version: {
      id: newVersionId,
      agreementId: source.agreementId,
      versionNumber: source.versionNumber + 1,
      status: 'DRAFT',
      effectiveFrom: source.effectiveFrom,
      stackingCapBps: source.stackingCapBps ?? null,
      terms,
    },
    terms: linked,
  };
}
