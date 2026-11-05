import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');

const db = new PGlite();
const files = [
  '20251109034539_init/migration.sql',
  '20251112064847_add_payment_links/migration.sql',
  '20251113070836_add_payment_intent_id/migration.sql',
  '20261105120000_od_d2w_override_funding_mode/migration.sql',
];
for (const file of files) {
  await db.exec(readFileSync(join(root, file), 'utf8'));
}

const indexes = await db.query(
  `SELECT indexname, indexdef FROM pg_indexes
   WHERE indexname IN ('obligations_d3_guard', 'obligations_retry_idempotency')
   ORDER BY indexname`,
);
assert.deepEqual(
  indexes.rows.map((row) => row.indexname),
  ['obligations_d3_guard', 'obligations_retry_idempotency'],
);
for (const row of indexes.rows) {
  assert.equal(row.indexdef.toLowerCase().includes('funding_mode'), false);
  assert.equal(row.indexdef.toLowerCase().includes('agreement_version'), false);
}

const fundingGrants = await db.query(
  `SELECT privilege_type FROM information_schema.column_privileges
   WHERE grantee = 'partner_api'
     AND table_name = 'economic_terms'
     AND column_name = 'funding_mode'`,
);
assert.equal(fundingGrants.rows.length, 0);

const termGrants = await db.query(
  `SELECT privilege_type FROM information_schema.table_privileges
   WHERE grantee = 'partner_api' AND table_name = 'economic_terms'`,
);
assert.equal(termGrants.rows.length, 0);

const proposalGrants = await db.query(
  `SELECT privilege_type FROM information_schema.table_privileges
   WHERE grantee = 'partner_api' AND table_name = 'partner_relationship_proposals'
   ORDER BY privilege_type`,
);
assert.deepEqual(
  proposalGrants.rows.map((row) => row.privilege_type),
  ['INSERT', 'SELECT'],
);

await expectReject(
  () =>
    db.exec(`
      SET ROLE partner_api;
      INSERT INTO economic_terms (
        id, agreement_version_id, beneficiary_id, purpose, basis, base_key,
        commission_structure_id, trigger_type, funding_mode, deduction_authorised
      ) VALUES (
        't-partner', 'v1', 'mgr', 'OVERRIDE', 'OVERRIDE', 'EVENT',
        'v1', 'SALE', 'CHILD_DEDUCTION', true
      );
    `),
  /permission denied/i,
);
await db.exec('RESET ROLE');

await db.exec('BEGIN');
await db.exec(`
  GRANT INSERT (
    id, agreement_version_id, beneficiary_id, purpose, basis, base_key,
    commission_structure_id, trigger_type, level, obligation_eligible,
    fixed_independent_of_base, created_at
  ) ON economic_terms TO partner_api
`);
await db.exec('SAVEPOINT before_column_grant');
await expectReject(
  () =>
    db.exec(`
      SET LOCAL ROLE partner_api;
      INSERT INTO economic_terms (
        id, agreement_version_id, beneficiary_id, purpose, basis, base_key,
        commission_structure_id, trigger_type, funding_mode
      ) VALUES (
        't-col', 'v1', 'mgr', 'OVERRIDE', 'OVERRIDE', 'EVENT',
        'v1', 'SALE', 'CHILD_DEDUCTION'
      );
    `),
  /permission denied/i,
);
await db.exec('ROLLBACK TO SAVEPOINT before_column_grant');
await expectReject(
  () =>
    db.exec(`
      SET LOCAL ROLE partner_api;
      INSERT INTO economic_terms (
        id, agreement_version_id, beneficiary_id, purpose, basis, base_key,
        commission_structure_id, trigger_type
      ) VALUES (
        't-col', 'v1', 'mgr', 'OVERRIDE', 'OVERRIDE', 'EVENT',
        'v1', 'SALE'
      );
    `),
  /partner_api_cannot_write_economic_terms/,
);
await db.exec('ROLLBACK');

