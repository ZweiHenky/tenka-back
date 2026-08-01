ALTER TABLE "ligas" ADD COLUMN "nombreNormalizado" TEXT;

UPDATE "ligas"
SET "nombre" = BTRIM("nombre"),
    "nombreNormalizado" = LOWER(BTRIM("nombre"));

ALTER TABLE "ligas" ALTER COLUMN "nombreNormalizado" SET NOT NULL;

CREATE UNIQUE INDEX "ligas_nombreNormalizado_key"
ON "ligas"("nombreNormalizado");
