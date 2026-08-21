-- Identidad estable del formato de competencia.
-- Hasta ahora la app decidía qué mostrar comparando el NOMBRE del catálogo como texto
-- (`nombre.includes('Eliminatorias')`), y ese nombre se puede editar por API. `codigo` es lo
-- que pasa a leer la app.

ALTER TABLE "tipos_competencia" ADD COLUMN "codigo" TEXT;

-- Todas las filas existentes se comportaron siempre como liga + eliminatorias, se llamen como
-- se llamen. Sin índice único: dos nombres distintos pueden compartir comportamiento.
UPDATE "tipos_competencia" SET "codigo" = 'LIGA_Y_ELIMINATORIAS' WHERE "codigo" IS NULL;

ALTER TABLE "tipos_competencia" ALTER COLUMN "codigo" SET NOT NULL;

CREATE INDEX "tipos_competencia_codigo_idx" ON "tipos_competencia"("codigo");

INSERT INTO "tipos_competencia" ("id", "nombre", "codigo")
SELECT gen_random_uuid()::text, 'Eliminatoria', 'ELIMINATORIA'
WHERE NOT EXISTS (SELECT 1 FROM "tipos_competencia" WHERE "codigo" = 'ELIMINATORIA');
