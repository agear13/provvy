import { PartnerFundingForbiddenError, PartnerWriteError } from './types';

/**
 * Partner propose body. Funding mode is intentionally absent.
 * Do not add it here; the database grant is the other half of the control.
 */
export interface PartnerProposeRelationship {
  externalRef: string;
  organizationId: string;
  displayName: string;
}

export const PARTNER_PROPOSE_KEYS = [
  'externalRef',
  'organizationId',
  'displayName',
] as const;

const FORBIDDEN_KEYS = new Set([
  'fundingmode',
  'funding_mode',
  'deductionauthorised',
  'deduction_authorised',
  'childdeduction',
  'child_deduction',
  'overridefunding',
  'override_funding',
  'funding',
]);

type AssertPartnerHasNoFunding =
  Extract<
    keyof PartnerProposeRelationship,
    | 'fundingMode'
    | 'funding_mode'
    | 'deductionAuthorised'
    | 'deduction_authorised'
  > extends never
    ? true
    : never;

const partnerSchemaHasNoFundingMode: AssertPartnerHasNoFunding = true;
void partnerSchemaHasNoFundingMode;

export function parsePartnerPropose(body: unknown): PartnerProposeRelationship {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PartnerWriteError('partner body must be an object');
  }
  assertNoFundingKeys(body, '');
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      !PARTNER_PROPOSE_KEYS.includes(
        key as (typeof PARTNER_PROPOSE_KEYS)[number],
      )
    ) {
      throw new PartnerWriteError(`unknown partner field ${key}`);
    }
  }
  const externalRef = requiredString(record.externalRef, 'externalRef');
  const organizationId = requiredString(
    record.organizationId,
    'organizationId',
  );
  const displayName = requiredString(record.displayName, 'displayName');
  return { externalRef, organizationId, displayName };
}

export function assertAccrualBodyHasNoFundingMode(body: unknown): void {
  if (body == null || typeof body !== 'object') return;
  assertNoFundingKeys(body, '');
}

function assertNoFundingKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoFundingKeys(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value == null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new PartnerFundingForbiddenError(path ? `${path}.${key}` : key);
    }
    assertNoFundingKeys(child, path ? `${path}.${key}` : key);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PartnerWriteError(`${field} is required`);
  }
  return value;
}
