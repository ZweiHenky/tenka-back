CREATE TYPE "BillingMigrationAccessStatus" AS ENUM ('PREPARED');

ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_PREPARED';

CREATE TABLE "billing_migration_accesses" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "status" "BillingMigrationAccessStatus" NOT NULL DEFAULT 'PREPARED',
  "preparedAt" TIMESTAMPTZ(3) NOT NULL,
  "preparedDivisionCount" INTEGER NOT NULL,
  "selectedFreeDivisionIdSnapshot" TEXT,
  "startedAt" TIMESTAMPTZ(3),
  "deadline" TIMESTAMPTZ(3),
  "activatedAt" TIMESTAMPTZ(3),
  "appliedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_migration_accesses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_migration_accesses_prepared_state_check" CHECK (
    "status" = 'PREPARED'
    AND "preparedDivisionCount" > 1
    AND "selectedFreeDivisionIdSnapshot" IS NULL
    AND "startedAt" IS NULL
    AND "deadline" IS NULL
    AND "activatedAt" IS NULL
    AND "appliedAt" IS NULL
  )
);

CREATE TABLE "billing_migration_divisions" (
  "id" TEXT NOT NULL,
  "migrationAccessId" TEXT NOT NULL,
  "divisionId" TEXT,
  "divisionIdSnapshot" TEXT NOT NULL,
  "divisionCreatedAtSnapshot" TIMESTAMP(3) NOT NULL,
  "leagueIdSnapshot" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_migration_divisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_migration_divisions_snapshot_values_check" CHECK (
    char_length("divisionIdSnapshot") > 0 AND char_length("leagueIdSnapshot") > 0
  )
);

CREATE UNIQUE INDEX "billing_migration_accesses_billingAccountId_key"
  ON "billing_migration_accesses"("billingAccountId");
CREATE UNIQUE INDEX "billing_migration_divisions_access_snapshot_key"
  ON "billing_migration_divisions"("migrationAccessId", "divisionIdSnapshot");
CREATE INDEX "billing_migration_divisions_division_idx"
  ON "billing_migration_divisions"("divisionId");
CREATE INDEX "billing_migration_divisions_fallback_idx"
  ON "billing_migration_divisions"("migrationAccessId", "divisionCreatedAtSnapshot", "divisionIdSnapshot");

ALTER TABLE "billing_migration_accesses" ADD CONSTRAINT "billing_migration_accesses_account_fkey"
  FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_migration_divisions" ADD CONSTRAINT "billing_migration_divisions_access_fkey"
  FOREIGN KEY ("migrationAccessId") REFERENCES "billing_migration_accesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_migration_divisions" ADD CONSTRAINT "billing_migration_divisions_division_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION enforce_billing_migration_division_snapshot()
RETURNS trigger AS $$
DECLARE
  account_user_id TEXT;
  division_owner_id TEXT;
  division_league_id TEXT;
  division_created_at TIMESTAMP(3);
BEGIN
  IF NEW."divisionId" IS NULL THEN
    RAISE EXCEPTION 'a billing migration snapshot requires a live division when inserted';
  END IF;

  SELECT account."userId"
  INTO account_user_id
  FROM "billing_migration_accesses" access
  JOIN "billing_accounts" account ON account."id" = access."billingAccountId"
  WHERE access."id" = NEW."migrationAccessId";

  SELECT league."userId", division."ligaId", division."createdAt"
  INTO division_owner_id, division_league_id, division_created_at
  FROM "divisiones" division
  JOIN "ligas" league ON league."id" = division."ligaId"
  WHERE division."id" = NEW."divisionId";

  IF account_user_id IS NULL OR division_owner_id IS NULL OR account_user_id <> division_owner_id THEN
    RAISE EXCEPTION 'billing migration division must belong to the attached billing account owner';
  END IF;
  IF NEW."divisionIdSnapshot" <> NEW."divisionId"
    OR NEW."leagueIdSnapshot" <> division_league_id
    OR NEW."divisionCreatedAtSnapshot" <> division_created_at THEN
    RAISE EXCEPTION 'billing migration division snapshots must match the live division';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_migration_divisions_snapshot_check"
BEFORE INSERT ON "billing_migration_divisions"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_migration_division_snapshot();

CREATE FUNCTION prevent_billing_migration_access_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing migration access is durable evidence';
  END IF;
  IF NEW."id" <> OLD."id"
    OR NEW."billingAccountId" <> OLD."billingAccountId"
    OR NEW."preparedAt" <> OLD."preparedAt"
    OR NEW."preparedDivisionCount" <> OLD."preparedDivisionCount"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'billing migration preparation identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_migration_accesses_durable"
BEFORE UPDATE OR DELETE ON "billing_migration_accesses"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_migration_access_mutation();

CREATE FUNCTION prevent_billing_migration_division_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing migration division snapshots are durable evidence';
  END IF;
  IF OLD."divisionId" IS NOT NULL AND NEW."divisionId" IS NULL
    AND NEW."id" = OLD."id"
    AND NEW."migrationAccessId" = OLD."migrationAccessId"
    AND NEW."divisionIdSnapshot" = OLD."divisionIdSnapshot"
    AND NEW."divisionCreatedAtSnapshot" = OLD."divisionCreatedAtSnapshot"
    AND NEW."leagueIdSnapshot" = OLD."leagueIdSnapshot"
    AND NEW."createdAt" = OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'billing migration division snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_migration_divisions_durable"
BEFORE UPDATE OR DELETE ON "billing_migration_divisions"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_migration_division_mutation();

CREATE FUNCTION prevent_billing_migration_truncate()
RETURNS trigger AS $$
BEGIN
  IF current_schema() = 'tenka_integration' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'billing migration evidence cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_migration_accesses_no_truncate"
BEFORE TRUNCATE ON "billing_migration_accesses"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_migration_truncate();
CREATE TRIGGER "billing_migration_divisions_no_truncate"
BEFORE TRUNCATE ON "billing_migration_divisions"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_migration_truncate();

CREATE FUNCTION verify_billing_migration_snapshot_count()
RETURNS trigger AS $$
DECLARE
  target_access_id TEXT;
  expected_count INTEGER;
  actual_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'billing_migration_accesses' THEN
    target_access_id := NEW."id";
  ELSE
    target_access_id := NEW."migrationAccessId";
  END IF;
  SELECT "preparedDivisionCount" INTO expected_count
  FROM "billing_migration_accesses" WHERE "id" = target_access_id;
  SELECT COUNT(*) INTO actual_count
  FROM "billing_migration_divisions" WHERE "migrationAccessId" = target_access_id;
  IF expected_count IS NOT NULL AND actual_count <> expected_count THEN
    RAISE EXCEPTION 'billing migration snapshot count does not match prepared division count';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "billing_migration_accesses_snapshot_count"
AFTER INSERT OR UPDATE ON "billing_migration_accesses"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_billing_migration_snapshot_count();
CREATE CONSTRAINT TRIGGER "billing_migration_divisions_snapshot_count"
AFTER INSERT OR UPDATE ON "billing_migration_divisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_billing_migration_snapshot_count();
