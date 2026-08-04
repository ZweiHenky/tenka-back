CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
DECLARE
  conflict RECORD;
BEGIN
  SELECT p1.id AS partido_id, p2.id AS conflicting_partido_id, p1."canchaId" AS cancha_id
    INTO conflict
    FROM partidos p1
    JOIN partidos p2
      ON p1.id < p2.id
     AND p1."canchaId" = p2."canchaId"
     AND tsrange(p1.fecha, p1."fechaFin", '[)') && tsrange(p2.fecha, p2."fechaFin", '[)')
   WHERE p1."canchaId" IS NOT NULL
     AND p1.fecha IS NOT NULL AND p1."fechaFin" IS NOT NULL
     AND p2.fecha IS NOT NULL AND p2."fechaFin" IS NOT NULL
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Cannot add partidos_cancha_no_overlap: court % has overlapping partidos % and %',
      conflict.cancha_id, conflict.partido_id, conflict.conflicting_partido_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM partidos
     WHERE "canchaId" IS NOT NULL
       AND fecha IS NOT NULL AND "fechaFin" IS NOT NULL
       AND "fechaFin" <= fecha
  ) THEN
    RAISE EXCEPTION 'Cannot add partidos_cancha_no_overlap: one or more partidos have fechaFin <= fecha';
  END IF;
END $$;

ALTER TABLE partidos
  ADD CONSTRAINT partidos_cancha_no_overlap
  EXCLUDE USING gist (
    "canchaId" WITH =,
    tsrange(fecha, "fechaFin", '[)') WITH &&
  )
  WHERE ("canchaId" IS NOT NULL AND fecha IS NOT NULL AND "fechaFin" IS NOT NULL);
