import { disclosure, event, n, term, version } from './fixtures';
import { accrueEvent, activateTerms } from './rules-engine';
import type { EconomicTerm, EngineResult } from './types';

function postedAmounts(result: EngineResult): bigint[] {
  if (result.kind !== 'accrued') throw new Error('expected accrual');
  return result.obligations
    .map((row) => row.amountAtomic)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function overrideOn(
  child: EconomicTerm,
  partial: Partial<EconomicTerm> & Pick<EconomicTerm, 'id' | 'beneficiaryId'>,
): EconomicTerm {
  return term({
    basis: 'OVERRIDE',
    purpose: 'OVERRIDE',
    childTermId: child.id,
    overrideBps: n(1000),
    ...partial,
  });
}

describe('Addendum A caps E19–E26', () => {
  it('E19 rejects override-on-override and still allows two overrides on the child', () => {
    const rep = term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      shareBps: n(1500),
    });
    const manager = overrideOn(rep, {
      id: 'mgr',
      beneficiaryId: 'mgr',
      overrideBps: n(1000),
    });
    const onOverride = overrideOn(manager, {
      id: 'dir',
      beneficiaryId: 'dir',
      overrideBps: n(1000),
      childTermId: 'mgr',
    });
    const rejected = activateTerms(version('v1', [rep, manager, onOverride]));
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.detail).toContain('override-on-override');

    const director = overrideOn(rep, {
      id: 'dir',
      beneficiaryId: 'dir',
      overrideBps: n(200),
    });
    expect(activateTerms(version('v1', [rep, manager, director])).ok).toBe(
      true,
    );
    const accrued = accrueEvent({
      event: event('e19', { EVENT: 100000 }),
      version: version('v1', [rep, manager, director]),
      disclosures: [],
    });
    expect(accrued.kind).toBe('accrued');
    if (accrued.kind !== 'accrued') return;
    expect(postedAmounts(accrued)).toEqual([300n, 1500n, 15000n]);
  });

  it('E20 holds FIXED above the base unless it is independent of the base', () => {
    const fixed = term({
      id: 'fixed',
      beneficiaryId: 'rep',
      basis: 'FIXED_ATOMIC',
      purpose: 'COMMISSION',
      fixedAmountAtomic: n(50000),
      fixedIndependentOfBase: false,
    });
    const held = accrueEvent({
      event: event('e20', { EVENT: 30000 }),
      version: version('v1', [fixed]),
      disclosures: [],
    });
    expect(held.kind).toBe('held');
    if (held.kind !== 'held') return;
    expect(held.reason).toBe('EXCEEDS_BASE');
    expect(held.review.postedObligations).toBe('0');

    const independent = {
      ...fixed,
      fixedIndependentOfBase: true,
      purpose: 'RETAINER' as const,
    };
    const accepted = accrueEvent({
      event: event('e20b', { EVENT: 30000 }),
      version: version('v1', [independent]),
      disclosures: [],
    });
    expect(accepted.kind).toBe('accrued');
    if (accepted.kind !== 'accrued') return;
    expect(accepted.eventBaseCapAtomic).toBe(0n);
    expect(accepted.obligations[0].amountAtomic).toBe(50000n);
  });

  it('E21 accepts share 9000 plus override 1100 at the effective rate', () => {
    const rep = term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      shareBps: n(9000),
    });
    const manager = overrideOn(rep, {
      id: 'mgr',
      beneficiaryId: 'mgr',
      overrideBps: n(1100),
    });
    const activation = activateTerms(version('v1', [rep, manager]));
    expect(activation.ok).toBe(true);
    const accrued = accrueEvent({
      event: event('e21', { EVENT: 100000 }),
      version: version('v1', [rep, manager]),
      disclosures: [],
    });
    expect(accrued.kind).toBe('accrued');
    if (accrued.kind !== 'accrued') return;
    expect(accrued.eventBaseCapAtomic).toBe(99900n);
    expect(
      accrued.obligations.find((row) => row.beneficiaryId === 'rep')
        ?.amountAtomic,
    ).toBe(90000n);
    expect(
      accrued.obligations.find((row) => row.beneficiaryId === 'mgr')
        ?.amountAtomic,
    ).toBe(9900n);
  });

  it('E22 and E24 hold the whole event at base 90000 and accrue the 100000 example', () => {
    const terms = e22Terms();
    expect(activateTerms(version('v1', terms)).ok).toBe(true);
    expect(
      terms.every(
        (row) => row.fundingMode == null || row.fundingMode === 'ORG_PAYS',
      ),
    ).toBe(true);

    const held = accrueEvent({
      event: event('e22', { EVENT: 90000 }),
      version: version('v1', terms),
      disclosures: [],
    });
    expect(held.kind).toBe('held');
    if (held.kind !== 'held') return;
    expect(held.reason).toBe('CAP_EXCEEDED');
    expect(held.eventBaseCapAtomic).toBe(91800n);
    expect(held.review.prorated).toBe('false');
    expect(held.review.partialPayment).toBe('false');
    expect(held.review.postedObligations).toBe('0');

    const within = accrueEvent({
      event: event('e22-ok', { EVENT: 100000 }),
      version: version('v1', terms),
      disclosures: [],
    });
    expect(within.kind).toBe('accrued');
    if (within.kind !== 'accrued') return;
    expect(within.eventBaseCapAtomic).toBe(99800n);
    expect(postedAmounts(within)).toEqual([1800n, 18000n, 80000n]);
  });

  it('keeps marginal and whole tier amounts from the worked example', () => {
    const tiers = [
      { lower: 0n, upper: 500000n, rateBps: n(1000) },
      { lower: 500000n, upper: null, rateBps: n(1500) },
    ];
    const marginal = term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'TIERED',
      purpose: 'COMMISSION',
      tierMode: 'MARGINAL',
      tiers,
    });
    const whole = term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'TIERED',
      purpose: 'COMMISSION',
      tierMode: 'WHOLE',
      tiers,
    });
    const marginalResult = accrueEvent({
      event: event('tier-m', { EVENT: 800000 }),
      version: version('v1', [marginal]),
      disclosures: [],
    });
    const wholeResult = accrueEvent({
      event: event('tier-w', { EVENT: 800000 }),
      version: version('v1', [whole]),
      disclosures: [],
    });
    expect(postedAmounts(marginalResult)).toEqual([95000n]);
    expect(postedAmounts(wholeResult)).toEqual([120000n]);
  });

  it('E23 rejects a tiered child whose max rate is provably over the cap', () => {
    const rep = term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'TIERED',
      purpose: 'COMMISSION',
      tierMode: 'MARGINAL',
      tiers: [
        { lower: 0n, upper: 100000n, rateBps: n(7000) },
        { lower: 100000n, upper: null, rateBps: n(9500) },
      ],
    });
    const manager = overrideOn(rep, {
      id: 'mgr',
      beneficiaryId: 'mgr',
      overrideBps: n(1000),
    });
    const activation = activateTerms(version('v1', [rep, manager]));
    expect(activation.ok).toBe(false);
    if (activation.ok) return;
    expect(activation.code).toBe('CAP_PROVABLY_OVER');
    const accrued = accrueEvent({
      event: event('e23', { EVENT: 150000 }),
      version: version('v1', [rep, manager]),
      disclosures: [],
    });
    expect(accrued.kind).toBe('rejected');
  });

  it('E25 keeps the independent retainer and its override out of the event cap', () => {
    const accept = e25(60000n);
    expect(activateTerms(version('v1', accept)).ok).toBe(true);
    const accrued = accrueEvent({
      event: event('e25a', { EVENT: 30000 }),
      version: version('v1', accept),
      disclosures: [],
    });
    expect(accrued.kind).toBe('accrued');
    if (accrued.kind !== 'accrued') return;
    expect(accrued.eventBaseCapAtomic).toBe(24000n);
    expect(postedAmounts(accrued)).toEqual([5000n, 24000n, 50000n]);

    const reject = e25(50000n);
    const activation = activateTerms(version('v1', reject));
    expect(activation.ok).toBe(false);
    if (activation.ok) return;
    expect(activation.code).toBe('STACKING_PROVABLY_OVER');

    const deducted = e25(50000n).map((row) =>
      row.basis === 'OVERRIDE'
        ? {
            ...row,
            fundingMode: 'CHILD_DEDUCTION' as const,
            deductionAuthorised: true,
          }
        : row,
    );
    const stillOver = activateTerms(version('v1', deducted));
    expect(stillOver.ok).toBe(false);
    if (stillOver.ok) return;
    expect(stillOver.code).toBe('STACKING_PROVABLY_OVER');
  });

  it('E25 holds agreement stacking that is only knowable at accrual', () => {
    const rep = term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      shareBps: n(5000),
      stackingCapAtomic: n(1000),
    });
    expect(activateTerms(version('v1', [rep])).ok).toBe(true);
    const held = accrueEvent({
      event: event('e25-accrual', { EVENT: 100000 }),
      version: version('v1', [rep]),
      disclosures: [],
    });
    expect(held.kind).toBe('held');
    if (held.kind !== 'held') return;
    expect(held.reason).toBe('STACKING_CAP');
    expect(held.review.prorated).toBe('false');
    expect(held.review.postedObligations).toBe('0');
  });

  it('E26 holds a different-base child at accrual and accrues the control', () => {
    const terms = e26Terms();
    expect(activateTerms(version('v1', terms)).ok).toBe(true);
    const held = accrueEvent({
      event: event('e26', { EVENT: 100000, GROSS_BOOKING: 400000 }),
      version: version('v1', terms),
      disclosures: [],
    });
    expect(held.kind).toBe('held');
    if (held.kind !== 'held') return;
    expect(held.reason).toBe('CAP_EXCEEDED');
    expect(held.eventBaseCapAtomic).toBe(168000n);
    expect(held.review.partialPayment).toBe('false');

    const control = accrueEvent({
      event: event('e26c', { EVENT: 100000, GROSS_BOOKING: 40000 }),
      version: version('v1', terms),
      disclosures: [],
    });
    expect(control.kind).toBe('accrued');
    if (control.kind !== 'accrued') return;
    expect(control.eventBaseCapAtomic).toBe(88800n);
  });

  it('counts a deducted override once against the event cap', () => {
    const orgTerms = e22Terms();
    const deductedTerms = e22Terms().map((row) =>
      row.id === 'mgr'
        ? {
            ...row,
            agreementVersionId: 'v-ded',
            fundingMode: 'CHILD_DEDUCTION' as const,
            deductionAuthorised: true,
          }
        : { ...row, agreementVersionId: 'v-ded' },
    );
    const org = accrueEvent({
      event: event('cap-org', { EVENT: 90000 }),
      version: version('v1', orgTerms),
      disclosures: [],
    });
    const deducted = accrueEvent({
      event: event('cap-child', { EVENT: 90000 }),
      version: version('v-ded', deductedTerms),
      disclosures: [
        disclosure({
          overrideTermId: 'mgr',
          overrideAgreementVersionId: 'v-ded',
        }),
      ],
    });
    expect(org.kind).toBe('held');
    if (org.kind !== 'held') return;
    expect(org.reason).toBe('CAP_EXCEEDED');
    expect(org.eventBaseCapAtomic).toBe(91800n);

    expect(deducted.kind).toBe('accrued');
    if (deducted.kind !== 'accrued') return;
    expect(deducted.eventBaseCapAtomic).toBe(90000n);
    expect(
      deducted.obligations.find((row) => row.beneficiaryId === 'rep')
        ?.amountAtomic,
    ).toBe(16200n);
    expect(
      deducted.obligations.find((row) => row.beneficiaryId === 'mgr')
        ?.amountAtomic,
    ).toBe(1800n);
    expect(
      deducted.obligations.find((row) => row.beneficiaryId === 'platform')
        ?.amountAtomic,
    ).toBe(72000n);
  });

  it('does not treat an authorised child deduction as extra effective bps', () => {
    const rep = term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      shareBps: n(9000),
    });
    const orgOverride = overrideOn(rep, {
      id: 'mgr',
      beneficiaryId: 'mgr',
      overrideBps: n(2000),
    });
    expect(activateTerms(version('v1', [rep, orgOverride])).ok).toBe(false);

    const deducted = {
      ...orgOverride,
      fundingMode: 'CHILD_DEDUCTION' as const,
      deductionAuthorised: true,
    };
    expect(activateTerms(version('v-ded', [rep, deducted])).ok).toBe(true);
    const accrued = accrueEvent({
      event: event('ded-share', { EVENT: 100000 }),
      version: version('v-ded', [
        { ...rep, agreementVersionId: 'v-ded' },
        { ...deducted, agreementVersionId: 'v-ded' },
      ]),
      disclosures: [
        disclosure({
          overrideTermId: 'mgr',
          overrideAgreementVersionId: 'v-ded',
        }),
      ],
    });
    expect(accrued.kind).toBe('accrued');
    if (accrued.kind !== 'accrued') return;
    expect(accrued.eventBaseCapAtomic).toBe(90000n);
    expect(
      accrued.obligations.find((row) => row.beneficiaryId === 'rep')
        ?.amountAtomic,
    ).toBe(72000n);
  });
});

