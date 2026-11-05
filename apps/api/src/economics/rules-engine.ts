import { mulBpsHalfEven } from './money';
import {
  type AccrualEvent,
  type AgreementVersionTerms,
  type Basis,
  type Disclosure,
  type EconomicTerm,
  type EngineResult,
  type FundingMode,
  type HoldReason,
  type ObligationDraft,
  type Purpose,
  type RejectionCode,
  type Tier,
} from './types';

const EVENT_BASE = 'EVENT';
const CAP_BPS = 10000n;

interface Calculated {
  term: EconomicTerm;
  calculatedAtomic: bigint;
  countsTowardEventBase: boolean;
}

interface ResolvedOverride {
  line: Calculated;
  child: Calculated;
  mode: FundingMode | 'HOLD';
  holdReason?: HoldReason;
  holdDetail?: string;
  disclosure?: Disclosure;
}

/**
 * The only calculator. Funding allocation is a step after rounded amounts
 * and before the event-base cap. It does not re-round and it does not
 * maintain a second rate table.
 */
export function activateTerms(
  version: AgreementVersionTerms,
): { ok: true } | { ok: false; code: RejectionCode; detail: string } {
  const terms = version.terms;
  const seenPurpose = new Set<string>();

  for (const term of terms) {
    if (term.obligationEligible !== true) {
      return reject(
        'INVALID_CONFIGURATION',
        `${term.id} is not obligation eligible`,
      );
    }
    const purposeKey = `${term.beneficiaryId}|${term.purpose}|${term.triggerType}`;
    if (seenPurpose.has(purposeKey)) {
      return reject(
        'INVALID_CONFIGURATION',
        `duplicate entitlement ${purposeKey}`,
      );
    }
    seenPurpose.add(purposeKey);

    const bpsError = validateBps(term);
    if (bpsError) return reject('INVALID_CONFIGURATION', bpsError);

    if (term.basis === 'OVERRIDE') {
      const overrideError = validateOverride(term, terms);
      if (overrideError) return reject('INVALID_CONFIGURATION', overrideError);
    }
    if (term.basis === 'TIERED') {
      const tierError = validateTiers(term);
      if (tierError) return reject('INVALID_CONFIGURATION', tierError);
    }
    if (term.basis === 'FIXED_ATOMIC' && term.fixedAmountAtomic == null) {
      return reject('INVALID_CONFIGURATION', `${term.id} missing fixed amount`);
    }
    if (
      (term.basis === 'SHARE_BPS' || term.basis === 'TIERED') &&
      !term.baseKey
    ) {
      return reject('INVALID_CONFIGURATION', `${term.id} missing base`);
    }
  }

  const stacking = provableStacking(terms);
  if (stacking) return reject('STACKING_PROVABLY_OVER', stacking);

  const cap = provableEventCap(version);
  if (cap) return reject('CAP_PROVABLY_OVER', cap);

  return { ok: true };
}

