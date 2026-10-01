ALTER TABLE "billing_migration_pause_applications"
  ADD COLUMN "extensionMilliseconds" BIGINT;

ALTER TABLE "billing_migration_pause_applications"
  ADD CONSTRAINT "billing_migration_pause_applications_extension_ms_check"
  CHECK ("extensionMilliseconds" IS NULL OR "extensionMilliseconds" > 0);
