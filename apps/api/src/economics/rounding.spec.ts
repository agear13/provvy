import { allocateLargestRemainder, mulBpsHalfEven } from './money';
import { disclosure, event, n, term, version } from './fixtures';
import { accrueEvent } from './rules-engine';

describe('rounding and residual', () => {
  it('keeps half-even and largest-remainder results from the addendum', () => {
    expect(mulBpsHalfEven(1001n, 5000n)).toBe(500n);
    expect(mulBpsHalfEven(1003n, 5000n)).toBe(502n);
    expect(mulBpsHalfEven(12345n, 250n)).toBe(309n);
    expect(mulBpsHalfEven(3n, 5000n)).toBe(2n);

    const tied = allocateLargestRemainder(100n, [
      { memberId: 'a', bps: 3333n },
      { memberId: 'b', bps: 3333n },
      { memberId: 'c', bps: 3333n },
    ]);
    expect(tied.allocations.map((row) => row.amountAtomic)).toEqual([
      34n,
      33n,
      33n,
    ]);
    expect(tied.residualAtomic).toBe(0n);

    const uneven = allocateLargestRemainder(100n, [
      { memberId: 'a', bps: 3334n },
      { memberId: 'b', bps: 3333n },
      { memberId: 'c', bps: 3333n },
    ]);
    expect(uneven.allocations.map((row) => row.amountAtomic)).toEqual([
      34n,
      33n,
      33n,
    ]);
    expect(uneven.residualAtomic).toBe(0n);
  });

  it('does not re-round the child gross when the override is deducted', () => {
    const before = allocateLargestRemainder(100n, [
      { memberId: 'a', bps: 3333n },
      { memberId: 'b', bps: 3333n },
      { memberId: 'c', bps: 3333n },
    ]);
    const rep = term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      shareBps: n(1000),
    });
    const manager = term({
      id: 'mgr',
      beneficiaryId: 'mgr',
      basis: 'OVERRIDE',
      purpose: 'OVERRIDE',
      overrideBps: n(5000),
      childTermId: 'rep',
    });
    const sale = event('round-1', { EVENT: 10010 });
    const org = accrueEvent({
      event: sale,
      version: version('v1', [rep, manager]),
      disclosures: [],
    });
    const deducted = accrueEvent({
      event: event('round-2', { EVENT: 10010 }),
      version: version('v2', [
        { ...rep, agreementVersionId: 'v2' },
        {
          ...manager,
          agreementVersionId: 'v2',
          fundingMode: 'CHILD_DEDUCTION',
          deductionAuthorised: true,
        },
      ]),
      disclosures: [
        disclosure({ overrideTermId: 'mgr', overrideAgreementVersionId: 'v2' }),
      ],
    });
    expect(org.kind).toBe('accrued');
    expect(deducted.kind).toBe('accrued');
    if (org.kind !== 'accrued' || deducted.kind !== 'accrued') return;
    const orgChild = org.obligations.find((row) => row.beneficiaryId === 'rep');
    const dedChild = deducted.obligations.find(
      (row) => row.beneficiaryId === 'rep',
    );
    const orgOverride = org.obligations.find(
      (row) => row.beneficiaryId === 'mgr',
    );
    const dedOverride = deducted.obligations.find(
      (row) => row.beneficiaryId === 'mgr',
    );
    expect(orgChild?.grossCommissionAtomic).toBe(1001n);
    expect(dedChild?.grossCommissionAtomic).toBe(1001n);
    expect(orgChild?.amountAtomic).toBe(1001n);
    expect(orgOverride?.amountAtomic).toBe(500n);
    expect(dedOverride?.amountAtomic).toBe(500n);
    expect(dedChild?.amountAtomic).toBe(501n);
    expect(org.obligations.some((row) => row.purpose === 'BONUS')).toBe(false);
    expect(
      deducted.obligations.some((row) => row.beneficiaryId === 'residual'),
    ).toBe(false);

    const after = allocateLargestRemainder(100n, [
      { memberId: 'a', bps: 3333n },
      { memberId: 'b', bps: 3333n },
      { memberId: 'c', bps: 3333n },
    ]);
    expect(after).toEqual(before);
    expect(mulBpsHalfEven(3n, 5000n)).toBe(2n);
  });
});
