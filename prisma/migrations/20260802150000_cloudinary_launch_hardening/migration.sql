-- Existing jobs were not unique. Keep the oldest job and its highest attempt count.
LOCK TABLE media_deletion_jobs IN ACCESS EXCLUSIVE MODE;

WITH ranked AS (
  SELECT id, "publicId",
         ROW_NUMBER() OVER (PARTITION BY "publicId" ORDER BY "createdAt", id) AS rn,
         MAX(attempts) OVER (PARTITION BY "publicId") AS max_attempts
  FROM media_deletion_jobs
), updated AS (
  UPDATE media_deletion_jobs j
  SET attempts = ranked.max_attempts
  FROM ranked
  WHERE j.id = ranked.id AND ranked.rn = 1
)
DELETE FROM media_deletion_jobs j
USING ranked
WHERE j.id = ranked.id AND ranked.rn > 1;

CREATE TYPE "MediaKind" AS ENUM ('LEAGUE_LOGO', 'LEAGUE_COVER', 'TEAM_LOGO', 'ACCOUNT_AVATAR', 'PLAYER_PHOTO');
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'UPLOADED', 'ATTACHED', 'ABANDONED', 'DEAD');
CREATE TYPE "MediaDeletionStatus" AS ENUM ('PENDING', 'LEASED', 'DEAD');

ALTER TABLE media_deletion_jobs
  ADD COLUMN status "MediaDeletionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "lockedBy" TEXT,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "deadAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "media_deletion_jobs_nextTryAt_idx";
CREATE UNIQUE INDEX "media_deletion_jobs_publicId_key" ON media_deletion_jobs("publicId");
CREATE INDEX "media_deletion_jobs_status_nextTryAt_leaseUntil_idx" ON media_deletion_jobs(status, "nextTryAt", "leaseUntil");

CREATE TABLE media_assets (
  id TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  kind "MediaKind" NOT NULL,
  "publicId" TEXT NOT NULL,
  "secureUrl" TEXT,
  format TEXT,
  bytes INTEGER,
  width INTEGER,
  height INTEGER,
  status "MediaStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attachedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY (id),
  CONSTRAINT "media_assets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "media_assets_publicId_key" ON media_assets("publicId");
CREATE INDEX "media_assets_ownerId_status_idx" ON media_assets("ownerId", status);
CREATE INDEX "media_assets_status_expiresAt_idx" ON media_assets(status, "expiresAt");