export function accrueEvent(input: {
  event: AccrualEvent;
  version: AgreementVersionTerms;
  disclosures: readonly Disclosure[];
}): EngineResult {
  const activation = activateTerms(input.version);
  if (!activation.ok) {
    return {
      kind: 'rejected',
      code: activation.code,
      detail: activation.detail,
    };
  }

  const eventBase = input.event.bases[EVENT_BASE];
  if (eventBase == null || eventBase < 0n) {
    return {
      kind: 'rejected',
      code: 'INVALID_CONFIGURATION',
      detail: 'event base is required',
    };
  }

  let calculated: Calculated[];
  try {
    calculated = calculateLines(input.version.terms, input.event);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'calculation failed';
    return { kind: 'rejected', code: 'INVALID_CONFIGURATION', detail: message };
  }

  const nonOverrides = calculated.filter(
    (line) => line.term.basis !== 'OVERRIDE',
  );
  const overrideLines = calculated.filter(
    (line) => line.term.basis === 'OVERRIDE',
  );
  const resolved = overrideLines.map((line) =>
    resolveOverride(line, calculated, input.disclosures),
  );

  const fundingHold = pickFundingHold(resolved);
  if (fundingHold) {
    return hold(input, fundingHold.reason, null, null, {
      detail: fundingHold.detail,
      termId: fundingHold.termId,
      postedObligations: '0',
      receivableCreated: 'false',
    });
  }

  const deductedByChild = new Map<string, bigint>();
  for (const row of resolved) {
    if (row.mode !== 'CHILD_DEDUCTION') continue;
    const childId = row.child.term.id;
    deductedByChild.set(
      childId,
      (deductedByChild.get(childId) ?? 0n) + row.line.calculatedAtomic,
    );
  }

  for (const child of nonOverrides) {
    const deducted = deductedByChild.get(child.term.id) ?? 0n;
    if (deducted > child.calculatedAtomic) {
      return hold(input, 'NEGATIVE_NET', null, null, {
        childTermId: child.term.id,
        childCommissionAtomic: child.calculatedAtomic.toString(),
        deductedAtomic: deducted.toString(),
        netAtomic: (child.calculatedAtomic - deducted).toString(),
        postedObligations: '0',
        receivableCreated: 'false',
        clamped: 'false',
      });
    }
  }

  const payeeOf = new Map<string, bigint>();
  for (const child of nonOverrides) {
    const deducted = deductedByChild.get(child.term.id) ?? 0n;
    payeeOf.set(child.term.id, child.calculatedAtomic - deducted);
  }
  for (const row of resolved) {
    payeeOf.set(row.line.term.id, row.line.calculatedAtomic);
  }

  const fixedTowardBase = nonOverrides
    .filter(
      (line) =>
        line.term.basis === 'FIXED_ATOMIC' &&
        line.term.fixedIndependentOfBase !== true,
    )
    .reduce((sum, line) => sum + line.calculatedAtomic, 0n);
  if (fixedTowardBase > eventBase) {
    return hold(input, 'EXCEEDS_BASE', null, eventBase, {
      fixedSumAtomic: fixedTowardBase.toString(),
      postedObligations: '0',
      receivableCreated: 'false',
    });
  }

  for (const child of nonOverrides) {
    if (child.term.stackingCapAtomic == null) continue;
    const overrideSum = resolved
      .filter((row) => row.child.term.id === child.term.id)
      .reduce((sum, row) => sum + row.line.calculatedAtomic, 0n);
    const stackingTotal = child.calculatedAtomic + overrideSum;
    if (stackingTotal > child.term.stackingCapAtomic) {
      return hold(input, 'STACKING_CAP', null, eventBase, {
        termId: child.term.id,
        stackingTotalAtomic: stackingTotal.toString(),
        stackingCapAtomic: child.term.stackingCapAtomic.toString(),
        postedObligations: '0',
        receivableCreated: 'false',
        prorated: 'false',
      });
    }
  }

  const eventBaseCapAtomic = calculated.reduce((sum, line) => {
    if (!line.countsTowardEventBase) return sum;
    return sum + (payeeOf.get(line.term.id) ?? 0n);
  }, 0n);
  const eventBaseLimitAtomic = eventLimit(
    eventBase,
    input.version.stackingCapBps,
  );
  if (eventBaseCapAtomic > eventBaseLimitAtomic) {
    return hold(
      input,
      'CAP_EXCEEDED',
      eventBaseCapAtomic,
      eventBaseLimitAtomic,
      {
        postedObligations: '0',
        receivableCreated: 'false',
        prorated: 'false',
        partialPayment: 'false',
      },
    );
  }

  const obligations = buildObligations({
    event: input.event,
    versionId: input.version.id,
    nonOverrides,
    resolved,
    payeeOf,
    deductedByChild,
  });

  return {
    kind: 'accrued',
    obligations,
    eventBaseCapAtomic,
    eventBaseLimitAtomic,
  };
}

