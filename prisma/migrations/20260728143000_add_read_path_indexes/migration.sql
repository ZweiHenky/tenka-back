-- Indexes for the most frequent public and owner-scoped read paths.
CREATE INDEX "ligas_createdAt_idx" ON "ligas"("createdAt");
CREATE INDEX "ligas_userId_createdAt_idx" ON "ligas"("userId", "createdAt");
CREATE INDEX "divisiones_ligaId_createdAt_idx" ON "divisiones"("ligaId", "createdAt");
CREATE INDEX "divisiones_equipos_equipoId_idx" ON "divisiones_equipos"("equipoId");
CREATE INDEX "divisiones_jugadores_jugadorId_createdAt_idx" ON "divisiones_jugadores"("jugadorId", "createdAt");
CREATE INDEX "premios_divisionId_posicion_idx" ON "premios"("divisionId", "posicion");
CREATE INDEX "jornadas_divisionId_numero_idx" ON "jornadas"("divisionId", "numero");
CREATE INDEX "rondas_playoff_divisionId_orden_idx" ON "rondas_playoff"("divisionId", "orden");
CREATE INDEX "partidos_jornadaId_fecha_idx" ON "partidos"("jornadaId", "fecha");
CREATE INDEX "partidos_rondaPlayoffId_fecha_idx" ON "partidos"("rondaPlayoffId", "fecha");
