-- Elimina `canchaUnicaId`. Su unico efecto vivo era acotar el fallback legacy de
-- `resolveDivisionSchedule` a una sola cancha, para las divisiones sin filas por cancha.
--
-- Antes de borrarla se convierte ese estado implicito en una fila explicita: una division con
-- cancha fija y sin filas pasa a tener exactamente esa fila, que produce el mismo resultado
-- (una sola cancha configurada) por el camino normal.
--
-- Se acota a ligas multi-cancha porque con `multiplesCanchas = false` la columna ya se ignoraba,
-- y a divisiones con dias y horario, que son NOT NULL en la tabla destino.
INSERT INTO "divisiones_canchas_horarios" ("id", "divisionId", "canchaId", "diasPartido", "horarioPartido", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, d."id", d."canchaUnicaId", d."diasPartido", d."horarioPartido", NOW(), NOW()
FROM "divisiones" d
JOIN "ligas" l ON l."id" = d."ligaId"
WHERE d."canchaUnicaId" IS NOT NULL
  AND l."multiplesCanchas" = true
  AND d."diasPartido" IS NOT NULL
  AND d."horarioPartido" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "divisiones_canchas_horarios" h WHERE h."divisionId" = d."id"
  );

ALTER TABLE "divisiones" DROP COLUMN "canchaUnicaId";
