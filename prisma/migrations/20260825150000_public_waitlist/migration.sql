CREATE TYPE "WaitlistRole" AS ENUM ('ORGANIZADOR', 'CAPITAN', 'AFICIONADO');

CREATE TABLE "waitlist_entries" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "role" "WaitlistRole",
  "source" TEXT,
  "consentAt" TIMESTAMP(3) NOT NULL,
  "consentNoticeVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waitlist_entries_emailNormalized_key"
  ON "waitlist_entries"("emailNormalized");

CREATE INDEX "waitlist_entries_createdAt_idx"
  ON "waitlist_entries"("createdAt");
