-- CreateEnum
CREATE TYPE "LadoMarcador" AS ENUM ('LOCAL', 'VISITANTE');

-- AlterTable
ALTER TABLE "partidos" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "anotaciones_partido" (
    "id" TEXT NOT NULL,
    "partidoId" TEXT NOT NULL,
    "jugadorId" TEXT,
    "equipoId" TEXT,
    "ladoMarcador" "LadoMarcador" NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "jugadorIdSnapshot" TEXT,
    "equipoIdSnapshot" TEXT,
    "jugadorNombre" TEXT,
    "equipoNombre" TEXT,
    "dorsal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anotaciones_partido_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "anotaciones_partido_cantidad_check" CHECK ("cantidad" > 0)
);

CREATE INDEX "anotaciones_partido_partidoId_ladoMarcador_idx" ON "anotaciones_partido"("partidoId", "ladoMarcador");
CREATE INDEX "anotaciones_partido_jugadorId_idx" ON "anotaciones_partido"("jugadorId");
CREATE INDEX "anotaciones_partido_equipoId_idx" ON "anotaciones_partido"("equipoId");

ALTER TABLE "anotaciones_partido" ADD CONSTRAINT "anotaciones_partido_partidoId_fkey"
  FOREIGN KEY ("partidoId") REFERENCES "partidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "anotaciones_partido" ADD CONSTRAINT "anotaciones_partido_jugadorId_fkey"
  FOREIGN KEY ("jugadorId") REFERENCES "jugadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "anotaciones_partido" ADD CONSTRAINT "anotaciones_partido_equipoId_fkey"
  FOREIGN KEY ("equipoId") REFERENCES "equipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve every existing non-zero score as one unattributed allocation per side.
INSERT INTO "anotaciones_partido" (
  "id", "partidoId", "equipoId", "equipoIdSnapshot", "ladoMarcador", "cantidad", "equipoNombre", "createdAt", "updatedAt"
)
SELECT md5(p."id" || ':LOCAL'), p."id", p."equipoLocalId", p."equipoLocalId", 'LOCAL'::"LadoMarcador",
       p."golesLocal", e."nombre", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "partidos" p
LEFT JOIN "equipos" e ON e."id" = p."equipoLocalId"
WHERE p."golesLocal" > 0;

INSERT INTO "anotaciones_partido" (
  "id", "partidoId", "equipoId", "equipoIdSnapshot", "ladoMarcador", "cantidad", "equipoNombre", "createdAt", "updatedAt"
)
SELECT md5(p."id" || ':VISITANTE'), p."id", p."equipoVisitanteId", p."equipoVisitanteId", 'VISITANTE'::"LadoMarcador",
       p."golesVisitante", e."nombre", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "partidos" p
LEFT JOIN "equipos" e ON e."id" = p."equipoVisitanteId"
WHERE p."golesVisitante" > 0;