function buildObligations(input: {
  event: AccrualEvent;
  versionId: string;
  nonOverrides: Calculated[];
  resolved: ResolvedOverride[];
  payeeOf: Map<string, bigint>;
  deductedByChild: Map<string, bigint>;
}): ObligationDraft[] {
  const drafts: ObligationDraft[] = [];
  for (const child of input.nonOverrides) {
    const related = input.resolved.filter(
      (row) => row.child.term.id === child.term.id,
    );
    const deduction = related.find((row) => row.mode === 'CHILD_DEDUCTION');
    const mode: FundingMode = deduction ? 'CHILD_DEDUCTION' : 'ORG_PAYS';
    drafts.push({
      sourceEventId: input.event.id,
      beneficiaryId: child.term.beneficiaryId,
      purpose: child.term.purpose,
      amountAtomic: input.payeeOf.get(child.term.id) ?? 0n,
      grossCommissionAtomic: child.calculatedAtomic,
      overrideAmountAtomic: related.reduce(
        (sum, row) => sum + row.line.calculatedAtomic,
        0n,
      ),
      fundingMode: mode,
      agreementVersionId: child.term.agreementVersionId,
      economicTermId: child.term.id,
      commissionStructureId: child.term.commissionStructureId,
      assetCode: input.event.assetCode,
      childAgreementVersionId:
        deduction?.disclosure?.childAgreementVersionId ?? null,
      disclosureId: deduction?.disclosure?.id ?? null,
      splitGroupId: input.event.id,
    });
  }

  for (const row of input.resolved) {
    const mode =
      row.mode === 'CHILD_DEDUCTION' ? 'CHILD_DEDUCTION' : 'ORG_PAYS';
    drafts.push({
      sourceEventId: input.event.id,
      beneficiaryId: row.line.term.beneficiaryId,
      purpose: row.line.term.purpose,
      amountAtomic: row.line.calculatedAtomic,
      grossCommissionAtomic: row.child.calculatedAtomic,
      overrideAmountAtomic: row.line.calculatedAtomic,
      fundingMode: mode,
      agreementVersionId: row.line.term.agreementVersionId,
      economicTermId: row.line.term.id,
      commissionStructureId: row.line.term.commissionStructureId,
      assetCode: input.event.assetCode,
      childAgreementVersionId:
        mode === 'CHILD_DEDUCTION'
          ? (row.disclosure?.childAgreementVersionId ?? null)
          : null,
      disclosureId:
        mode === 'CHILD_DEDUCTION' ? (row.disclosure?.id ?? null) : null,
      splitGroupId: input.event.id,
    });
  }

  return drafts.sort((a, b) => {
    if (a.beneficiaryId !== b.beneficiaryId) {
      return a.beneficiaryId < b.beneficiaryId ? -1 : 1;
    }
    return a.purpose < b.purpose ? -1 : a.purpose > b.purpose ? 1 : 0;
  });
}

function resolveOverride(
  line: Calculated,
  lines: Calculated[],
  disclosures: readonly Disclosure[],
): ResolvedOverride {
  const child = lines.find((row) => row.term.id === line.term.childTermId);
  if (!child) {
    return {
      line,
      child: line,
      mode: 'HOLD',
      holdReason: 'AMBIGUOUS_FUNDING',
      holdDetail: 'override child missing at accrual',
    };
  }

  const rawMode = line.term.fundingMode;
  const authorised = line.term.deductionAuthorised === true;
  if (
    rawMode != null &&
    rawMode !== 'ORG_PAYS' &&
    rawMode !== 'CHILD_DEDUCTION'
  ) {
    return {
      line,
      child,
      mode: 'HOLD',
      holdReason: 'AMBIGUOUS_FUNDING',
      holdDetail: 'unrecognised funding mode',
    };
  }
  const mode: FundingMode = rawMode ?? 'ORG_PAYS';
  if (mode === 'ORG_PAYS') {
    if (authorised) {
      return {
        line,
        child,
        mode: 'HOLD',
        holdReason: 'AMBIGUOUS_FUNDING',
        holdDetail: 'deduction authorised while mode is ORG_PAYS',
      };
    }
    return { line, child, mode: 'ORG_PAYS' };
  }

  if (line.term.deductionAuthorised !== true) {
    return {
      line,
      child,
      mode: 'HOLD',
      holdReason: 'FUNDING_AUTHORISATION',
      holdDetail: 'missing explicit agreement authorisation',
    };
  }

  const matches = disclosures.filter(
    (row) =>
      row.overrideTermId === line.term.id &&
      row.overrideAgreementVersionId === line.term.agreementVersionId &&
      row.childParticipantId === child.term.beneficiaryId,
  );
  if (matches.length === 0) {
    return {
      line,
      child,
      mode: 'HOLD',
      holdReason: 'DISCLOSURE_MISSING',
      holdDetail: 'child agreement disclosure required',
    };
  }
  if (matches.length > 1) {
    return {
      line,
      child,
      mode: 'HOLD',
      holdReason: 'AMBIGUOUS_FUNDING',
      holdDetail: 'multiple child agreement disclosures',
    };
  }
  const disclosure = matches[0];
  if (
    disclosure.disclosed !== true ||
    disclosure.statementCode.trim() === '' ||
    disclosure.childAgreementExecuted !== true ||
    disclosure.childAgreementVersionId.trim() === ''
  ) {
    return {
      line,
      child,
      mode: 'HOLD',
      holdReason: 'DISCLOSURE_MISSING',
      holdDetail: 'child agreement disclosure is not affirmative and executed',
    };
  }
  return { line, child, mode: 'CHILD_DEDUCTION', disclosure };
}

