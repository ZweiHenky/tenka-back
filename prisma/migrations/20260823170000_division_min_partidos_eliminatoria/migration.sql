-- Minimo de partidos de la fase regular para poder alinear en eliminatorias.
-- 0 = sin requisito, para que las divisiones existentes no cambien de comportamiento.
ALTER TABLE "divisiones" ADD COLUMN "minPartidosEliminatoria" INTEGER NOT NULL DEFAULT 0;
