ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_SUMMARY_VIEWED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_QUEUE_VIEWED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_DETAIL_VIEWED';

CREATE INDEX "billing_migration_accesses_active_deadline_idx"
  ON "billing_migration_accesses" ("deadline", "id")
  WHERE "status" IN ('SELECTION_REQUIRED', 'SELECTED', 'PURCHASED') AND "deadline" IS NOT NULL;

CREATE INDEX "billing_migration_accesses_status_prepared_id_idx"
  ON "billing_migration_accesses" ("status", "preparedAt" DESC, "id" DESC);

CREATE INDEX "billing_audit_logs_target_created_id_idx"
  ON "billing_audit_logs" ("targetType", "targetId", "createdAt" DESC, "id" DESC);
