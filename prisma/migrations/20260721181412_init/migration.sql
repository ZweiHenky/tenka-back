-- CreateEnum
CREATE TYPE "UserRol" AS ENUM ('CAPITAN', 'LIGA', 'ADMINISTRADOR');

-- CreateEnum
CREATE TYPE "TipoPartido" AS ENUM ('REGULAR', 'AMISTOSO', 'COMPLEMENTO', 'ELIMINATORIA');

-- CreateEnum
CREATE TYPE "EstadoPartido" AS ENUM ('PROGRAMADO', 'EN_JUEGO', 'FINALIZADO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "PosicionJugador" AS ENUM ('PORTERO', 'DEFENSA', 'LATERAL', 'CONTENCION', 'MEDIO', 'EXTREMO', 'DELANTERO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "image" TEXT,
    "imagePublicId" TEXT,
    "phoneNumber" TEXT,
    "phoneNumberVerified" BOOLEAN NOT NULL DEFAULT false,
    "showPhoneInPublicLeague" BOOLEAN NOT NULL DEFAULT false,
    "rol" "UserRol" NOT NULL DEFAULT 'CAPITAN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "jugadorId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "tipos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ubicaciones" (
    "id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "nombreCompleto" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "municipio" TEXT NOT NULL,

    CONSTRAINT "ubicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estados_liga" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "estados_liga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_competencia" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "tipos_competencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ligas" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "logo" TEXT,
    "logoPublicId" TEXT,
    "cancha" TEXT,
    "canchaPublicId" TEXT,
    "multiplesCanchas" BOOLEAN NOT NULL DEFAULT false,
    "usaArbitros" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ubicacionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ligas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ligas_canchas" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ligaId" TEXT NOT NULL,

    CONSTRAINT "ligas_canchas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ligas_arbitros" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ligaId" TEXT NOT NULL,

    CONSTRAINT "ligas_arbitros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "divisiones" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "maxEquipos" INTEGER NOT NULL,
    "arbitraje" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "diasPartido" TEXT,
    "horarioPartido" TEXT,
    "duracionPartido" INTEGER,
    "descanso" INTEGER,
    "fechaInicio" TIMESTAMP(3),
    "fechaFin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ligaId" TEXT NOT NULL,
    "estadoLigaId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "tipoId" TEXT NOT NULL,
    "tipoCompetenciaId" TEXT NOT NULL,

    CONSTRAINT "divisiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "logo" TEXT,
    "logoPublicId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "equipos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jugadores" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "posicion" "PosicionJugador" NOT NULL,
    "foto" TEXT,
    "fotoPublicId" TEXT,
    "edad" INTEGER,
    "telefono" TEXT,
    "userId" TEXT,
    "showPhoneInPublicProfile" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jugadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipos_jugadores" (
    "equipoId" TEXT NOT NULL,
    "jugadorId" TEXT NOT NULL,
    "dorsal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipos_jugadores_pkey" PRIMARY KEY ("equipoId","jugadorId")
);

-- CreateTable
CREATE TABLE "divisiones_equipos" (
    "divisionId" TEXT NOT NULL,
    "equipoId" TEXT NOT NULL,

    CONSTRAINT "divisiones_equipos_pkey" PRIMARY KEY ("divisionId","equipoId")
);

-- CreateTable
CREATE TABLE "divisiones_jugadores" (
    "divisionId" TEXT NOT NULL,
    "equipoId" TEXT NOT NULL,
    "jugadorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "divisiones_jugadores_pkey" PRIMARY KEY ("divisionId","equipoId","jugadorId")
);

