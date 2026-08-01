CREATE TABLE "partidos_arbitros" (
    "partidoId" TEXT NOT NULL,
    "arbitroId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partidos_arbitros_pkey" PRIMARY KEY ("partidoId", "arbitroId")
);

INSERT INTO "partidos_arbitros" ("partidoId", "arbitroId")
SELECT "id", "arbitroId" FROM "partidos" WHERE "arbitroId" IS NOT NULL;

CREATE TABLE "tandas_arbitrales" (
    "id" TEXT NOT NULL,
    "ligaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tandas_arbitrales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tandas_arbitrales_partidos" (
    "tandaId" TEXT NOT NULL,
    "partidoId" TEXT NOT NULL,
    CONSTRAINT "tandas_arbitrales_partidos_pkey" PRIMARY KEY ("tandaId", "partidoId")
);

CREATE TABLE "disponibilidades_arbitros_tandas" (
    "id" TEXT NOT NULL,
    "tandaId" TEXT NOT NULL,
    "arbitroId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disponibilidades_arbitros_tandas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partidos_arbitros_arbitroId_idx" ON "partidos_arbitros"("arbitroId");
CREATE UNIQUE INDEX "tandas_arbitrales_ligaId_nombre_key" ON "tandas_arbitrales"("ligaId", "nombre");
CREATE INDEX "tandas_arbitrales_ligaId_idx" ON "tandas_arbitrales"("ligaId");
CREATE UNIQUE INDEX "tandas_arbitrales_partidos_partidoId_key" ON "tandas_arbitrales_partidos"("partidoId");
CREATE UNIQUE INDEX "disponibilidades_arbitros_tandas_tandaId_arbitroId_inicio_fin_key" ON "disponibilidades_arbitros_tandas"("tandaId", "arbitroId", "inicio", "fin");
CREATE INDEX "disponibilidades_arbitros_tandas_tandaId_arbitroId_idx" ON "disponibilidades_arbitros_tandas"("tandaId", "arbitroId");

ALTER TABLE "partidos_arbitros" ADD CONSTRAINT "partidos_arbitros_partidoId_fkey" FOREIGN KEY ("partidoId") REFERENCES "partidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partidos_arbitros" ADD CONSTRAINT "partidos_arbitros_arbitroId_fkey" FOREIGN KEY ("arbitroId") REFERENCES "ligas_arbitros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tandas_arbitrales" ADD CONSTRAINT "tandas_arbitrales_ligaId_fkey" FOREIGN KEY ("ligaId") REFERENCES "ligas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tandas_arbitrales_partidos" ADD CONSTRAINT "tandas_arbitrales_partidos_tandaId_fkey" FOREIGN KEY ("tandaId") REFERENCES "tandas_arbitrales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tandas_arbitrales_partidos" ADD CONSTRAINT "tandas_arbitrales_partidos_partidoId_fkey" FOREIGN KEY ("partidoId") REFERENCES "partidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disponibilidades_arbitros_tandas" ADD CONSTRAINT "disponibilidades_arbitros_tandas_tandaId_fkey" FOREIGN KEY ("tandaId") REFERENCES "tandas_arbitrales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disponibilidades_arbitros_tandas" ADD CONSTRAINT "disponibilidades_arbitros_tandas_arbitroId_fkey" FOREIGN KEY ("arbitroId") REFERENCES "ligas_arbitros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "partidos" DROP CONSTRAINT "partidos_arbitroId_fkey";
DROP INDEX "partidos_arbitroId_idx";
ALTER TABLE "partidos" DROP COLUMN "arbitroId";
