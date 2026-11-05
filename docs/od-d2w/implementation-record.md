# OD-D2W implementation record

Branch: `cursor/od-d2w-override-funding-ca8f`. Not merged. Not deployed. No production migration. No payment execution.

The read-only assessment is `docs/od-d2w/impact-assessment.md` (committed before the code). This note records what was built after that.

## What changed

There was no rules engine in this repository. OD-D2W is implemented inside one new calculator, `apps/api/src/economics/rules-engine.ts`. Funding mode is a step after rounded amounts and before the event-base cap. It is not a second commission engine.

`ORG_PAYS` is the default. The child obligation amount equals the calculated commission, and the override is a separate obligation.

`CHILD_DEDUCTION` is used only when the override term says so, `deductionAuthorised` is true, and exactly one affirmative disclosure on the child's executed agreement points at that term and version. Child net is calculated commission minus the rounded override. Anything missing, conflicting, or unrecognised holds the event. There is no fallback to org-pays and no partial deduction.

If deducted overrides exceed the child's commission, the event holds with `NEGATIVE_NET`. The net is not clamped to zero. No receivable is created. Half-even rounding is left as it is.

Every obligation stores `fundingMode` and `agreementVersionId`. Those fields are not part of either uniqueness key:

- D3 guard: `(source_event_id, beneficiary_id, purpose)`
- legacy retry key: `(source_event_id, commission_structure_id, beneficiary_id)`

A later agreement version that recalculates the same event is rejected. The original rows stay. Executed versions are not edited; a mode change inserts a new version and an audit row.

## Cap behaviour

Under `ORG_PAYS`, the event-base sum is child gross plus override. That is the v6.4.5–7 sum, and E19–E26 use it.

Under an authorised `CHILD_DEDUCTION`, the sum is child net plus override, which equals the child's gross. The override is counted once. The same E22 inputs at base 90,000 hold at 91,800 under `ORG_PAYS` and accrue at 90,000 under deduction (platform 72,000, child net 16,200, override 1,800).

Agreement stacking is unchanged. E25 still compares calculated retainer plus calculated override (55,000) with the agreement limit, including when the override is marked `CHILD_DEDUCTION`. Independent fixed amounts and overrides on them stay out of the event-base sum.

Activation still rejects only configurations that are provably over. An authorised child deduction does not add effective override bps, because the child's rate already contains it. E21 (effective 9,990) still passes. A raw 9,000 + 2,000 org-funded override still fails activation.

## Partner API

`PartnerProposeRelationship` has `externalRef`, `organizationId`, and `displayName` only. A body that contains `fundingMode` or `funding_mode` at any depth is rejected before storage. Accrual and disclosure requests are rejected the same way. The internal route requires `x-actor-kind: internal`.

The database does not grant `partner_api` any privilege on `economic_terms`, including `funding_mode`. It may only insert and select relationship proposals. A trigger on `provvy.actor_kind` blocks the table-owner connection (the Prisma role) from writing terms, funding mode, disclosures, agreement versions, or obligations as `api_client`. Obligations and executed agreement versions are append-only.

## Files

- `apps/api/src/economics/rules-engine.ts` — the calculator
- `apps/api/src/economics/money.ts` — half-even and largest-remainder
- `apps/api/src/economics/obligation-ledger.ts` — D3 and retry keys, in-process lock
- `apps/api/src/economics/agreement-book.ts` — versioned terms and audit
- `apps/api/src/economics/partner-write-schema.ts` — partner whitelist
- `apps/api/src/economics/internal-economics.controller.ts` — internal funding, disclosure, accrual
- `apps/api/src/economics/partner-relationships.controller.ts` — propose only
- `apps/api/src/economics/prisma-economics.repository.ts` — persists through the same engine
- `apps/api/prisma/migrations/20261105120000_od_d2w_override_funding_mode/migration.sql` — expand only
- `apps/api/prisma/schema.prisma` — new tables, plus payment-link models so the schema matches migrations that already exist
- `apps/api/src/app.module.ts` — registers the module

Merchant settings, the web app, payment links, payouts, and wallets were not changed.