function e22Terms(): EconomicTerm[] {
  const platform = term({
    id: 'platform',
    beneficiaryId: 'platform',
    basis: 'SHARE_BPS',
    purpose: 'COMMISSION',
    shareBps: n(8000),
  });
  const rep = term({
    id: 'rep',
    beneficiaryId: 'rep',
    basis: 'FIXED_ATOMIC',
    purpose: 'COMMISSION',
    fixedAmountAtomic: n(18000),
  });
  const manager = overrideOn(rep, {
    id: 'mgr',
    beneficiaryId: 'mgr',
    overrideBps: n(1000),
  });
  return [platform, rep, manager];
}

function e25(stackingCapAtomic: bigint): EconomicTerm[] {
  return [
    term({
      id: 'platform',
      beneficiaryId: 'platform',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      shareBps: n(8000),
    }),
    term({
      id: 'creator',
      beneficiaryId: 'creator',
      basis: 'FIXED_ATOMIC',
      purpose: 'RETAINER',
      fixedAmountAtomic: n(50000),
      fixedIndependentOfBase: true,
      stackingCapAtomic,
    }),
    term({
      id: 'mgr',
      beneficiaryId: 'mgr',
      basis: 'OVERRIDE',
      purpose: 'OVERRIDE',
      overrideBps: n(1000),
      childTermId: 'creator',
    }),
  ];
}

function e26Terms(): EconomicTerm[] {
  return [
    term({
      id: 'platform',
      beneficiaryId: 'platform',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      shareBps: n(8000),
    }),
    term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      baseKey: 'GROSS_BOOKING',
      shareBps: n(2000),
    }),
    term({
      id: 'mgr',
      beneficiaryId: 'mgr',
      basis: 'OVERRIDE',
      purpose: 'OVERRIDE',
      overrideBps: n(1000),
      childTermId: 'rep',
    }),
  ];
}
