-- Días y horario por cancha para cada división.
CREATE TABLE "divisiones_canchas_horarios" (
    "id" TEXT NOT NULL,
    "diasPartido" TEXT NOT NULL,
    "horarioPartido" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "divisionId" TEXT NOT NULL,
    "canchaId" TEXT NOT NULL,

    CONSTRAINT "divisiones_canchas_horarios_pkey" PRIMARY KEY ("id")
);

-- Backfill en abanico: una fila por cancha ACTIVA para cada división de liga multi-cancha
-- que ya tenga un horario usable. canchaUnicaId, si está puesto, restringe a esa sola cancha.
-- Las divisiones de ligas de cancha única, sin horario configurado, o cuya cancha fija está
-- inactiva no reciben filas y siguen resolviéndose por el fallback escalar.
INSERT INTO "divisiones_canchas_horarios"
  ("id", "divisionId", "canchaId", "diasPartido", "horarioPartido", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  d."id",
  c."id",
  d."diasPartido",
  d."horarioPartido",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "divisiones" d
JOIN "ligas" l         ON l."id" = d."ligaId" AND l."multiplesCanchas" = true
JOIN "ligas_canchas" c ON c."ligaId" = d."ligaId" AND c."activa" = true
WHERE COALESCE(btrim(d."diasPartido"), '') <> ''
  AND COALESCE(btrim(d."horarioPartido"), '') <> ''
  AND (d."canchaUnicaId" IS NULL OR d."canchaUnicaId" = c."id");

CREATE UNIQUE INDEX "divisiones_canchas_horarios_divisionId_canchaId_key"
  ON "divisiones_canchas_horarios"("divisionId", "canchaId");

CREATE INDEX "divisiones_canchas_horarios_canchaId_idx"
  ON "divisiones_canchas_horarios"("canchaId");

ALTER TABLE "divisiones_canchas_horarios"
  ADD CONSTRAINT "divisiones_canchas_horarios_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "divisiones_canchas_horarios"
  ADD CONSTRAINT "divisiones_canchas_horarios_canchaId_fkey"
  FOREIGN KEY ("canchaId") REFERENCES "ligas_canchas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
