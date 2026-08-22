-- Interruptor de tabla de goleo por division.
-- El DEFAULT true deja encendidas a todas las divisiones existentes: el goleo funciono siempre.
ALTER TABLE "divisiones" ADD COLUMN "registrarGoleo" BOOLEAN NOT NULL DEFAULT true;
