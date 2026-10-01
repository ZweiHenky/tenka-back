CREATE TYPE "BillingStore" AS ENUM ('APPLE', 'GOOGLE');
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');
CREATE TYPE "BillingEnvironment" AS ENUM ('PREVIEW', 'PRODUCTION');
CREATE TYPE "BillingCatalogReleaseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "billing_catalog_releases" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "status" "BillingCatalogReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_catalog_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_catalog_releases_status_dates_check" CHECK (
    ("status" = 'DRAFT' AND "activatedAt" IS NULL)
    OR ("status" IN ('ACTIVE', 'RETIRED') AND "approvedAt" IS NOT NULL AND "activatedAt" IS NOT NULL)
  )
);

CREATE TABLE "billing_product_catalog" (
  "id" TEXT NOT NULL,
  "catalogReleaseId" TEXT NOT NULL,
  "logicalProductId" TEXT NOT NULL,
  "store" "BillingStore" NOT NULL,
  "storeProductId" TEXT NOT NULL,
  "basePlanId" TEXT,
  "revenueCatOfferingId" TEXT NOT NULL,
  "revenueCatPackageId" TEXT NOT NULL,
  "revenueCatProductIdentifier" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "billingInterval" "BillingInterval" NOT NULL,
  "intervalMonths" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_product_catalog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_product_catalog_capacity_check" CHECK ("capacity" BETWEEN 2 AND 15),
  CONSTRAINT "billing_product_catalog_interval_check" CHECK (
    ("billingInterval" = 'MONTHLY' AND "intervalMonths" = 1)
    OR ("billingInterval" = 'QUARTERLY' AND "intervalMonths" = 3)
    OR ("billingInterval" = 'ANNUAL' AND "intervalMonths" = 12)
  ),
  CONSTRAINT "billing_product_catalog_logical_id_check" CHECK (
    "logicalProductId" = 'tenka_capacity_' || "capacity"::TEXT
  ),
  CONSTRAINT "billing_product_catalog_offering_id_check" CHECK (
    "revenueCatOfferingId" = 'capacity_' || "capacity"::TEXT
  ),
  CONSTRAINT "billing_product_catalog_package_id_check" CHECK (
    ("billingInterval" = 'MONTHLY' AND "revenueCatPackageId" = '$rc_monthly')
    OR ("billingInterval" = 'QUARTERLY' AND "revenueCatPackageId" = '$rc_three_month')
    OR ("billingInterval" = 'ANNUAL' AND "revenueCatPackageId" = '$rc_annual')
  ),
  CONSTRAINT "billing_product_catalog_store_plan_check" CHECK (
    ("store" = 'APPLE' AND "basePlanId" IS NULL)
    OR (
      "store" = 'GOOGLE'
      AND (
        ("billingInterval" = 'MONTHLY' AND "basePlanId" = 'monthly')
        OR ("billingInterval" = 'QUARTERLY' AND "basePlanId" = 'quarterly')
        OR ("billingInterval" = 'ANNUAL' AND "basePlanId" = 'annual')
      )
    )
  ),
  CONSTRAINT "billing_product_catalog_nonempty_ids_check" CHECK (
    btrim("storeProductId") <> ''
    AND btrim("revenueCatProductIdentifier") <> ''
  )
);

CREATE UNIQUE INDEX "billing_catalog_releases_environment_version_key"
  ON "billing_catalog_releases"("environment", "version");
CREATE INDEX "billing_catalog_releases_environment_status_idx"
  ON "billing_catalog_releases"("environment", "status");
CREATE UNIQUE INDEX "billing_catalog_releases_active_environment_key"
  ON "billing_catalog_releases"("environment") WHERE "status" = 'ACTIVE';

-- COALESCE closes PostgreSQL's NULL uniqueness gap for Apple, whose basePlanId is always NULL.
CREATE UNIQUE INDEX "billing_product_catalog_store_product_plan_key"
  ON "billing_product_catalog"(
    "catalogReleaseId", "store", "storeProductId", COALESCE("basePlanId", '')
  );
CREATE UNIQUE INDEX "billing_product_catalog_offering_package_store_key"
  ON "billing_product_catalog"(
    "catalogReleaseId", "revenueCatOfferingId", "revenueCatPackageId", "store"
  );
CREATE INDEX "billing_product_catalog_release_store_product_plan_idx"
  ON "billing_product_catalog"("catalogReleaseId", "store", "storeProductId", "basePlanId");
CREATE INDEX "billing_product_catalog_release_logical_interval_store_idx"
  ON "billing_product_catalog"("catalogReleaseId", "logicalProductId", "billingInterval", "store");

ALTER TABLE "billing_product_catalog"
  ADD CONSTRAINT "billing_product_catalog_catalogReleaseId_fkey"
  FOREIGN KEY ("catalogReleaseId") REFERENCES "billing_catalog_releases"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
