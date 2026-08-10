DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "rondas_playoff"
    GROUP BY "divisionId", "orden"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'No se puede agregar unicidad a rondas playoff: existen ordenes duplicados por division';
  END IF;
END $$;

DROP INDEX IF EXISTS "rondas_playoff_divisionId_orden_idx";

CREATE UNIQUE INDEX "rondas_playoff_divisionId_orden_key"
ON "rondas_playoff"("divisionId", "orden");