function pickFundingHold(
  resolved: ResolvedOverride[],
): { reason: HoldReason; detail: string; termId: string } | null {
  const rank: HoldReason[] = [
    'AMBIGUOUS_FUNDING',
    'FUNDING_AUTHORISATION',
    'DISCLOSURE_MISSING',
  ];
  const holds = resolved.filter((row) => row.mode === 'HOLD');
  if (holds.length === 0) return null;
  holds.sort((a, b) => {
    const ar = rank.indexOf(a.holdReason ?? 'AMBIGUOUS_FUNDING');
    const br = rank.indexOf(b.holdReason ?? 'AMBIGUOUS_FUNDING');
    if (ar !== br) return ar - br;
    return a.line.term.id < b.line.term.id ? -1 : 1;
  });
  const first = holds[0];
  return {
    reason: first.holdReason ?? 'AMBIGUOUS_FUNDING',
    detail: first.holdDetail ?? 'funding hold',
    termId: first.line.term.id,
  };
}

function calculateLines(
  terms: EconomicTerm[],
  event: AccrualEvent,
): Calculated[] {
  const memo = new Map<string, bigint>();
  const amountOf = (term: EconomicTerm, stack: string[]): bigint => {
    const cached = memo.get(term.id);
    if (cached != null) return cached;
    if (stack.includes(term.id)) {
      throw new Error(`override cycle at ${term.id}`);
    }
    const nextStack = [...stack, term.id];
    let amount: bigint;
    if (term.basis === 'FIXED_ATOMIC') {
      if (term.fixedAmountAtomic == null || term.fixedAmountAtomic < 0n) {
        throw new Error(`${term.id} fixed amount invalid`);
      }
      amount = term.fixedAmountAtomic;
    } else if (term.basis === 'SHARE_BPS') {
      amount = mulBpsHalfEven(
        requireBase(event, term),
        requireBps(term.shareBps, term.id),
      );
    } else if (term.basis === 'TIERED') {
      amount = tieredAmount(requireBase(event, term), term);
    } else {
      const child = terms.find((row) => row.id === term.childTermId);
      if (!child || child.basis === 'OVERRIDE') {
        throw new Error(`override-on-override ${term.id}`);
      }
      const childAmount = amountOf(child, nextStack);
      amount = mulBpsHalfEven(
        childAmount,
        requireBps(term.overrideBps, term.id),
      );
    }
    memo.set(term.id, amount);
    return amount;
  };

  return terms.map((term) => ({
    term,
    calculatedAtomic: amountOf(term, []),
    countsTowardEventBase: countsTowardEventBase(term, terms),
  }));
}

function countsTowardEventBase(
  term: EconomicTerm,
  terms: EconomicTerm[],
): boolean {
  if (term.basis === 'FIXED_ATOMIC' && term.fixedIndependentOfBase === true) {
    return false;
  }
  if (term.basis === 'OVERRIDE') {
    const child = terms.find((row) => row.id === term.childTermId);
    if (!child) return false;
    return countsTowardEventBase(child, terms);
  }
  return true;
}

