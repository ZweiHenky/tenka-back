-- AlterTable
ALTER TABLE "divisiones" ADD COLUMN     "registrarParticipaciones" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "participaciones_partido" (
    "id" TEXT NOT NULL,
    "partidoId" TEXT NOT NULL,
    "jugadorId" TEXT,
    "equipoId" TEXT,
    "ladoMarcador" "LadoMarcador" NOT NULL,
    "jugadorIdSnapshot" TEXT NOT NULL,
    "equipoIdSnapshot" TEXT NOT NULL,
    "jugadorNombre" TEXT NOT NULL,
    "equipoNombre" TEXT NOT NULL,
    "dorsal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participaciones_partido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "participaciones_partido_partidoId_ladoMarcador_idx" ON "participaciones_partido"("partidoId", "ladoMarcador");

-- CreateIndex
CREATE INDEX "participaciones_partido_jugadorId_idx" ON "participaciones_partido"("jugadorId");

-- CreateIndex
CREATE INDEX "participaciones_partido_equipoId_idx" ON "participaciones_partido"("equipoId");

-- CreateIndex
CREATE UNIQUE INDEX "participaciones_partido_partidoId_jugadorIdSnapshot_key" ON "participaciones_partido"("partidoId", "jugadorIdSnapshot");

-- AddForeignKey
ALTER TABLE "participaciones_partido" ADD CONSTRAINT "participaciones_partido_partidoId_fkey" FOREIGN KEY ("partidoId") REFERENCES "partidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participaciones_partido" ADD CONSTRAINT "participaciones_partido_jugadorId_fkey" FOREIGN KEY ("jugadorId") REFERENCES "jugadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participaciones_partido" ADD CONSTRAINT "participaciones_partido_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "equipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
