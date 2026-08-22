-- Identidad estable del estado de una division.
-- Hasta ahora la visibilidad publica se decidia comparando el NOMBRE del catalogo
-- (`nombre != 'Borrador'`), y ese nombre se puede editar por API: renombrar esa fila publicaba
-- todos los borradores de golpe y rompia la creacion de divisiones.

ALTER TABLE "estados_liga" ADD COLUMN "codigo" TEXT;

-- Backfill por nombre. El ELSE es EN_CURSO y no BORRADOR a proposito: una fila ya renombrada a
-- mano no se reconoce aca, y mapearla a BORRADOR escondaria divisiones que hoy son publicas.
-- Ante la duda, visible.
UPDATE "estados_liga" SET "codigo" = CASE "nombre"
  WHEN 'Borrador'   THEN 'BORRADOR'
  WHEN 'Abierta'    THEN 'ABIERTA'
  WHEN 'En Curso'   THEN 'EN_CURSO'
  WHEN 'Finalizada' THEN 'FINALIZADA'
  WHEN 'Cancelada'  THEN 'CANCELADA'
  ELSE 'EN_CURSO'
END
WHERE "codigo" IS NULL;

ALTER TABLE "estados_liga" ALTER COLUMN "codigo" SET NOT NULL;

-- Sin indice unico: como en tipos_competencia, dos nombres pueden compartir comportamiento.
CREATE INDEX "estados_liga_codigo_idx" ON "estados_liga"("codigo");
