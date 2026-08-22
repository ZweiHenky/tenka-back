-- Campeon de division: equipo ganador y, opcionalmente, campeon de goleo.
-- Una sola fila por division; los snapshots sobreviven a la baja del equipo o del jugador.
CREATE TABLE "divisiones_campeones" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "equipoId" TEXT,
    "equipoNombre" TEXT NOT NULL,
    "equipoLogo" TEXT,
    "jugadorId" TEXT,
    "jugadorNombre" TEXT,
    "jugadorFoto" TEXT,
    "jugadorGoles" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "divisiones_campeones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "divisiones_campeones_divisionId_key" ON "divisiones_campeones"("divisionId");

CREATE INDEX "divisiones_campeones_equipoId_idx" ON "divisiones_campeones"("equipoId");

CREATE INDEX "divisiones_campeones_jugadorId_idx" ON "divisiones_campeones"("jugadorId");

ALTER TABLE "divisiones_campeones" ADD CONSTRAINT "divisiones_campeones_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "divisiones_campeones" ADD CONSTRAINT "divisiones_campeones_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "equipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "divisiones_campeones" ADD CONSTRAINT "divisiones_campeones_jugadorId_fkey" FOREIGN KEY ("jugadorId") REFERENCES "jugadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
