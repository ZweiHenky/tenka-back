ALTER TABLE "ligas_canchas" ADD COLUMN "nombreNormalizado" TEXT;

UPDATE "ligas_canchas"
SET "nombre" = BTRIM("nombre"),
    "nombreNormalizado" = LOWER(BTRIM("nombre"));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ligas_canchas"
    GROUP BY "ligaId", "nombreNormalizado"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'No se puede crear la unicidad de canchas: existen nombres duplicados por liga ignorando mayusculas y espacios';
  END IF;
END $$;

ALTER TABLE "ligas_canchas" ALTER COLUMN "nombreNormalizado" SET NOT NULL;

DROP INDEX "ligas_canchas_ligaId_nombre_key";

CREATE UNIQUE INDEX "ligas_canchas_ligaId_nombreNormalizado_key"
ON "ligas_canchas"("ligaId", "nombreNormalizado");
