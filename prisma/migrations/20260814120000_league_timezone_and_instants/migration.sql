ALTER TABLE "ubicaciones"
ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/Mexico_City';

ALTER TABLE "ligas"
ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/Mexico_City';

ALTER TABLE "partidos" DROP CONSTRAINT IF EXISTS "partidos_cancha_no_overlap";

ALTER TABLE "jornadas"
ALTER COLUMN "fechaInicio" TYPE TIMESTAMPTZ(3) USING "fechaInicio" AT TIME ZONE 'UTC',
ALTER COLUMN "fechaFin" TYPE TIMESTAMPTZ(3) USING "fechaFin" AT TIME ZONE 'UTC';

ALTER TABLE "partidos"
ALTER COLUMN "fecha" TYPE TIMESTAMPTZ(3) USING "fecha" AT TIME ZONE 'UTC',
ALTER COLUMN "fechaFin" TYPE TIMESTAMPTZ(3) USING "fechaFin" AT TIME ZONE 'UTC';

ALTER TABLE "partidos"
ADD CONSTRAINT "partidos_cancha_no_overlap"
EXCLUDE USING gist (
  "canchaId" WITH =,
  tstzrange("fecha", "fechaFin", '[)') WITH &&
)
WHERE ("canchaId" IS NOT NULL AND "fecha" IS NOT NULL AND "fechaFin" IS NOT NULL);

ALTER TABLE "partidos"
ADD CONSTRAINT "partidos_fecha_intervalo_valido"
CHECK ("fecha" IS NULL OR "fechaFin" IS NULL OR "fechaFin" > "fecha");
