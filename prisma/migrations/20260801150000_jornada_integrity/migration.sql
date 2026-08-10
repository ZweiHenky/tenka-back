DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "jornadas"
    GROUP BY "divisionId", "numero"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'No se puede agregar unicidad a jornadas: existen numeros duplicados por division';
  END IF;
END $$;

ALTER TABLE "jornadas"
ADD COLUMN "generationKey" TEXT,
ADD COLUMN "generationRequestHash" TEXT;

DROP INDEX IF EXISTS "jornadas_divisionId_numero_idx";

CREATE UNIQUE INDEX "jornadas_divisionId_numero_key"
ON "jornadas"("divisionId", "numero");

CREATE UNIQUE INDEX "jornadas_divisionId_generationKey_key"
ON "jornadas"("divisionId", "generationKey");
