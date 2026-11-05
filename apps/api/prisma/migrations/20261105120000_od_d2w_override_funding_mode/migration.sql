-- OD-D2W expand-only migration.
-- New agreement, term, obligation, hold, and audit tables.
-- Does not update or delete Organization, MerchantSettings, PaymentLink, or PaymentEvent.
-- Production is not migrated by this change.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partner_api') THEN
    CREATE ROLE partner_api NOLOGIN;
  END IF;
END $$;

CREATE TABLE "agreements" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "participant_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agreement_versions" (
  "id" TEXT NOT NULL,
  "agreement_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "stacking_cap_bps" INTEGER,
  "executed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agreement_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "economic_terms" (
  "id" TEXT NOT NULL,
  "agreement_version_id" TEXT NOT NULL,
  "beneficiary_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "base_key" TEXT NOT NULL,
  "share_bps" INTEGER,
  "fixed_amount_atomic" BIGINT,
  "fixed_independent_of_base" BOOLEAN NOT NULL DEFAULT false,
  "override_bps" INTEGER,
  "child_term_id" TEXT,
  "tier_mode" TEXT,
  "tiers" JSONB,
  "funding_mode" TEXT NOT NULL DEFAULT 'ORG_PAYS',
  "deduction_authorised" BOOLEAN NOT NULL DEFAULT false,
  "stacking_cap_atomic" BIGINT,
  "obligation_eligible" BOOLEAN NOT NULL DEFAULT false,
  "commission_structure_id" TEXT NOT NULL,
  "trigger_type" TEXT NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 2,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "economic_terms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "child_deduction_disclosures" (
  "id" TEXT NOT NULL,
  "child_participant_id" TEXT NOT NULL,
  "child_agreement_version_id" TEXT NOT NULL,
  "override_agreement_version_id" TEXT NOT NULL,
  "override_term_id" TEXT NOT NULL,
  "disclosed" BOOLEAN NOT NULL,
  "statement_code" TEXT NOT NULL,
  "child_agreement_executed" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "child_deduction_disclosures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "obligations" (
  "id" TEXT NOT NULL,
  "source_event_id" TEXT NOT NULL,
  "beneficiary_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "amount_atomic" BIGINT NOT NULL,
  "gross_commission_atomic" BIGINT NOT NULL,
  "override_amount_atomic" BIGINT NOT NULL,
  "funding_mode" TEXT NOT NULL,
  "agreement_version_id" TEXT NOT NULL,
  "economic_term_id" TEXT NOT NULL,
  "commission_structure_id" TEXT NOT NULL,
  "asset_code" TEXT NOT NULL,
  "child_agreement_version_id" TEXT,
  "disclosure_id" TEXT,
  "split_group_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accrual_holds" (
  "id" TEXT NOT NULL,
  "source_event_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "agreement_version_id" TEXT,
  "financial_effect" TEXT NOT NULL DEFAULT 'NONE',
  "event_base_cap_atomic" BIGINT,
  "event_base_limit_atomic" BIGINT,
  "detail" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accrual_holds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_mode_audits" (
  "id" TEXT NOT NULL,
  "agreement_version_id" TEXT NOT NULL,
  "economic_term_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "actor_kind" TEXT NOT NULL,
  "funding_mode" TEXT NOT NULL,
  "deduction_authorised" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "funding_mode_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_relationship_proposals" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "external_ref" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "source_system" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_relationship_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agreement_versions_agreement_id_version_number_key"
  ON "agreement_versions" ("agreement_id", "version_number");
CREATE INDEX "economic_terms_agreement_version_id_idx"
  ON "economic_terms" ("agreement_version_id");
CREATE UNIQUE INDEX "obligations_d3_guard"
  ON "obligations" ("source_event_id", "beneficiary_id", "purpose");
CREATE UNIQUE INDEX "obligations_retry_idempotency"
  ON "obligations" ("source_event_id", "commission_structure_id", "beneficiary_id");
CREATE UNIQUE INDEX "accrual_holds_source_event_id_key"
  ON "accrual_holds" ("source_event_id");
CREATE UNIQUE INDEX "partner_proposals_org_source_ref_key"
  ON "partner_relationship_proposals" ("organization_id", "source_system", "external_ref");
CREATE UNIQUE INDEX "child_deduction_disclosures_term_child_key"
  ON "child_deduction_disclosures" ("override_term_id", "child_participant_id");

ALTER TABLE "agreements"
  ADD CONSTRAINT "agreements_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agreement_versions"
  ADD CONSTRAINT "agreement_versions_agreement_id_fkey"
  FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "economic_terms"
  ADD CONSTRAINT "economic_terms_agreement_version_id_fkey"
  FOREIGN KEY ("agreement_version_id") REFERENCES "agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "economic_terms"
  ADD CONSTRAINT "economic_terms_child_term_id_fkey"
  FOREIGN KEY ("child_term_id") REFERENCES "economic_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "child_deduction_disclosures"
  ADD CONSTRAINT "child_deduction_disclosures_child_agreement_version_id_fkey"
  FOREIGN KEY ("child_agreement_version_id") REFERENCES "agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "obligations"
  ADD CONSTRAINT "obligations_agreement_version_id_fkey"
  FOREIGN KEY ("agreement_version_id") REFERENCES "agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "partner_relationship_proposals"
  ADD CONSTRAINT "partner_relationship_proposals_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "economic_terms"
  ADD CONSTRAINT "economic_terms_funding_mode_check"
  CHECK ("funding_mode" IN ('ORG_PAYS', 'CHILD_DEDUCTION'));

ALTER TABLE "economic_terms"
  ADD CONSTRAINT "economic_terms_basis_check"
  CHECK ("basis" IN ('SHARE_BPS', 'FIXED_ATOMIC', 'TIERED', 'OVERRIDE'));

ALTER TABLE "economic_terms"
  ADD CONSTRAINT "economic_terms_purpose_check"
  CHECK ("purpose" IN ('COMMISSION', 'OVERRIDE', 'REFERRAL', 'RETAINER', 'BONUS'));

ALTER TABLE "economic_terms"
  ADD CONSTRAINT "economic_terms_bps_check"
  CHECK (
    ("share_bps" IS NULL OR ("share_bps" >= 0 AND "share_bps" <= 10000))
    AND ("override_bps" IS NULL OR ("override_bps" >= 0 AND "override_bps" <= 10000))
  );

ALTER TABLE "economic_terms"
  ADD CONSTRAINT "economic_terms_amounts_nonnegative_check"
  CHECK (
    ("fixed_amount_atomic" IS NULL OR "fixed_amount_atomic" >= 0)
    AND ("stacking_cap_atomic" IS NULL OR "stacking_cap_atomic" >= 0)
  );

ALTER TABLE "obligations"
  ADD CONSTRAINT "obligations_funding_mode_check"
  CHECK ("funding_mode" IN ('ORG_PAYS', 'CHILD_DEDUCTION'));

ALTER TABLE "obligations"
  ADD CONSTRAINT "obligations_amounts_nonnegative_check"
  CHECK (
    "amount_atomic" >= 0
    AND "gross_commission_atomic" >= 0
    AND "override_amount_atomic" >= 0
  );

ALTER TABLE "accrual_holds"
  ADD CONSTRAINT "accrual_holds_financial_effect_check"
  CHECK ("financial_effect" = 'NONE');

ALTER TABLE "agreement_versions"
  ADD CONSTRAINT "agreement_versions_status_check"
  CHECK ("status" IN ('DRAFT', 'EXECUTED', 'SUPERSEDED'));

COMMENT ON COLUMN "economic_terms"."funding_mode" IS
  'OD-D2W. Default ORG_PAYS. CHILD_DEDUCTION is internal-only. partner_api has no INSERT or UPDATE grant on this column.';

-- partner_api may propose relationships. It cannot write terms, funding mode, or obligations.
REVOKE ALL ON TABLE "economic_terms" FROM partner_api;
REVOKE ALL ON TABLE "economic_terms" FROM PUBLIC;
REVOKE ALL ON TABLE "agreement_versions" FROM partner_api;
REVOKE ALL ON TABLE "obligations" FROM partner_api;
REVOKE ALL ON TABLE "obligations" FROM PUBLIC;
REVOKE ALL ON TABLE "accrual_holds" FROM partner_api;
REVOKE ALL ON TABLE "funding_mode_audits" FROM partner_api;
REVOKE ALL ON TABLE "child_deduction_disclosures" FROM partner_api;
REVOKE ALL ON TABLE "agreements" FROM partner_api;

GRANT SELECT, INSERT ON TABLE "partner_relationship_proposals" TO partner_api;

CREATE OR REPLACE FUNCTION economic_terms_guard_funding_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor text := current_setting('provvy.actor_kind', true);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'economic_terms_are_append_only'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF actor IS DISTINCT FROM 'internal' THEN
      IF NEW.funding_mode IS DISTINCT FROM 'ORG_PAYS' OR NEW.deduction_authorised IS TRUE THEN
        RAISE EXCEPTION 'partner_api_cannot_set_funding_mode'
          USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'partner_api_cannot_write_economic_terms'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF actor = 'api_client'
       AND (
         NEW.funding_mode IS DISTINCT FROM OLD.funding_mode
         OR NEW.deduction_authorised IS DISTINCT FROM OLD.deduction_authorised
       ) THEN
      RAISE EXCEPTION 'partner_api_cannot_change_funding_mode'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.funding_mode IS DISTINCT FROM OLD.funding_mode
       OR NEW.deduction_authorised IS DISTINCT FROM OLD.deduction_authorised
       OR NEW.share_bps IS DISTINCT FROM OLD.share_bps
       OR NEW.override_bps IS DISTINCT FROM OLD.override_bps
       OR NEW.fixed_amount_atomic IS DISTINCT FROM OLD.fixed_amount_atomic
       OR NEW.fixed_independent_of_base IS DISTINCT FROM OLD.fixed_independent_of_base
       OR NEW.basis IS DISTINCT FROM OLD.basis
       OR NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id
       OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.child_term_id IS DISTINCT FROM OLD.child_term_id
       OR NEW.stacking_cap_atomic IS DISTINCT FROM OLD.stacking_cap_atomic
       OR NEW.base_key IS DISTINCT FROM OLD.base_key
       OR NEW.agreement_version_id IS DISTINCT FROM OLD.agreement_version_id
       OR NEW.obligation_eligible IS DISTINCT FROM OLD.obligation_eligible
       OR NEW.commission_structure_id IS DISTINCT FROM OLD.commission_structure_id
    THEN
      RAISE EXCEPTION 'economic_terms_are_immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER economic_terms_guard_funding_mode
  BEFORE INSERT OR UPDATE OR DELETE ON "economic_terms"
  FOR EACH ROW EXECUTE FUNCTION economic_terms_guard_funding_mode();

CREATE OR REPLACE FUNCTION obligations_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor text := current_setting('provvy.actor_kind', true);
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'obligations_are_append_only'
      USING ERRCODE = '55000';
  END IF;
  IF actor IS DISTINCT FROM 'internal' THEN
    RAISE EXCEPTION 'partner_api_cannot_create_obligations'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER obligations_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON "obligations"
  FOR EACH ROW EXECUTE FUNCTION obligations_append_only();

CREATE OR REPLACE FUNCTION agreement_versions_immutable_when_executed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agreement_versions_are_append_only'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'EXECUTED' THEN
    RAISE EXCEPTION 'executed_agreement_version_immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.agreement_id IS DISTINCT FROM OLD.agreement_id
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.stacking_cap_bps IS DISTINCT FROM OLD.stacking_cap_bps
  ) THEN
    RAISE EXCEPTION 'agreement_version_fields_immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' AND current_setting('provvy.actor_kind', true) IS DISTINCT FROM 'internal' THEN
    RAISE EXCEPTION 'partner_api_cannot_write_agreement_versions'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agreement_versions_immutable_when_executed
  BEFORE INSERT OR UPDATE OR DELETE ON "agreement_versions"
  FOR EACH ROW EXECUTE FUNCTION agreement_versions_immutable_when_executed();

CREATE OR REPLACE FUNCTION accrual_holds_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'accrual_holds_are_append_only'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accrual_holds_append_only
  BEFORE UPDATE OR DELETE ON "accrual_holds"
  FOR EACH ROW EXECUTE FUNCTION accrual_holds_append_only();

CREATE OR REPLACE FUNCTION funding_mode_audits_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'funding_mode_audits_are_append_only'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER funding_mode_audits_append_only
  BEFORE UPDATE OR DELETE ON "funding_mode_audits"
  FOR EACH ROW EXECUTE FUNCTION funding_mode_audits_append_only();

CREATE OR REPLACE FUNCTION child_deduction_disclosures_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'disclosures_are_append_only'
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('provvy.actor_kind', true) IS DISTINCT FROM 'internal' THEN
    RAISE EXCEPTION 'partner_api_cannot_write_disclosures'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER child_deduction_disclosures_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "child_deduction_disclosures"
  FOR EACH ROW EXECUTE FUNCTION child_deduction_disclosures_guard();
