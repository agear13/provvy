import { AgreementBook } from './agreement-book';
import { disclosure, event, n, term, version } from './fixtures';
import { accrueEvent } from './rules-engine';
import type { EconomicTerm, EngineResult } from './types';

function shareAndOverride(funding?: Partial<EconomicTerm>): EconomicTerm[] {
  return [
    term({
      id: 'rep',
      beneficiaryId: 'rep',
      basis: 'SHARE_BPS',
      purpose: 'COMMISSION',
      shareBps: n(1500),
    }),
    term({
      id: 'mgr',
      beneficiaryId: 'mgr',
      basis: 'OVERRIDE',
      purpose: 'OVERRIDE',
      overrideBps: n(1000),
      childTermId: 'rep',
      ...funding,
    }),
  ];
}

function childOf(result: EngineResult) {
  if (result.kind !== 'accrued') throw new Error('expected accrual');
  const row = result.obligations.find((item) => item.beneficiaryId === 'rep');
  if (!row) throw new Error('missing child obligation');
  return row;
}

function overrideOf(result: EngineResult) {
  if (result.kind !== 'accrued') throw new Error('expected accrual');
  const row = result.obligations.find((item) => item.purpose === 'OVERRIDE');
  if (!row) throw new Error('missing override obligation');
  return row;
}

