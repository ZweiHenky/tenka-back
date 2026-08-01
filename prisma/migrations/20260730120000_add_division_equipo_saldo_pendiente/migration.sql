ALTER TABLE "divisiones_equipos"
ADD COLUMN "saldoPendiente" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "divisiones_equipos"
ADD CONSTRAINT "divisiones_equipos_saldoPendiente_nonnegative"
CHECK ("saldoPendiente" >= 0);