## Tests

`pnpm --filter api exec jest --runInBand`: 35 passed (34 economics, 1 existing hello-world).

Economics line coverage, including the Prisma adapter that Jest does not execute: 71.91% lines (530/737), 70.46% statements, 59.91% branches, 77.63% functions. The adapter is typechecked by `nest build`. Its constraints are executed by `db-grant.runner.mjs` on PGlite, which applies every migration and then:

- shows `partner_api` has no privilege on `economic_terms.funding_mode`
- shows a column INSERT grant that omits `funding_mode` still denies an insert that sets it
- shows an insert that omits it reaches the actor trigger and is rejected
- rejects `api_client` setting `CHILD_DEDUCTION`
- rejects a second obligation on `obligations_d3_guard` when the retry key would differ
- rejects updates of obligations and of an executed agreement version

Required cases covered:

| Case | Result |
|---|---|
| Default org-funded override leaves child commission unchanged | pass |
| Explicit child deduction nets the child | pass |
| Missing authorisation holds | pass |
| Child disclosure required | pass |
| Partner API cannot set or change the mode | pass (schema, controller, role, trigger) |
| Version change does not rewrite historical obligations | pass |
| E19, E21 | pass |
| E22–E26 and E20 | pass, org-funded totals unchanged |
| Same event, org pays vs deduction | 91,800 hold vs 90,000 accrue |
| Rounding / residual | half-even and largest-remainder unchanged; deduction subtracts |
| Negative net | hold, no clamp, no receivable |
| Concurrent duplicate generation | one obligation |
| Tier worked example | marginal 95,000, whole 120,000 |

`pnpm --filter api exec eslint` and `pnpm --filter api build` passed.

## Migration

Expand only. New tables, checks, triggers, and the `partner_api` role. No changes to existing rows. `Organization`, `MerchantSettings`, `PaymentLink`, and `PaymentEvent` are not altered. Amounts are `BIGINT` atomic minor units. Holds must have `financial_effect = 'NONE'`. Obligation amounts cannot be negative.

This migration was applied only inside the PGlite test. It has not been applied to any shared or production database.

Rollback of an unreleased expand would be dropping the new objects. That drop is not in the migration.

## Security and financial integrity

- No silent funding fallback. Unknown modes hold.
- No silent clamp and no receivable on a negative net.
- Historical obligations and executed versions are immutable at the domain layer and in triggers.
- Uniqueness keys do not include funding mode or agreement version.
- Partner writes cannot set the mode even if a later grant lists other term columns.
- The application role bypasses grants, so the actor trigger is mandatory and tested.
- Integer half-even only. Fractional HTTP amounts are rejected.
- Accrual does not accept a funding mode in the request body. The mode comes from the stored version.
- G1–G4 are unchanged. Nothing here enables payment execution.

## Outstanding risks

- §11.2 rounding mode and the residual account are still OPEN. This uses the addendum's proposed half-even and largest-remainder so funding cannot replace them. It does not close that decision.
- Agreement stacking stays on calculated amounts (E25). Only the event-base sum uses post-funding payee amounts. A deduction therefore does not reduce a stacking limit.
- A funding failure holds the whole event, not one payee, so a valid sibling override is not posted either.
- An event that has already held or accrued is frozen. A later version does not silently replace that decision. Releasing a hold is a separate finance action and is not in this change.
- Prisma line coverage is zero. The SQL runner covers the constraints the adapter relies on. A full Prisma-against-Postgres test is not in CI because CI has no database service.
- `NUMERIC(78,0)` is not a second money type here. Values that do not fit in signed 64-bit integers are out of scope and must fail closed if they appear.
- DL-1 self-override is rejected inside override validation. The rest of the D3 entitlement matrix (E1–E17), AFTER_SHARES, and FX are not in this change.
- Hosted Postgres may refuse `CREATE ROLE partner_api`. The trigger still blocks `api_client` on the application connection. An operator must confirm the role exists before partner connections are used.
- `schema.prisma` now includes payment-link models that the old schema omitted. The new migration does not recreate those tables.