function tieredAmount(base: bigint, term: EconomicTerm): bigint {
  const tiers = [...(term.tiers ?? [])].sort((a, b) =>
    a.lower < b.lower ? -1 : a.lower > b.lower ? 1 : 0,
  );
  if (term.tierMode === 'WHOLE') {
    const tier = tiers.find(
      (row) => base >= row.lower && (row.upper == null || base < row.upper),
    );
    if (!tier) throw new Error(`${term.id} tier gap`);
    return mulBpsHalfEven(base, tier.rateBps);
  }
  let total = 0n;
  for (const tier of tiers) {
    if (base <= tier.lower) break;
    const upper = tier.upper == null || tier.upper > base ? base : tier.upper;
    const slice = upper - tier.lower;
    if (slice > 0n) total += mulBpsHalfEven(slice, tier.rateBps);
  }
  return total;
}

function requireBase(event: AccrualEvent, term: EconomicTerm): bigint {
  const base = event.bases[term.baseKey];
  if (base == null) throw new Error(`${term.id} missing base ${term.baseKey}`);
  if (base < 0n) throw new Error(`${term.id} negative base`);
  return base;
}

function requireBps(bps: bigint | undefined, termId: string): bigint {
  if (bps == null) throw new Error(`${termId} missing bps`);
  return bps;
}

function eventLimit(eventBase: bigint, stackingCapBps?: bigint | null): bigint {
  if (stackingCapBps == null) return eventBase;
  const stacked = mulBpsHalfEven(eventBase, stackingCapBps);
  return stacked < eventBase ? stacked : eventBase;
}

/**
 * Static event-base cap. CHILD_DEDUCTION that is explicitly authorised does
 * not add effective override bps: the child's own rate already contains the
 * override. Any other override still adds effective bps (v6.4.5 ORG_PAYS
 * rule). FIXED and different-base children are not in this check.
 */
function provableEventCap(version: AgreementVersionTerms): string | null {
  let totalScaled = 0n;
  const limitBps =
    version.stackingCapBps != null && version.stackingCapBps < CAP_BPS
      ? version.stackingCapBps
      : CAP_BPS;

  for (const term of version.terms) {
    if (
      term.basis === 'SHARE_BPS' &&
      term.baseKey === EVENT_BASE &&
      term.shareBps != null
    ) {
      totalScaled += term.shareBps * CAP_BPS;
    }
    if (term.basis === 'TIERED' && term.baseKey === EVENT_BASE) {
      totalScaled += maxTierRate(term) * CAP_BPS;
    }
    if (term.basis !== 'OVERRIDE' || term.overrideBps == null) continue;
    if (
      term.fundingMode === 'CHILD_DEDUCTION' &&
      term.deductionAuthorised === true
    ) {
      continue;
    }
    const child = version.terms.find((row) => row.id === term.childTermId);
    if (!child || child.baseKey !== EVENT_BASE) continue;
    if (child.basis === 'SHARE_BPS' && child.shareBps != null) {
      totalScaled += term.overrideBps * child.shareBps;
    } else if (child.basis === 'TIERED') {
      totalScaled += term.overrideBps * maxTierRate(child);
    }
  }

  const limitScaled = limitBps * CAP_BPS;
  if (totalScaled > limitScaled) {
    return `effective scaled ${totalScaled.toString()} exceeds ${limitScaled.toString()}`;
  }
  return null;
}

/** Agreement stacking uses calculated amounts, not post-funding payee nets (E25). */
function provableStacking(terms: EconomicTerm[]): string | null {
  for (const term of terms) {
    if (term.basis !== 'FIXED_ATOMIC' || term.stackingCapAtomic == null)
      continue;
    if (term.fixedAmountAtomic == null) continue;
    const overrides = terms.filter(
      (row) =>
        row.basis === 'OVERRIDE' &&
        row.childTermId === term.id &&
        row.overrideBps != null,
    );
    let total = term.fixedAmountAtomic;
    for (const override of overrides) {
      total += mulBpsHalfEven(
        term.fixedAmountAtomic,
        override.overrideBps as bigint,
      );
    }
    if (total > term.stackingCapAtomic) {
      return `${term.id} stacking ${total.toString()} exceeds ${term.stackingCapAtomic.toString()}`;
    }
  }
  return null;
}