-- CreateTable
CREATE TABLE "premios" (
    "id" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "monto" DECIMAL(65,30),
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "divisionId" TEXT NOT NULL,

    CONSTRAINT "premios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jornadas" (
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "fechaInicio" TIMESTAMP(3),
    "fechaFin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "divisionId" TEXT NOT NULL,

    CONSTRAINT "jornadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rondas_playoff" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "divisionId" TEXT NOT NULL,

    CONSTRAINT "rondas_playoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partidos" (
    "id" TEXT NOT NULL,
    "golesLocal" INTEGER NOT NULL DEFAULT 0,
    "golesVisitante" INTEGER NOT NULL DEFAULT 0,
    "penalesLocal" INTEGER,
    "penalesVisitante" INTEGER,
    "fecha" TIMESTAMP(3),
    "fechaFin" TIMESTAMP(3),
    "estado" "EstadoPartido",
    "llave" INTEGER,
    "tipoPartido" "TipoPartido" NOT NULL DEFAULT 'REGULAR',
    "exhibicionLocal" BOOLEAN NOT NULL DEFAULT false,
    "exhibicionVisitante" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "jornadaId" TEXT,
    "rondaPlayoffId" TEXT,
    "equipoLocalId" TEXT,
    "equipoVisitanteId" TEXT,
    "canchaId" TEXT,
    "arbitroId" TEXT,

    CONSTRAINT "partidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partidos_referee_access" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "partidoId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "partidos_referee_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tablas_posicion" (
    "id" TEXT NOT NULL,
    "partidosJugados" INTEGER NOT NULL DEFAULT 0,
    "ganados" INTEGER NOT NULL DEFAULT 0,
    "empatados" INTEGER NOT NULL DEFAULT 0,
    "perdidos" INTEGER NOT NULL DEFAULT 0,
    "golesFavor" INTEGER NOT NULL DEFAULT 0,
    "golesContra" INTEGER NOT NULL DEFAULT 0,
    "diferenciaGoles" INTEGER NOT NULL DEFAULT 0,
    "puntos" INTEGER NOT NULL DEFAULT 0,
    "divisionId" TEXT NOT NULL,
    "equipoId" TEXT NOT NULL,

    CONSTRAINT "tablas_posicion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_deletion_jobs" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextTryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_deletion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "division_notification_subscriptions" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "oneSignalId" TEXT NOT NULL,
    "pushSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "division_notification_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onesignal_tag_cleanup_jobs" (
    "id" TEXT NOT NULL,
    "oneSignalId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextTryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onesignal_tag_cleanup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_jugadorId_key" ON "User"("jugadorId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "ligas_canchas_ligaId_idx" ON "ligas_canchas"("ligaId");

-- CreateIndex
CREATE UNIQUE INDEX "ligas_canchas_ligaId_nombre_key" ON "ligas_canchas"("ligaId", "nombre");

-- CreateIndex
CREATE INDEX "ligas_arbitros_ligaId_idx" ON "ligas_arbitros"("ligaId");

-- CreateIndex
CREATE UNIQUE INDEX "ligas_arbitros_ligaId_nombre_key" ON "ligas_arbitros"("ligaId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "jugadores_telefono_key" ON "jugadores"("telefono");

-- CreateIndex
CREATE UNIQUE INDEX "jugadores_userId_key" ON "jugadores"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "equipos_jugadores_equipoId_dorsal_key" ON "equipos_jugadores"("equipoId", "dorsal");

-- CreateIndex
CREATE INDEX "partidos_jornadaId_idx" ON "partidos"("jornadaId");

-- CreateIndex
CREATE INDEX "partidos_rondaPlayoffId_idx" ON "partidos"("rondaPlayoffId");

-- CreateIndex
CREATE INDEX "partidos_canchaId_idx" ON "partidos"("canchaId");

-- CreateIndex
CREATE INDEX "partidos_arbitroId_idx" ON "partidos"("arbitroId");

-- CreateIndex
CREATE UNIQUE INDEX "partidos_referee_access_tokenHash_key" ON "partidos_referee_access"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "partidos_referee_access_partidoId_key" ON "partidos_referee_access"("partidoId");

-- CreateIndex
CREATE INDEX "partidos_referee_access_partidoId_idx" ON "partidos_referee_access"("partidoId");

-- CreateIndex
CREATE UNIQUE INDEX "tablas_posicion_divisionId_equipoId_key" ON "tablas_posicion"("divisionId", "equipoId");

-- CreateIndex
CREATE INDEX "media_deletion_jobs_nextTryAt_idx" ON "media_deletion_jobs"("nextTryAt");

-- CreateIndex
CREATE INDEX "division_notification_subscriptions_oneSignalId_idx" ON "division_notification_subscriptions"("oneSignalId");

-- CreateIndex
CREATE UNIQUE INDEX "division_notification_subscriptions_divisionId_oneSignalId_key" ON "division_notification_subscriptions"("divisionId", "oneSignalId");

-- CreateIndex
CREATE INDEX "onesignal_tag_cleanup_jobs_nextTryAt_idx" ON "onesignal_tag_cleanup_jobs"("nextTryAt");

-- CreateIndex
CREATE UNIQUE INDEX "onesignal_tag_cleanup_jobs_oneSignalId_tag_key" ON "onesignal_tag_cleanup_jobs"("oneSignalId", "tag");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ligas" ADD CONSTRAINT "ligas_ubicacionId_fkey" FOREIGN KEY ("ubicacionId") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ligas" ADD CONSTRAINT "ligas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ligas_canchas" ADD CONSTRAINT "ligas_canchas_ligaId_fkey" FOREIGN KEY ("ligaId") REFERENCES "ligas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ligas_arbitros" ADD CONSTRAINT "ligas_arbitros_ligaId_fkey" FOREIGN KEY ("ligaId") REFERENCES "ligas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones" ADD CONSTRAINT "divisiones_ligaId_fkey" FOREIGN KEY ("ligaId") REFERENCES "ligas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones" ADD CONSTRAINT "divisiones_estadoLigaId_fkey" FOREIGN KEY ("estadoLigaId") REFERENCES "estados_liga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones" ADD CONSTRAINT "divisiones_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones" ADD CONSTRAINT "divisiones_tipoId_fkey" FOREIGN KEY ("tipoId") REFERENCES "tipos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones" ADD CONSTRAINT "divisiones_tipoCompetenciaId_fkey" FOREIGN KEY ("tipoCompetenciaId") REFERENCES "tipos_competencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jugadores" ADD CONSTRAINT "jugadores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipos_jugadores" ADD CONSTRAINT "equipos_jugadores_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "equipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipos_jugadores" ADD CONSTRAINT "equipos_jugadores_jugadorId_fkey" FOREIGN KEY ("jugadorId") REFERENCES "jugadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones_equipos" ADD CONSTRAINT "divisiones_equipos_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones_equipos" ADD CONSTRAINT "divisiones_equipos_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "equipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones_jugadores" ADD CONSTRAINT "divisiones_jugadores_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones_jugadores" ADD CONSTRAINT "divisiones_jugadores_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "equipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones_jugadores" ADD CONSTRAINT "divisiones_jugadores_jugadorId_fkey" FOREIGN KEY ("jugadorId") REFERENCES "jugadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones_jugadores" ADD CONSTRAINT "divisiones_jugadores_divisionId_equipoId_fkey" FOREIGN KEY ("divisionId", "equipoId") REFERENCES "divisiones_equipos"("divisionId", "equipoId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisiones_jugadores" ADD CONSTRAINT "divisiones_jugadores_equipoId_jugadorId_fkey" FOREIGN KEY ("equipoId", "jugadorId") REFERENCES "equipos_jugadores"("equipoId", "jugadorId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premios" ADD CONSTRAINT "premios_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jornadas" ADD CONSTRAINT "jornadas_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rondas_playoff" ADD CONSTRAINT "rondas_playoff_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_jornadaId_fkey" FOREIGN KEY ("jornadaId") REFERENCES "jornadas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_rondaPlayoffId_fkey" FOREIGN KEY ("rondaPlayoffId") REFERENCES "rondas_playoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_equipoLocalId_fkey" FOREIGN KEY ("equipoLocalId") REFERENCES "equipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_equipoVisitanteId_fkey" FOREIGN KEY ("equipoVisitanteId") REFERENCES "equipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_canchaId_fkey" FOREIGN KEY ("canchaId") REFERENCES "ligas_canchas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_arbitroId_fkey" FOREIGN KEY ("arbitroId") REFERENCES "ligas_arbitros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidos_referee_access" ADD CONSTRAINT "partidos_referee_access_partidoId_fkey" FOREIGN KEY ("partidoId") REFERENCES "partidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidos_referee_access" ADD CONSTRAINT "partidos_referee_access_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tablas_posicion" ADD CONSTRAINT "tablas_posicion_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tablas_posicion" ADD CONSTRAINT "tablas_posicion_equipoId_fkey" FOREIGN KEY ("equipoId") REFERENCES "equipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "division_notification_subscriptions" ADD CONSTRAINT "division_notification_subscriptions_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
