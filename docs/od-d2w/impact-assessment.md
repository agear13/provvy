# OD-D2W impact assessment (read-only)

Date: 5 Nov 2026. Branch intended: `cursor/od-d2w-override-funding-ca8f`.
Authority: Alisha approval OD-D2W Option C, plus PAL review checks (cap under deduction, negative net, versioned funding mode, partner grant block).
This note was written before implementation. It records what the repository actually contains.

## Decision being implemented

Organisation pays overrides by default (`ORG_PAYS`). `CHILD_DEDUCTION` is allowed only when the override agreement explicitly authorises it, the child's executed agreement discloses it, and the terms are versioned. The partner API cannot set or change the mode. Missing, ambiguous, or invalid authorisation holds the accrual for review. Historical obligations are not rewritten when a later agreement version changes the mode.

Addendum A v6.4.5–7 cap rules stay as specified. Who-pays was an OPEN parameter in that addendum (§24 example 10, §46 D2). OD-D2W closes only that parameter.

## What this repository actually contains

Provvypay on `main` (`5305528`) is a NestJS API plus a Next.js app:

| Area | Location | Relevant to OD-D2W |
|---|---|---|
| Merchant settings CRUD | `apps/api/src/merchant-settings/` | No. Display name, logo, currencies. No economic terms. |
| Payment links (SQL only) | `apps/api/prisma/migrations/20251112064847_add_payment_links`, `20251113070836_add_payment_intent_id` | No. `amountMinor INTEGER` is the only money column. Schema drift: these tables are not in `schema.prisma`. |
| Prisma client | `apps/api/src/prisma/` | Connection shell only. |
| Web settings / uploads | `apps/web/src/app/settings/`, `apps/web/src/app/api/` | No partner or agreement API. Settings save is still a mock. |
| Tests | `apps/api/src/app.controller.spec.ts`, `apps/api/test/app.e2e-spec.ts` | Hello-world only. No financial calculation tests. |
| CI | `.github/workflows/ci.yml` | `pnpm lint`, `pnpm test`, `pnpm build`. No Postgres service. |

Searches for override, commission, obligation, agreement version, funding mode, and cap calculations return no application code.

## Canonical calculation and obligation services

There is no rules engine, no obligation service, and no economic-term model in this codebase. There is therefore nothing to call, and nothing that may be copied into a second calculator.

The addendum's canonical calculator is the single rules engine: `(AgreementVersion, event) → obligation drafts + trace` (§24), integer atomic units, basis order FIXED → SHARE/TIERED → OVERRIDE, then cap, then rounding, then one obligation per payee. OD-D2W has to be a step inside that one engine (funding allocation after the rounded amounts, before the event-base cap and before insert). It must not be a parallel commission implementation.

Because the engine is absent, this change introduces it once, at `apps/api/src/economics/`, and puts funding mode inside it. Merchant settings, payment links, payouts, and wallets stay out of the engine.

## Addendum rules the engine must preserve

Override amount (D2, v6.4.5), unchanged by who-pays:

`override_amount = child_commission_amount × override_bps / 10000`

on the child's actual calculated commission. Never on another override (E19).

Event-base cap (v6.4.5–7), for the default org-funded case the addendum describes:

Σ event-based payee amounts ≤ event base (and ≤ `stacking_cap_bps` when that is lower). Independent `fixed_independent_of_base` amounts and overrides calculated on them are outside that Σ (v6.4.6) and remain under the agreement stacking limit. Activation rejects only configurations that are provably over. FIXED children and different-base children pass activation and are checked at accrual. A breach holds the whole event `CAP_EXCEEDED` with no prorate, redistribution, or partial payment (v6.4.7).

Specified outcomes that must stay numerically the same under default `ORG_PAYS` (no deduction authorisation):

