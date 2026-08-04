ALTER TABLE "divisiones_jugadores" ADD COLUMN "dorsal" INTEGER;

UPDATE "divisiones_jugadores" AS dj
SET "dorsal" = ej."dorsal"
FROM "equipos_jugadores" AS ej
WHERE dj."equipoId" = ej."equipoId"
  AND dj."jugadorId" = ej."jugadorId";

ALTER TABLE "divisiones_jugadores" ALTER COLUMN "dorsal" SET NOT NULL;

ALTER TABLE "divisiones_jugadores"
DROP CONSTRAINT "divisiones_jugadores_equipoId_jugadorId_fkey";
