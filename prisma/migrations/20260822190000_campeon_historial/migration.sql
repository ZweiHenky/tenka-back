-- El palmares deja de depender de que la division siga existiendo, y una division pasa a poder
-- acumular N campeones (uno por temporada).

-- 1. Snapshots de la division y la liga, mas el estado en que se corono. Nullable primero para
--    poder rellenarlos.
ALTER TABLE "divisiones_campeones"
  ADD COLUMN "divisionNombre" TEXT,
  ADD COLUMN "ligaId" TEXT,
  ADD COLUMN "ligaNombre" TEXT,
  ADD COLUMN "ligaLogo" TEXT,
  ADD COLUMN "divisionEstadoCodigo" TEXT,
  ADD COLUMN "archivadoEn" TIMESTAMP(3);

-- 2. Backfill desde la division actual. `divisionEstadoCodigo` toma el estado de ahora: es la mejor
--    aproximacion disponible para las filas que ya existian.
UPDATE "divisiones_campeones" c
SET "divisionNombre" = d."nombre",
    "ligaId" = l."id",
    "ligaNombre" = l."nombre",
    "ligaLogo" = l."logo",
    "divisionEstadoCodigo" = e."codigo"
FROM "divisiones" d
JOIN "ligas" l ON l."id" = d."ligaId"
JOIN "estados_liga" e ON e."id" = d."estadoLigaId"
WHERE c."divisionId" = d."id";

ALTER TABLE "divisiones_campeones"
  ALTER COLUMN "divisionNombre" SET NOT NULL,
  ALTER COLUMN "ligaNombre" SET NOT NULL,
  ALTER COLUMN "divisionEstadoCodigo" SET NOT NULL;

-- 3. La llave a la division deja de cascadear: al borrarla el titulo queda huerfano, no borrado.
ALTER TABLE "divisiones_campeones" DROP CONSTRAINT "divisiones_campeones_divisionId_fkey";
ALTER TABLE "divisiones_campeones" ALTER COLUMN "divisionId" DROP NOT NULL;
ALTER TABLE "divisiones_campeones"
  ADD CONSTRAINT "divisiones_campeones_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Varias filas por division, pero como mucho una vigente. Prisma no sabe declarar un indice
--    unico parcial, asi que va crudo. Postgres trata los NULL como distintos, de modo que los
--    huerfanos (divisionId NULL) no chocan entre si.
DROP INDEX "divisiones_campeones_divisionId_key";
CREATE UNIQUE INDEX "divisiones_campeones_division_vigente_key"
  ON "divisiones_campeones"("divisionId") WHERE "archivadoEn" IS NULL;

CREATE INDEX "divisiones_campeones_divisionId_archivadoEn_idx"
  ON "divisiones_campeones"("divisionId", "archivadoEn");