| Case | Expected |
|---|---|
| E19 | Override-on-override rejected. Multiple overrides on the child's commission still allowed inside the cap. |
| E20 | FIXED above its base without `fixed_independent_of_base` → HOLD `EXCEEDS_BASE`, not a hard reject. With the flag, accepted. |
| E21 | Share 9000 bps + override 1100 bps. Raw 10100 bps, effective `1100 × 9000 / 10000 = 990`, total 9990 ≤ 10000. Accept. |
| E22 | Activation accepts. Base 90,000: 72,000 + 18,000 + 1,800 = 91,800 → whole event HOLD `CAP_EXCEEDED`, no obligations. Worked example 5b at base 100,000 (99,800) still accrues. |
| E23 | Tier max 9500 + effective 950 = 10450 > 10000 → reject at activation. |
| E24 | Accrual breach is HOLD only. No partial amount is produced. |
| E25 | Event-base Σ = 24,000 ≤ 30,000, no `CAP_EXCEEDED`. Stacking (a) 55,000 ≤ 60,000 accept. (b) 55,000 > 50,000 reject at activation. Knowable only at accrual → HOLD, not prorated. |
| E26 | Activation accepts. Accrual 168,000 > 100,000 HOLD `CAP_EXCEEDED`. Control: gross booking 40,000 → Σ 88,800 accrues. |

Rounding (§24, half-even and largest-remainder still PROPOSED / OPEN under §11.2): one deterministic half-even rounding to atomic units per payee amount. Split-pool residual uses largest remainder, tie-break `member_id` ascending. Funding mode may only subtract already-rounded integers. It must not re-round, change the residual method, or post a residual obligation to absorb a deduction.

Obligation identity (§42), which PAL says must stay as they are:

- Authoritative guard: `UNIQUE (source_event_id, beneficiary_id, purpose)`.
- Legacy retry key only: `UNIQUE (source_event_id, commission_structure_id, payee)`.
- Neither key gains `funding_mode` or `agreement_version_id`. A new version that recalculates the same event collides with the guard and is rejected. The original row stays.

Partner commercial-term writes are already forbidden by Addendum A decision 1 (§14), enforced in the database rather than only in the API. This repo has no such policy yet.

## PAL checks (design constraints, not optional)

1. **Cap under `CHILD_DEDUCTION`.** Payee amounts are the child's net plus the override, which equals the child's gross commission. The event-base Σ sums those payee amounts, so the override is counted once. Summing child gross plus override under a deduction double-counts and can raise a false `CAP_EXCEEDED`. The same inputs under `ORG_PAYS` sum child gross plus override, because the org funds both. E22–E26 stay on default `ORG_PAYS` and keep the totals above. Agreement stacking for v6.4.6 (calculated retainer + calculated override, E25 = 55,000) is not rewritten when the mode changes: that sum is not the event-base Σ.

2. **Negative net.** If the rounded overrides deducted from a child exceed that child's rounded commission, the accrual HOLDs (`NEGATIVE_NET`). No clamp to zero. No receivable row. Half-even results are left as they are even when they are what pushes the net below zero.

3. **Mode lives on the versioned term.** Every obligation stores `funding_mode` and `agreement_version_id`. Those columns are not part of either uniqueness key.

4. **Partner API.** `fundingMode` is absent from the partner write schema. PostgreSQL grants do not give `partner_api` INSERT or UPDATE on `economic_terms.funding_mode` (or on economic terms at all). The application role is the table owner, so grants alone do not bind it. A trigger on `provvy.actor_kind = 'api_client'` is required as well. Both ship. A missing form field is not the control.

## Behaviour the implementation will enforce

### `ORG_PAYS` (default)

Omitted mode, or explicit `ORG_PAYS` with deduction not authorised: the org funds the override. The child obligation amount equals the calculated commission. The override is a separate obligation. Both rows record `ORG_PAYS` and the agreement version used.

Explicit `ORG_PAYS` together with `deductionAuthorised = true` is ambiguous and HOLDs. It does not deduct and it does not silently ignore the flag.