function validateOverride(
  term: EconomicTerm,
  terms: EconomicTerm[],
): string | null {
  if (term.purpose !== 'OVERRIDE') {
    return `${term.id} override purpose must be OVERRIDE`;
  }
  if (!term.childTermId) return `${term.id} missing OVERRIDE_OF child`;
  const child = terms.find((row) => row.id === term.childTermId);
  if (!child) return `${term.id} child term missing`;
  if (child.basis === 'OVERRIDE') return `${term.id} override-on-override`;
  if (child.beneficiaryId === term.beneficiaryId) {
    return `${term.id} self-override`;
  }
  if (overrideCycle(term, terms)) return `${term.id} override cycle`;
  return null;
}

function overrideCycle(start: EconomicTerm, terms: EconomicTerm[]): boolean {
  const seen = new Set<string>();
  let current: EconomicTerm | undefined = start;
  while (current && current.basis === 'OVERRIDE' && current.childTermId) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = terms.find((row) => row.id === current?.childTermId);
  }
  return false;
}

function validateBps(term: EconomicTerm): string | null {
  for (const bps of [term.shareBps, term.overrideBps]) {
    if (bps == null) continue;
    if (bps < 0n || bps > CAP_BPS) return `${term.id} bps out of range`;
  }
  if (term.tiers) {
    for (const tier of term.tiers) {
      if (tier.rateBps < 0n || tier.rateBps > CAP_BPS) {
        return `${term.id} tier bps out of range`;
      }
    }
  }
  return null;
}

function validateTiers(term: EconomicTerm): string | null {
  if (!term.tierMode) return `${term.id} tier mode missing`;
  const tiers = [...(term.tiers ?? [])].sort((a, b) =>
    a.lower < b.lower ? -1 : 1,
  );
  if (tiers.length === 0) return `${term.id} tiers missing`;
  if (tiers[0].lower !== 0n) return `${term.id} tiers must start at 0`;
  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    if (tier.upper != null && tier.upper <= tier.lower) {
      return `${term.id} tier bounds overlap or empty`;
    }
    if (i < tiers.length - 1) {
      const next = tiers[i + 1];
      if (tier.upper == null || tier.upper !== next.lower) {
        return `${term.id} tiers must be contiguous`;
      }
    }
  }
  return null;
}

function maxTierRate(term: EconomicTerm): bigint {
  return (term.tiers ?? []).reduce<bigint>(
    (max, tier: Tier) => (tier.rateBps > max ? tier.rateBps : max),
    0n,
  );
}

function reject(
  code: RejectionCode,
  detail: string,
): { ok: false; code: RejectionCode; detail: string } {
  return { ok: false, code, detail };
}

function hold(
  input: { event: AccrualEvent; version: AgreementVersionTerms },
  reason: HoldReason,
  eventBaseCapAtomic: bigint | null,
  eventBaseLimitAtomic: bigint | null,
  review: Record<string, string>,
): EngineResult {
  return {
    kind: 'held',
    sourceEventId: input.event.id,
    reason,
    agreementVersionId: input.version.id,
    financialEffect: 'NONE',
    eventBaseCapAtomic,
    eventBaseLimitAtomic,
    review,
  };
}

export function obligationSnapshotEqual(
  a: ObligationDraft,
  b: ObligationDraft,
): boolean {
  return (
    a.sourceEventId === b.sourceEventId &&
    a.beneficiaryId === b.beneficiaryId &&
    a.purpose === b.purpose &&
    a.amountAtomic === b.amountAtomic &&
    a.grossCommissionAtomic === b.grossCommissionAtomic &&
    a.overrideAmountAtomic === b.overrideAmountAtomic &&
    a.fundingMode === b.fundingMode &&
    a.agreementVersionId === b.agreementVersionId &&
    a.economicTermId === b.economicTermId &&
    a.commissionStructureId === b.commissionStructureId &&
    a.assetCode === b.assetCode &&
    a.childAgreementVersionId === b.childAgreementVersionId &&
    a.disclosureId === b.disclosureId
  );
}

export function isBasis(value: string): value is Basis {
  return (
    value === 'SHARE_BPS' ||
    value === 'FIXED_ATOMIC' ||
    value === 'TIERED' ||
    value === 'OVERRIDE'
  );
}

export function isPurpose(value: string): value is Purpose {
  return (
    value === 'COMMISSION' ||
    value === 'OVERRIDE' ||
    value === 'REFERRAL' ||
    value === 'RETAINER' ||
    value === 'BONUS'
  );
}
