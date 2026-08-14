ALTER TABLE "partidos"
ADD COLUMN "manualCreationKey" TEXT,
ADD COLUMN "manualCreationHash" TEXT;

CREATE UNIQUE INDEX "partidos_manualCreationKey_key"
ON "partidos"("manualCreationKey");
