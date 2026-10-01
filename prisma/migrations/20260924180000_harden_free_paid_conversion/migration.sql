ALTER TABLE "free_management_grants"
ADD CONSTRAINT "free_management_grants_paid_conversion_check" CHECK (
  ("endReason" = 'PAID_CONVERSION'
    AND "endedAt" IS NOT NULL
    AND "convertedToBillingPeriodId" IS NOT NULL
    AND "convertedToAssignmentId" IS NOT NULL)
  OR
  ("endReason" IS DISTINCT FROM 'PAID_CONVERSION'
    AND "convertedToBillingPeriodId" IS NULL
    AND "convertedToAssignmentId" IS NULL)
);

CREATE UNIQUE INDEX "free_management_grants_active_account_key"
ON "free_management_grants"("billingAccountId")
WHERE "endedAt" IS NULL AND "billingAccountId" IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_free_paid_conversion()
RETURNS trigger AS $$
DECLARE
  period_account TEXT;
  assignment_period TEXT;
  assignment_source "DivisionCapacityAssignmentSource";
  assignment_slot INTEGER;
  assignment_division_snapshot TEXT;
  assignment_division_name TEXT;
  assignment_league_snapshot TEXT;
  assignment_league_name TEXT;
BEGIN
  IF NEW."endReason" IS DISTINCT FROM 'PAID_CONVERSION' THEN
    RETURN NEW;
  END IF;

  SELECT period."billingAccountId", assignment."billingPeriodId", assignment."assignmentSource",
    assignment."slotNumber", assignment."divisionIdSnapshot", assignment."divisionNameSnapshot",
    assignment."leagueIdSnapshot", assignment."leagueNameSnapshot"
  INTO period_account, assignment_period, assignment_source, assignment_slot,
    assignment_division_snapshot, assignment_division_name,
    assignment_league_snapshot, assignment_league_name
  FROM "division_capacity_assignments" assignment
  JOIN "billing_periods" period ON period."id" = assignment."billingPeriodId"
  WHERE assignment."id" = NEW."convertedToAssignmentId";

  IF period_account IS NULL
    OR NEW."billingAccountId" IS NULL
    OR period_account <> NEW."billingAccountId"
    OR assignment_period <> NEW."convertedToBillingPeriodId"
    OR assignment_source <> 'FREE_CONVERSION'
    OR assignment_slot <> 1
    OR assignment_division_snapshot <> NEW."divisionIdSnapshot"
    OR assignment_division_name <> NEW."divisionNameSnapshot"
    OR assignment_league_snapshot <> NEW."leagueIdSnapshot"
    OR assignment_league_name <> NEW."leagueNameSnapshot" THEN
    RAISE EXCEPTION 'paid conversion must match its account, period, slot and free grant snapshots';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "free_management_grants_paid_conversion_integrity"
BEFORE INSERT OR UPDATE ON "free_management_grants"
FOR EACH ROW EXECUTE FUNCTION enforce_free_paid_conversion();