describe('OD-D2W funding mode', () => {
  const sale = event('sale-1', { EVENT: 100000 });

  it('defaults to ORG_PAYS and leaves the child commission unchanged', () => {
    const result = accrueEvent({
      event: sale,
      version: version('v1', shareAndOverride()),
      disclosures: [],
    });
    expect(result.kind).toBe('accrued');
    if (result.kind !== 'accrued') return;
    const child = childOf(result);
    const override = overrideOf(result);
    expect(child.amountAtomic).toBe(15000n);
    expect(child.grossCommissionAtomic).toBe(15000n);
    expect(child.fundingMode).toBe('ORG_PAYS');
    expect(child.agreementVersionId).toBe('v1');
    expect(override.amountAtomic).toBe(1500n);
    expect(override.fundingMode).toBe('ORG_PAYS');
    expect(override.agreementVersionId).toBe('v1');
    expect(result.eventBaseCapAtomic).toBe(16500n);
  });

  it('deducts an explicitly authorised and disclosed override from the child', () => {
    const result = accrueEvent({
      event: sale,
      version: version(
        'v1',
        shareAndOverride({
          fundingMode: 'CHILD_DEDUCTION',
          deductionAuthorised: true,
        }),
      ),
      disclosures: [disclosure({ overrideTermId: 'mgr' })],
    });
    expect(result.kind).toBe('accrued');
    if (result.kind !== 'accrued') return;
    const child = childOf(result);
    const override = overrideOf(result);
    expect(child.grossCommissionAtomic).toBe(15000n);
    expect(child.amountAtomic).toBe(13500n);
    expect(override.amountAtomic).toBe(1500n);
    expect(child.fundingMode).toBe('CHILD_DEDUCTION');
    expect(override.fundingMode).toBe('CHILD_DEDUCTION');
    expect(child.agreementVersionId).toBe('v1');
    expect(override.agreementVersionId).toBe('v1');
    expect(override.childAgreementVersionId).toBe('child-v1');
    expect(override.disclosureId).toBe('disc:mgr');
    expect(result.eventBaseCapAtomic).toBe(15000n);
  });

  it('holds when CHILD_DEDUCTION has no explicit authorisation', () => {
    const result = accrueEvent({
      event: sale,
      version: version(
        'v1',
        shareAndOverride({
          fundingMode: 'CHILD_DEDUCTION',
          deductionAuthorised: false,
        }),
      ),
      disclosures: [disclosure({ overrideTermId: 'mgr' })],
    });
    expect(result.kind).toBe('held');
    if (result.kind !== 'held') return;
    expect(result.reason).toBe('FUNDING_AUTHORISATION');
    expect(result.financialEffect).toBe('NONE');
    expect(result.review.receivableCreated).toBe('false');
  });

  it('holds when the child agreement does not disclose the deduction', () => {
    const missing = accrueEvent({
      event: sale,
      version: version(
        'v1',
        shareAndOverride({
          fundingMode: 'CHILD_DEDUCTION',
          deductionAuthorised: true,
        }),
      ),
      disclosures: [],
    });
    expect(missing.kind).toBe('held');
    if (missing.kind !== 'held') return;
    expect(missing.reason).toBe('DISCLOSURE_MISSING');

    const notAffirmative = accrueEvent({
      event: sale,
      version: version(
        'v1',
        shareAndOverride({
          fundingMode: 'CHILD_DEDUCTION',
          deductionAuthorised: true,
        }),
      ),
      disclosures: [disclosure({ overrideTermId: 'mgr', disclosed: false })],
    });
    expect(notAffirmative.kind).toBe('held');
    if (notAffirmative.kind !== 'held') return;
    expect(notAffirmative.reason).toBe('DISCLOSURE_MISSING');
  });

  it('holds an unrecognised mode instead of coercing it', () => {
    const terms = shareAndOverride();
    terms[1].fundingMode = 'DEDUCT' as never;
    const result = accrueEvent({
      event: sale,
      version: version('v1', terms),
      disclosures: [],
    });
    expect(result.kind).toBe('held');
    if (result.kind !== 'held') return;
    expect(result.reason).toBe('AMBIGUOUS_FUNDING');
  });

  it('holds when authorisation and ORG_PAYS disagree', () => {
    const result = accrueEvent({
      event: sale,
      version: version(
        'v1',
        shareAndOverride({
          fundingMode: 'ORG_PAYS',
          deductionAuthorised: true,
        }),
      ),
      disclosures: [disclosure({ overrideTermId: 'mgr' })],
    });
    expect(result.kind).toBe('held');
    if (result.kind !== 'held') return;
    expect(result.reason).toBe('AMBIGUOUS_FUNDING');
  });

  it('holds a negative child net and does not clamp or create a receivable', () => {
    const terms = [
      term({
        id: 'rep',
        beneficiaryId: 'rep',
        basis: 'SHARE_BPS',
        purpose: 'COMMISSION',
        shareBps: n(1000),
      }),
      term({
        id: 'mgr',
        beneficiaryId: 'mgr',
        basis: 'OVERRIDE',
        purpose: 'OVERRIDE',
        overrideBps: n(6000),
        childTermId: 'rep',
        fundingMode: 'CHILD_DEDUCTION',
        deductionAuthorised: true,
      }),
      term({
        id: 'dir',
        beneficiaryId: 'dir',
        basis: 'OVERRIDE',
        purpose: 'OVERRIDE',
        overrideBps: n(6000),
        childTermId: 'rep',
        fundingMode: 'CHILD_DEDUCTION',
        deductionAuthorised: true,
      }),
    ];
    const result = accrueEvent({
      event: event('neg-1', { EVENT: 100000 }),
      version: version('v1', terms),
      disclosures: [
        disclosure({ overrideTermId: 'mgr' }),
        disclosure({ id: 'disc:dir', overrideTermId: 'dir' }),
      ],
    });
    expect(result.kind).toBe('held');
    if (result.kind !== 'held') return;
    expect(result.reason).toBe('NEGATIVE_NET');
    expect(result.financialEffect).toBe('NONE');
    expect(result.review.netAtomic).toBe('-2000');
    expect(result.review.clamped).toBe('false');
    expect(result.review.receivableCreated).toBe('false');
    expect(result.review.postedObligations).toBe('0');
    expect(JSON.stringify(result)).not.toContain('RECEIVABLE');
  });

  it('does not rewrite historical obligations when a later version changes the mode', async () => {
    const book = new AgreementBook();
    book.addVersion({
      id: 'v1',
      agreementId: 'agr',
      versionNumber: 1,
      status: 'EXECUTED',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      terms: shareAndOverride({ agreementVersionId: 'v1' }),
    });
    const before = book.getVersion('v1');
    const first = await book.accrue(sale, 'v1');
    expect(first.status).toBe('CREATED');
    expect(
      first.obligations.find((row) => row.beneficiaryId === 'rep')
        ?.amountAtomic,
    ).toBe(15000n);

    const configured = book.configureFunding({
      actorKind: 'internal',
      actorId: 'finance-1',
      versionId: 'v1',
      termId: 'mgr',
      fundingMode: 'CHILD_DEDUCTION',
      deductionAuthorised: true,
      newVersionId: 'v2',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      now: '2026-05-01T00:00:00.000Z',
    });
    expect(book.getVersion('v1')).toEqual(before);
    expect(configured.version.status).toBe('DRAFT');
    expect(configured.audit.actorKind).toBe('internal');
    book.execute('v2');
    const overrideTerm = configured.version.terms.find(
      (row) => row.basis === 'OVERRIDE',
    );
    if (!overrideTerm) throw new Error('missing cloned override');
    book.addDisclosure(
      disclosure({
        overrideTermId: overrideTerm.id,
        overrideAgreementVersionId: 'v2',
      }),
    );

    const replay = await book.accrue(sale, 'v2');
    expect(replay.status).toBe('REJECTED_DUPLICATE');
    expect(replay.guard).toBe('D3');
    const historical = book.ledger
      .listObligations()
      .filter((row) => row.sourceEventId === sale.id);
    expect(historical.map((row) => row.amountAtomic).sort()).toEqual([
      1500n,
      15000n,
    ]);
    expect(historical.every((row) => row.agreementVersionId === 'v1')).toBe(
      true,
    );
    expect(historical.every((row) => row.fundingMode === 'ORG_PAYS')).toBe(
      true,
    );

    expect(book.selectExecuted('agr', sale.occurredAt)?.id).toBe('v1');
    const later = event(
      'sale-2',
      { EVENT: 100000 },
      '2026-07-01T00:00:00.000Z',
    );
    expect(book.selectExecuted('agr', later.occurredAt)?.id).toBe('v2');
    const second = await book.accrue(later, 'v2');
    expect(second.status).toBe('CREATED');
    expect(
      second.obligations.find((row) => row.beneficiaryId === 'rep')
        ?.amountAtomic,
    ).toBe(13500n);
    expect(
      book.ledger
        .listObligations()
        .filter((row) => row.sourceEventId === sale.id),
    ).toEqual(historical);
  });

  it('refuses partner and unauthorised actors when configuring the mode', () => {
    const book = new AgreementBook();
    book.addVersion({
      id: 'v1',
      agreementId: 'agr',
      versionNumber: 1,
      status: 'DRAFT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      terms: shareAndOverride(),
    });
    expect(() =>
      book.configureFunding({
        actorKind: 'api_client',
        actorId: 'partner-app',
        versionId: 'v1',
        termId: 'mgr',
        fundingMode: 'CHILD_DEDUCTION',
        deductionAuthorised: true,
        newVersionId: 'v2',
        now: '2026-05-01T00:00:00.000Z',
      }),
    ).toThrow(/internal workflow/);
    expect(book.audits).toHaveLength(0);
    expect(book.versions).toHaveLength(1);
  });
});