await asInternal(
  `
    INSERT INTO "Organization" (id, "clerkOrgId", "createdAt", "updatedAt")
    VALUES ('org-1', 'clerk-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    INSERT INTO agreements (id, organization_id)
    VALUES ('agr-1', 'org-1');
    INSERT INTO agreement_versions (id, agreement_id, version_number, status, effective_from)
    VALUES ('v1', 'agr-1', 1, 'EXECUTED', CURRENT_TIMESTAMP);
    INSERT INTO economic_terms (
      id, agreement_version_id, beneficiary_id, purpose, basis, base_key,
      share_bps, obligation_eligible, commission_structure_id, trigger_type, funding_mode
    ) VALUES (
      'rep', 'v1', 'rep', 'COMMISSION', 'SHARE_BPS', 'EVENT',
      1500, true, 'v1', 'SALE', 'ORG_PAYS'
    );
  `,
);

await expectReject(
  () =>
    asInternal(
      `
        INSERT INTO economic_terms (
          id, agreement_version_id, beneficiary_id, purpose, basis, base_key,
          override_bps, child_term_id, obligation_eligible, commission_structure_id,
          trigger_type, funding_mode, deduction_authorised
        ) VALUES (
          'mgr-bad', 'v1', 'mgr', 'OVERRIDE', 'OVERRIDE', 'EVENT',
          1000, 'rep', true, 'v1', 'SALE', 'CHILD_DEDUCTION', true
        );
      `,
      'api_client',
    ),
  /partner_api_cannot_set_funding_mode/,
);

await asInternal(
  `
    INSERT INTO economic_terms (
      id, agreement_version_id, beneficiary_id, purpose, basis, base_key,
      override_bps, child_term_id, obligation_eligible, commission_structure_id,
      trigger_type, funding_mode
    ) VALUES (
      'mgr', 'v1', 'mgr', 'OVERRIDE', 'OVERRIDE', 'EVENT',
      1000, 'rep', true, 'v1', 'SALE', 'ORG_PAYS'
    );
    INSERT INTO obligations (
      id, source_event_id, beneficiary_id, purpose, amount_atomic,
      gross_commission_atomic, override_amount_atomic, funding_mode,
      agreement_version_id, economic_term_id, commission_structure_id,
      asset_code, split_group_id
    ) VALUES (
      'ob-1', '123', 'rep', 'COMMISSION', 15000,
      15000, 0, 'ORG_PAYS',
      'v1', 'rep', 'structure-a',
      'USD', '123'
    );
  `,
);

await expectReject(
  () =>
    asInternal(
      `
        INSERT INTO obligations (
          id, source_event_id, beneficiary_id, purpose, amount_atomic,
          gross_commission_atomic, override_amount_atomic, funding_mode,
          agreement_version_id, economic_term_id, commission_structure_id,
          asset_code, split_group_id
        ) VALUES (
          'ob-2', '123', 'rep', 'COMMISSION', 1,
          1, 0, 'CHILD_DEDUCTION',
          'v2', 'rep', 'structure-b',
          'USD', '123'
        );
      `,
    ),
  /obligations_d3_guard/,
);

await expectReject(
  () => asInternal(`UPDATE obligations SET amount_atomic = 1 WHERE id = 'ob-1'`),
  /obligations_are_append_only/,
);

await expectReject(
  () => asInternal(`UPDATE agreement_versions SET stacking_cap_bps = 1 WHERE id = 'v1'`),
  /executed_agreement_version_immutable/,
);

const remaining = await db.query(
  `SELECT amount_atomic::text AS amount_atomic, funding_mode
   FROM obligations WHERE id = 'ob-1'`,
);
assert.deepEqual(remaining.rows, [{ amount_atomic: '15000', funding_mode: 'ORG_PAYS' }]);
await db.close();

async function asInternal(sql, actor = 'internal') {
  await db.exec('BEGIN');
  try {
    await db.exec(`SELECT set_config('provvy.actor_kind', '${actor}', true)`);
    await db.exec(sql);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function expectReject(fn, pattern) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected ${pattern}`);
  const message = caught instanceof Error ? `${caught.message}\n${caught.stack ?? ''}` : String(caught);
  assert.match(message, pattern, message);
}
