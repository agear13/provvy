import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InternalEconomicsController } from './internal-economics.controller';
import { PartnerRelationshipsController } from './partner-relationships.controller';
import type { EconomicsRepository } from './economics.repository';
import {
  parsePartnerPropose,
  PARTNER_PROPOSE_KEYS,
} from './partner-write-schema';
import { PartnerFundingForbiddenError } from './types';

function repository(): jest.Mocked<EconomicsRepository> {
  return {
    proposeRelationship: jest.fn(),
    configureFunding: jest.fn(),
    accrue: jest.fn(),
    recordDisclosure: jest.fn(),
  };
}

describe('partner API funding mode', () => {
  it('does not include funding mode in the partner write schema', () => {
    expect(PARTNER_PROPOSE_KEYS).toEqual([
      'externalRef',
      'organizationId',
      'displayName',
    ]);
    const parsed = parsePartnerPropose({
      externalRef: 'ext-1',
      organizationId: 'org-1',
      displayName: 'Creator',
    });
    expect(parsed).toEqual({
      externalRef: 'ext-1',
      organizationId: 'org-1',
      displayName: 'Creator',
    });
    expect('fundingMode' in parsed).toBe(false);
  });

  it('rejects a partner body that tries to set or nest a funding mode', () => {
    expect(() =>
      parsePartnerPropose({
        externalRef: 'ext-1',
        organizationId: 'org-1',
        displayName: 'Creator',
        fundingMode: 'CHILD_DEDUCTION',
      }),
    ).toThrow(PartnerFundingForbiddenError);
    expect(() =>
      parsePartnerPropose({
        externalRef: 'ext-1',
        organizationId: 'org-1',
        displayName: 'Creator',
        terms: { funding_mode: 'ORG_PAYS' },
      }),
    ).toThrow(PartnerFundingForbiddenError);
  });

  it('does not call storage when the partner controller sees a funding field', async () => {
    const repo = repository();
    const controller = new PartnerRelationshipsController(repo);
    await expect(
      controller.propose({
        externalRef: 'ext-1',
        organizationId: 'org-1',
        displayName: 'Creator',
        fundingMode: 'CHILD_DEDUCTION',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.proposeRelationship.mock.calls).toHaveLength(0);
  });

  it('refuses partner calls to the internal funding and accrual routes', async () => {
    const repo = repository();
    const controller = new InternalEconomicsController(repo);
    await expect(
      controller.configureFunding('v1', 'mgr', 'api_client', 'partner', {
        fundingMode: 'CHILD_DEDUCTION',
        deductionAuthorised: true,
        newVersionId: 'v2',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.accrue('api_client', {
        versionId: 'v1',
        eventId: 'e1',
        occurredAt: '2026-02-01T00:00:00.000Z',
        assetCode: 'USD',
        bases: { EVENT: '100000' },
        fundingMode: 'CHILD_DEDUCTION',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.configureFunding.mock.calls).toHaveLength(0);
    expect(repo.accrue.mock.calls).toHaveLength(0);
  });

  it('rejects a non-integer accrual amount instead of rounding it', async () => {
    const repo = repository();
    const controller = new InternalEconomicsController(repo);
    try {
      await controller.accrue('internal', {
        versionId: 'v1',
        eventId: 'e1',
        occurredAt: '2026-02-01T00:00:00.000Z',
        assetCode: 'USD',
        bases: { EVENT: '100000.5' },
      });
      throw new Error('fractional atomic amount was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('integer atomic'),
        }),
      );
    }
    expect(repo.accrue.mock.calls).toHaveLength(0);
  });
});
