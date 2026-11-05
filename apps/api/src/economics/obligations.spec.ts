import { AgreementBook } from './agreement-book';
import { event, n, term, version } from './fixtures';
import { D3_OBLIGATION_KEY, RETRY_IDEMPOTENCY_KEY } from './types';
import {
  classifyBatch,
  d3Key,
  ObligationLedger,
  retryKey,
} from './obligation-ledger';
import { accrueEvent } from './rules-engine';
import type { ObligationDraft } from './types';

function draft(
  partial: Partial<ObligationDraft> &
    Pick<
      ObligationDraft,
      'beneficiaryId' | 'purpose' | 'commissionStructureId'
    >,
): ObligationDraft {
  return {
    sourceEventId: partial.sourceEventId ?? '123',
    beneficiaryId: partial.beneficiaryId,
    purpose: partial.purpose,
    amountAtomic: partial.amountAtomic ?? 100n,
    grossCommissionAtomic: partial.grossCommissionAtomic ?? 100n,
    overrideAmountAtomic: partial.overrideAmountAtomic ?? 0n,
    fundingMode: partial.fundingMode ?? 'ORG_PAYS',
    agreementVersionId: partial.agreementVersionId ?? 'v1',
    economicTermId: partial.economicTermId ?? 'term',
    commissionStructureId: partial.commissionStructureId,
    assetCode: 'USD',
    childAgreementVersionId: null,
    disclosureId: null,
    splitGroupId: '123',
  };
}

describe('obligation guards', () => {
  it('keeps funding mode and agreement version out of both identity keys', () => {
    expect([...D3_OBLIGATION_KEY]).toEqual([
      'sourceEventId',
      'beneficiaryId',
      'purpose',
    ]);
    expect([...RETRY_IDEMPOTENCY_KEY]).toEqual([
      'sourceEventId',
      'commissionStructureId',
      'beneficiaryId',
    ]);
    const row = draft({
      beneficiaryId: 'R',
      purpose: 'COMMISSION',
      commissionStructureId: 'structure-a',
      fundingMode: 'CHILD_DEDUCTION',
      agreementVersionId: 'version-9',
    });
    expect(d3Key(row).includes('CHILD_DEDUCTION')).toBe(false);
    expect(d3Key(row).includes('version-9')).toBe(false);
    expect(retryKey(row).includes('CHILD_DEDUCTION')).toBe(false);
    expect(retryKey(row).includes('version-9')).toBe(false);
  });

  it('E18 rejects a second structure on the D3 guard even though the retry key would allow it', async () => {
    const ledger = new ObligationLedger();
    const first = draft({
      beneficiaryId: 'R',
      purpose: 'COMMISSION',
      commissionStructureId: 'structure-a',
      agreementVersionId: 'agreement-a',
    });
    const created = await ledger.persist({
      kind: 'accrued',
      obligations: [first],
      eventBaseCapAtomic: 100n,
      eventBaseLimitAtomic: 1000n,
    });
    expect(created.status).toBe('CREATED');

    const second = draft({
      beneficiaryId: 'R',
      purpose: 'COMMISSION',
      commissionStructureId: 'structure-b',
      agreementVersionId: 'agreement-b',
      amountAtomic: 250n,
    });
    expect(retryKey(first)).not.toBe(retryKey(second));
    expect(d3Key(first)).toBe(d3Key(second));
    const verdict = classifyBatch([first], [second]);
    expect(verdict.reject).toBe('D3');

    const rejected = await ledger.persist({
      kind: 'accrued',
      obligations: [second],
      eventBaseCapAtomic: 250n,
      eventBaseLimitAtomic: 1000n,
    });
    expect(rejected.status).toBe('REJECTED_DUPLICATE');
    expect(rejected.guard).toBe('D3');
    expect(ledger.listObligations()).toEqual([first]);
  });

  it('treats an identical replay as one financial posting', async () => {
    const ledger = new ObligationLedger();
    const row = draft({
      beneficiaryId: 'R',
      purpose: 'COMMISSION',
      commissionStructureId: 's',
    });
    const payload = {
      kind: 'accrued' as const,
      obligations: [row],
      eventBaseCapAtomic: 100n,
      eventBaseLimitAtomic: 1000n,
    };
    expect((await ledger.persist(payload)).status).toBe('CREATED');
    expect((await ledger.persist(payload)).status).toBe('IDEMPOTENT');
    expect(ledger.listObligations()).toHaveLength(1);
  });

  it('does not create duplicate obligations under concurrent generation', async () => {
    const rep = term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      shareBps: n(1500),
    });
    const result = accrueEvent({
      event: event('concurrent', { EVENT: 100000 }),
      version: version('v1', [rep]),
      disclosures: [],
    });
    expect(result.kind).toBe('accrued');
    const ledger = new ObligationLedger();
    const outcomes = await Promise.all(
      Array.from({ length: 24 }, () => ledger.persist(result)),
    );
    expect(outcomes.filter((row) => row.status === 'CREATED')).toHaveLength(1);
    expect(
      outcomes.every(
        (row) => row.status === 'CREATED' || row.status === 'IDEMPOTENT',
      ),
    ).toBe(true);
    expect(ledger.listObligations()).toHaveLength(1);
    expect(ledger.listObligations()[0].amountAtomic).toBe(15000n);
  });

  it('does not replace a cap hold with a later posting for the same event', async () => {
    const ledger = new ObligationLedger();
    const held = await ledger.persist({
      kind: 'held',
      sourceEventId: 'e22',
      reason: 'CAP_EXCEEDED',
      agreementVersionId: 'v1',
      financialEffect: 'NONE',
      eventBaseCapAtomic: 91800n,
      eventBaseLimitAtomic: 90000n,
      review: { postedObligations: '0' },
    });
    expect(held.status).toBe('CREATED');
    const later = await ledger.persist({
      kind: 'accrued',
      obligations: [
        draft({
          beneficiaryId: 'rep',
          purpose: 'COMMISSION',
          commissionStructureId: 'v2',
          sourceEventId: 'e22',
          amountAtomic: 1n,
        }),
      ],
      eventBaseCapAtomic: 1n,
      eventBaseLimitAtomic: 90000n,
    });
    expect(later.status).toBe('REJECTED_DUPLICATE');
    expect(later.guard).toBe('EVENT_DECISION');
    expect(ledger.listObligations()).toHaveLength(0);
    expect(ledger.listHolds()).toHaveLength(1);
  });

  it('rejects a partner attempt to configure funding on the book', () => {
    const book = new AgreementBook();
    book.addVersion({
      id: 'v1',
      agreementId: 'agr',
      versionNumber: 1,
      status: 'EXECUTED',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      terms: [
        term({
          id: 'mgr',
          beneficiaryId: 'mgr',
          basis: 'OVERRIDE',
          purpose: 'OVERRIDE',
          overrideBps: n(1000),
          childTermId: 'rep',
        }),
        term({
          id: 'rep',
          beneficiaryId: 'rep',
          basis: 'SHARE_BPS',
          purpose: 'COMMISSION',
          shareBps: n(1000),
        }),
      ],
    });
    expect(() =>
      book.configureFunding({
        actorKind: 'api_client',
        actorId: 'partner',
        versionId: 'v1',
        termId: 'mgr',
        fundingMode: 'CHILD_DEDUCTION',
        deductionAuthorised: true,
        newVersionId: 'v2',
        now: '2026-05-01T00:00:00.000Z',
      }),
    ).toThrow(/internal/);
  });
});