### `CHILD_DEDUCTION`

All of the following must be true, or the whole event HOLDs and no obligation is inserted (no partial deduction, no fallback to `ORG_PAYS`):

- Term `fundingMode` is exactly `CHILD_DEDUCTION`.
- `deductionAuthorised` is exactly true on that versioned term.
- One affirmative disclosure on the child's executed agreement version, referencing this override term and this agreement version, with a non-empty statement code.
- Rounded child net = rounded child commission − rounded deducted overrides, and that net is ≥ 0.

The child obligation amount is the net. The override obligation is unchanged in amount. Both record `CHILD_DEDUCTION`, the agreement version, and the child agreement version.

Invalid mode strings are not coerced. They HOLD as ambiguous.

### Holds

Holds are review records with `financial_effect = NONE`. They are not obligations and not receivables. `CAP_EXCEEDED`, `EXCEEDS_BASE`, stacking, funding authorisation, missing disclosure, ambiguous funding, and negative net all post nothing for that event. A repeated accrual returns the existing hold or the existing obligations and does not create a second financial row.

### History

Executed agreement versions and posted obligations are immutable. A mode change inserts a new agreement version and an audit row. Obligations already stored keep their amount, mode, and version id. A later event uses the version effective for that event.

## Planned files

New:

- `apps/api/src/economics/` — types, integer money, the one rules engine, agreement versions, obligation ledger, partner write schema, internal funding workflow, Nest controllers, Prisma store.
- `apps/api/src/economics/*.spec.ts` — the required cases, E19–E26, rounding, idempotency, partner schema, database grants.
- `apps/api/prisma/migrations/20261105120000_od_d2w_override_funding_mode/migration.sql` — expand only.

Touched:

- `apps/api/prisma/schema.prisma` — new tables, and the existing payment-link models added so the schema matches migrations already applied (no drop).
- `apps/api/src/app.module.ts` — register the economics module.
- `apps/api/package.json` — dev dependency for a hermetic Postgres engine so the grant test runs without a shared database.

Not touched: merchant settings, web settings, payment execution, wallets, payouts, cap formulas for E22–E26 under `ORG_PAYS`.

## Migration assessment (planned)

Expand-only. New tables, roles, grants, checks, and triggers. No update of existing rows. No destructive change. `Organization`, `MerchantSettings`, `PaymentLink`, and `PaymentEvent` stay. Production is not migrated in this work. Rollback of an unreleased expand is dropping the new objects only; that drop is not part of the migration shipped here.

Integer columns are `BIGINT` atomic minor units (the same integer-minor convention as `PaymentLink.amountMinor`, with 64-bit range). Amounts that are not integers are rejected. `NUMERIC(78,0)` from the asset-registry wording is not introduced as a second money type in the engine. Values that do not fit in signed 64-bit are out of scope and must fail closed if they appear later.

## Out of scope

Payouts, wallets, payment execution, real funds, production data, merge, deploy. Full D3 entitlement matrix beyond the obligation guard (E1–E17 except where the guard itself is E18/E11). DL-1 self-override. AFTER_SHARES, FX, tier-period calendars beyond what E23 needs. §11.2 is not decided here: half-even and largest-remainder are implemented only as the addendum's proposed method so funding cannot silently replace them. G1–G4 are unchanged.

## Risks noted before coding

- Schema drift on payment links. Aligning `schema.prisma` with the existing SQL must not generate a drop.
- Table-owner connections bypass `GRANT`. The trigger has to be tested, not only the privilege catalog.
- A deduction-aware event cap will change totals versus a blind gross+override sum. That is required by PAL. It must not change E22–E26, which are specified without deduction authorisation.
- Holding the whole event when any one override's authorisation is invalid avoids a partial deduction. It is stricter than holding a single payee. Recorded here so PAL can see it.
- Agreement stacking stays on calculated amounts (E25). Only the event-base Σ uses post-funding payee amounts.
