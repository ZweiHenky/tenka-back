ALTER TABLE "equipos" ADD COLUMN "nombreNormalizado" TEXT;

UPDATE "equipos"
SET "nombre" = BTRIM("nombre"),
    "nombreNormalizado" = LOWER(BTRIM("nombre"));

ALTER TABLE "equipos" ALTER COLUMN "nombreNormalizado" SET NOT NULL;

CREATE UNIQUE INDEX "equipos_userId_nombreNormalizado_key"
ON "equipos"("userId", "nombreNormalizado");
