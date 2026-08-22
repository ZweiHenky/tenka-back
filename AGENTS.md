# backend

Express + TypeScript + Better Auth + Prisma (PostgreSQL).

## Commands

| Action | Command |
|--------|---------|
| Dev server (hot reload) | `pnpm dev` |
| Build (tsc) | `pnpm build` |
| Seed demo database | `pnpm seed` (solo development) |
| Seed catalogs | `pnpm seed:catalogs` (solo development) |
| Generate Prisma client | `pnpm db:generate` |
| Validate Prisma schema | `pnpm db:validate` |
| Check development migrations | `pnpm db:status:dev` |
| Run development migrations | `pnpm db:migrate:dev` |
| Check production migrations | `railway run pnpm run db:status:production` |
| Run production migrations | Protected command documented in `../DATABASE-SAFETY.md` |
| Run tests | `pnpm test` |
| Run tests (watch) | `pnpm test:watch` |

Testing con **Vitest** (config en `vitest.config.ts`). Tests en `src/**/*.test.ts`.

## Formato de competencia y siembra del cuadro

`TipoCompetencia.codigo` (`LIGA_Y_ELIMINATORIAS` | `ELIMINATORIA`) es la identidad estable del
formato. **Ninguna regla del backend depende de él**: lo de eliminatorias se activa preguntando si
existen rondas para la división. Lo consume la app, que antes comparaba el *nombre* del catálogo.
El nombre es editable por API; el código no debería cambiar.

`rondaPlayoff.generate` acepta `siembra`:

| Siembra | Cómo arma los cruces |
|---|---|
| `POSICIONES` (default) | Ordena por puntos/diferencia/ganados/goles/nombre y cruza `i` contra `n-1-i`. **Es el comportamiento histórico y no debe cambiar**: un cliente que no manda `siembra` genera el mismo cuadro que antes. |
| `ALEATORIA` | Fisher-Yates y empareja consecutivos. El generador se inyecta (`options.random`) para fijarlo en los tests. |
| `MANUAL` | Usa las `llaves` recibidas. |

Las llaves manuales se validan **dentro de la transacción y del `acquireLeagueScheduleLock`**,
contra los equipos que la división tiene en ese momento: entre que el usuario armó el cuadro y lo
envió, un equipo pudo darse de baja. Los mensajes nombran el problema concreto (equipo ajeno,
repetido, o contra sí mismo).

Sin fase de liga la tabla no existe y todos entran en cero, así que `POSICIONES` degenera en orden
alfabético — por eso un cuadro puro ya se podía generar antes de que existiera este formato.

`updateDivisionSchema` **no declara** `tipoCompetenciaId` a propósito: el formato se fija al crear.

## Package manager

Uses **pnpm** (see `pnpm-lock.yaml`). Do not use npm/yarn. All scripts and commands must be run with `pnpm`.

> ⚠️ El **backend** usa **pnpm**. No usar npm ni yarn.

## Prisma

- Uses `prisma-client` generator (not `@prisma/client`). Generated output: `src/generated/prisma/` (gitignored, must be generated before first build).
- `prisma.config.ts` loads env via `dotenv/config` so the Prisma CLI picks up `DATABASE_URL`. Also defines `migrations.seed` for the seed script.
- Driver adapter: `@prisma/adapter-pg` + `pg` (instanciado en `src/config/database.ts`, compartido con Better Auth).
- Models: `User`, `Account`, `Session`, `Verification` — modelos de Better Auth con `phoneNumber` + `phoneNumberVerified` en User. Más los modelos de dominio del sistema de ligas (incluye `Jugador`, `EquipoJugador`, `DivisionJugador`, `LigaCancha`, `DivisionCanchaHorario`, `LigaArbitro`, `PartidoArbitro`, `TandaArbitral`, etc.).
- Ojo: los módulos `disponibilidad-cancha` y `goleadores` **no tienen modelo Prisma propio** — son vistas derivadas de `Partido`. La ocupación de canchas se calcula consultando los partidos de la liga (`Partido → Jornada/RondaPlayoff → Division → ligaId`), no de una tabla de reservas.
- Migration already applied (`prisma/migrations/`).
- Seeds and ad hoc database scripts must run through `scripts/development-script.mjs`; direct execution is blocked.
- Direct Prisma CLI commands are prohibited. Use the `pnpm db:*` scripts documented in `../DATABASE-SAFETY.md`.

## Data Model

```
Liga ──┐
        ├──> Division ──┐
        │               ├──> DivisionEquipo (pivot)
Categoria ──┐           │                    │
Tipo ───────┤           │                    └──> Equipo
EstadoLiga ─┼───────────┤
TipoCompetencia ────────┘
```

- **Liga** no tiene relación directa con Equipos.
- **Division** tiene equipos a través de la tabla pivote `DivisionEquipo`.
- **Equipo** es una entidad independiente: se puede crear sin relación alguna, y luego asignarse a una o más divisiones.
- Cada **Liga** contiene una o más **Divisiones**.
- Las **Divisiones** referencian `Categoria`, `Tipo`, `EstadoLiga`, `TipoCompetencia` como catálogos.
- **Jugador** es una entidad ligada a un `User` vía `phoneNumber` (perfil "mi perfil"). Se relaciona con `Equipo` (`EquipoJugador`, con `dorsal`) y con `Division` (`DivisionJugador`) a través de pivotes.

## Horario por cancha (`DivisionCanchaHorario`)

Una división define **días y horario por cada cancha** en la que juega. `duracionPartido` y `descanso` siguen siendo de la división.

**Regla de resolución** — única implementación en [`src/utils/divisionSchedule.ts`](src/utils/divisionSchedule.ts) (`resolveDivisionSchedule`), que devuelve un `Map<canchaId | null, { days, ranges }>`:

| Caso | Resultado |
|------|-----------|
| `multiplesCanchas = false` | Clave `null` con los escalares de `Division`. Las filas se ignoran. |
| Multi-cancha **con** filas | Una entrada por cancha configurada **y activa**. Sin entrada = la división no juega ahí. |
| Multi-cancha **sin** filas | Fallback legacy: **todas** las canchas activas heredan los escalares. Mantiene vivas a las divisiones anteriores a la migración. |

**Reglas al tocar esto:**
- `Division.diasPartido`/`horarioPartido` son un **resumen denormalizado** (unión de las filas) que se escribe con `summarizeDivisionSchedule` para la vista pública y los clientes viejos. Es un **superconjunto**: nunca validar contra ellos, siempre pasar por `resolveDivisionSchedule`.
- Escribir horarios (`horariosPorCancha` en create/update) va **dentro de `acquireLeagueScheduleLock` y una transacción**: escalares, filas y resumen deben aterrizar juntos, y la generación relee bajo el mismo lock.
- Un arreglo vacío de `horariosPorCancha` borra las filas y revierte a los escalares.
- **`canchaUnicaId` ya no existe** (migración `20260822100000_drop_division_cancha_unica`). Su único
  efecto vivo era acotar ese fallback legacy a una sola cancha. La migración convierte ese estado
  implícito en una fila explícita antes de borrar la columna, así que una división con cancha fija
  sigue jugando donde jugaba, ahora por el camino normal. Con eso desaparecieron `fixedCourtId` en
  `validateLeagueCourtCapacity`, la validación de cancha fija en `division.update` y el filtro de
  canchas candidatas en `jornadaCreation`. Lo que retiene una cancha para que se desactive en vez de
  borrarse es ahora **su fila de horario**, no la columna.
- Cero canchas con días **y** rangos usables es un **error de configuración**, no un resultado vacío: `buildOptions` lanza `'La división no tiene canchas con horario configurado'`.
- `parseConfiguredDays` vive en el mismo módulo y es el **único** parser de días del backend (`jornadaCreation` lo re-exporta por compatibilidad; `parseDaysPartido` delega en él).
- Borrar una cancha con horarios la **desactiva** en vez de borrarla; apagar `multiplesCanchas` borra todas las filas de la liga.

## Canchas: no chocar entre divisiones

Las canchas (`LigaCancha`) son de la **liga**, y todas sus divisiones las comparten. No hay tabla de reservas: la ocupación se deriva de los `Partido` ya guardados, consultando por `ligaId`, así que es cross-división por construcción. Cuatro capas lo garantizan:

| Capa | Dónde | Alcance |
|------|-------|---------|
| Pre-chequeo (UX) | `jornada/service.ts` → `validateLeagueCourtCapacity` fuera de la transacción | Liga completa |
| Validación autoritativa | La misma función, **dentro** del lock y de la transacción Serializable | Liga completa |
| Lock por liga | `utils/leagueScheduleLock.ts` → `pg_advisory_xact_lock(hashtext(ligaId))` | Todas las divisiones de una liga comparten la clave |
| Constraint de Postgres | `partidos_cancha_no_overlap` (`EXCLUDE USING gist`) | Global, ciego a divisiones |

**Reglas al tocar este código:**
- Todo camino que escriba `Partido.fecha`/`canchaId`, o que mute canchas (`liga/service.ts`: `updateCancha`, `deleteCancha`, apagar `multiplesCanchas`), **debe** tomar `acquireLeagueScheduleLock` y releer sus contadores dentro del lock. Sin eso, `onDelete: SetNull` puede dejar partidos sin cancha, fuera del constraint, y bloquear la generación de toda la liga.
- Orden de locks: **advisory primero, row lock (`lockAttachmentTarget`) después**.
- El constraint solo aplica con `canchaId IS NOT NULL`, así que las ligas de cancha única dependen únicamente del lock.
- `validateLeagueCourtCapacity` acota la consulta de ocupación con un piso (`earliestDraftStart - max(duracionMáxDeLaLiga, 1440min)`) para no releer el historial completo.
- **Las escrituras deben devolver la división completa.** `create` y `update` incluyen `canchaHorarios` (`DIVISION_WRITE_INCLUDE` en `division/repository.ts`). El cliente guarda la respuesta en su caché con `setQueryData`; si faltara la relación, la división parecería no tener configuración por cancha hasta el siguiente refetch y la app caería al fallback legacy, mostrando todas las canchas de la liga y repartiendo los slots entre ellas.
- **El servidor no asigna canchas, solo valida.** La `canchaId` de cada slot la manda el cliente; aquí no hay planificador. (Existió un `disponibilidad-cancha/planner.ts` sin llamadores y se eliminó.)
- Una división con `duracionPartido` nulo hace su partido inmensurable. **No inventes una duración por defecto** — enmascararía choques reales. El chequeo se difiere hasta saber si ese partido comparte cancha y ventana con lo que se está programando, y el error nombra la **división** culpable, para que una división mal configurada no bloquee a las otras 9 de la liga.

## Estados de división (`EstadoLiga.codigo`)

Cinco estados. **Toda regla se decide con `codigo`, nunca con `nombre`**: el catálogo es CRUD de
administrador, y comparar el nombre hacía que renombrar la fila "Borrador" publicara de golpe todos
los borradores y rompiera la creación de divisiones. Es el mismo tratamiento que `TipoCompetencia`.
El nombre es la etiqueta que se muestra y debe poder editarse sin consecuencias.

| `codigo` | Nombre sembrado | Público | Escribe |
|---|---|---|---|
| `BORRADOR` | Borrador | No | Sí |
| `ABIERTA` | Abierta | Sí | Sí |
| `EN_CURSO` | En Curso | Sí | Sí |
| `FINALIZADA` | Finalizada | Sí | **No** |
| `CANCELADA` | Cancelada | Sí | **No** |

**Solo lectura** — [`utils/divisionState.ts`](src/utils/divisionState.ts), un único lugar decide qué
códigos escriben. Antes convivían dos criterios: agregar *un* partido exigía "En Curso", pero generar
la jornada entera no miraba el estado, así que en una división finalizada podías crear una jornada
completa y no añadirle un partido. `assertDivisionWritable` se llama en `jornada.generateNext`,
`jornada.delete`, `partido/jornadaCreation`, `resultWriter` (un solo punto cubre la app **y** el
enlace del árbitro), `rondaPlayoff.generate/delete/deleteByDivision` y `division.resetDivision`.
Cada uno lee el estado del `select` que ya hacía; ninguno añade una consulta.

**Excepción deliberada: `campeon.assign` y `remove` no se bloquean.** Coronar es el acto de cierre;
bloquearlo en Finalizada haría imposible cerrar una división después de marcarla como tal.

Un código desconocido **deja pasar**: bloquear por no reconocerlo dejaría inservible una división
cuyo catálogo alguien amplió. Igual criterio que `formatFromCodigo`.

**Al crear**, sin `estadoLigaId` se auto-asigna la fila con `codigo: 'BORRADOR'`. `update()` permite
cualquier transición: no hay máquina de estados.

**Visibilidad pública**: `PUBLIC_DIVISION_WHERE` en [`liga/repository.ts`](src/modules/liga/repository.ts)
es `{ estadoLiga: { codigo: { not: 'BORRADOR' } } }`, y **todos** sus consumidores la reusan — cinco
sitios re-inlineaban el literal, y esa duplicación es lo que dejó que el criterio se dispersara.
Misma regla en `utils/divisionVisibility.ts` y `notification-subscription`.

## Tabla de goleo por división (`registrarGoleo`)

Interruptor de la división, **encendido por defecto**: el goleo existió siempre y apagarlo por
omisión se lo quitaría a quien ya lo usa. Se prende y apaga desde el menú de opciones, no en el
formulario de alta — igual que `registrarParticipaciones`.

Ojo con la confusión: `registrarParticipaciones` es la **alineación**. Lo único que le hacía al
goleo era acotar la lista de goleadores a quienes estuvieran en ella (`limitToParticipantes`); sin
él se anotan goleadores igual, eligiendo del plantel de la división.

**Apagarlo congela, no borra** — `partido/resultWriter.ts`:

- `const allocations = goleoActivo ? input.allocations : []`. Apagado, el servidor no valida ni
  escribe atribuciones nuevas, venga de donde venga la petición.
- Al guardar, **las filas con jugador no se tocan**; solo se rehacen los goles sin dueño
  (`jugadorIdSnapshot: null`) para que la suma siga cuadrando con el marcador. La variante ingenua
  —borrar todo y reescribir— perdería el historial, porque el editor está deshabilitado y nadie
  podría recapturarlo.

**No entra en `needsLock`.** Ese lock existe para lo que cambia lo que valida la generación de
jornadas: horarios, participaciones y penales. El goleo no toca la programación.

`campeon.assign` rechaza un `jugadorId` con el goleo apagado: sin tabla en ningún lado, el premio no
tendría dónde verse.

Lo consume también `referee-access` (`RefereePartidoDivisionContext`), para que la captura por token
esconda su editor de goleadores igual que la app.

## Campeón de división (`DivisionCampeon`)

Cierra una división: **equipo campeón** y, opcionalmente, **campeón de goleo**. Módulo `campeon/`,
montado en `/api/campeones`. No hay subcampeón ni tercer lugar, y no existe premio a nivel liga.

Una **sola fila por división** (`divisionId @unique`), así que reasignar es un `upsert` y no pueden
convivir dos campeones. Se direcciona por `divisionId`, no por `id`: el cliente nunca necesita
conocerlo y el `PUT` sale idempotente sin recuperación de escritura ambigua.

**Reglas del service** (`campeon/service.ts`):

- **Gate**: la ronda de `orden` máximo debe existir, tener partidos y todos `FINALIZADO`. Es la
  final; el `nombre` de la ronda no sirve para identificarla porque la API deja editarlo.
- El equipo debe estar en `DivisionEquipo` de esa división.
- El goleador se valida contra `goleadoresService.findByDivision`, **no** contra `DivisionJugador`:
  de un tirón confirma que tiene goles ahí y devuelve el `jugadorGoles` que se guarda. Una división
  sin tabla de goleo simplemente no lleva goleador.
- **Los snapshots (`equipoNombre`, `jugadorNombre`, `jugadorGoles`) los escribe el servidor.** El
  cliente manda solo ids: un nombre o un conteo suyos serían falsificables. Y `equipoId`/`jugadorId`
  son `SetNull`, así que sin snapshot el palmarés se borraría al dar de baja al equipo.

**El título se va con el cuadro.** Lo borran `rondaPlayoff.delete`, `rondaPlayoff.deleteByDivision`
y `division.resetDivision`. Sin eso quedaría un campeón declarado sobre una final que ya no existe,
y la app —que solo ofrece asignarlo con el cuadro completo— no daría forma de quitarlo.

**Exposición**: no está en las proyecciones de `liga/repository.ts`; el cliente lo pide aparte, como
`premio`, `tabla-posicion` y `goleadores`. La única lectura existente que lo incluye es
`divisionEquipo.findByEquipo`, y solo los ids, para el palmarés de la ficha pública del equipo.

`Premio` es otra cosa: la bolsa por posición (`posicion`, `titulo`, `monto`), sin relación a equipos
ni jugadores. No se mezclan.

**El módulo `premio` no tiene cliente todavía.** Está completo en el servidor —entity, service,
repository, validator, rutas en `/api/premios` y tests— y **cero** referencias en el frontend. No es
código muerto por accidente: se dejó a propósito, esperando su pantalla. Si buscas dónde se muestran
los premios, la respuesta es que aún no se muestran en ningún lado.

## Push Notifications

- Servicio: `src/modules/notification/service.ts`
- Provider: OneSignal REST API (`https://api.onesignal.com/notifications`)
- Se llama desde `jornadaService.generateNext()` después de crear la jornada y partidos
- Mensaje actual: `Ya está disponible la Jornada {numero} de la división {division.nombre} en la liga {liga.nombre}`
- `headings` y `contents` incluyen `en` y `es` porque OneSignal requiere contenido `en`/`any`
- Data payload incluye: `type`, `jornadaId`, `divisionId`, `ligaId`, `url`
- URL actual: `/(drawer)/(public)/liga/{ligaId}?divisionId={divisionId}&tab=horario`
- Envío 1: usuarios registrados de equipos vía `include_aliases.external_id` usando `Equipo.userId`
- Envío 2: seguidores anónimos (botón "Notificarme de esta división") vía filter tag `division_{divisionId}=true`
- Si faltan env vars, el servicio loguea warning y omite envío
- Las notificaciones a registrados se derivan de `DivisionEquipo -> Equipo.userId`
- Suscripciones gestionadas por `src/modules/notification-subscription/routes.ts` (`POST /subscribe`, `POST /unsubscribe`, con `optionalAuth` y rate limit)

## Entrypoint

- `src/index.ts` — boots Express en `env.PORT`, configura timeouts del server (`requestTimeout`, `headersTimeout`, `keepAliveTimeout`), arranca los procesadores de jobs (`startCleanupWorkers`) y maneja shutdown graceful (deja de aceptar HTTP → drena workers → `prisma.$disconnect()` → `Sentry.close()`).
- `src/maintenance.ts` — ejecuta una pasada one-shot de los jobs durables; se compila a `dist/maintenance.js` y se usa con `pnpm maintenance` desde Railway Cron.
- `src/app.ts` — exporta `createApp()` (supertest-friendly). Monta middleware global, rate limiters, auth handler y los routers de cada módulo. Aplica Cors con allowlist de `CORS_ALLOWED_ORIGINS` y error handler con Sentry.
- `src/instrument.ts` — inicializa Sentry (solo con `SENTRY_DSN`).
- `src/config/logger.ts` — pino (nivel por `LOG_LEVEL`).
- `src/config/readiness.ts` — estado ready/not-ready para health checks.

## Architecture

Modular monolithic structure (organized by domain):

```
src/
  config/        # Singleton instances (env, prisma, logger, readiness)
  generated/     # Prisma client generado (gitignored)
  middlewares/   # Express middleware (error handler, auth, rate limits, requestContext)
  plugins/       # Plugins de Better Auth (otpUniqueness)
  routes/        # Health check router
  types/         # Tipos compartidos (auth: UserRole, AuthenticatedUser)
  utils/         # Shared helpers (errors, response, phoneOtp, teamCode, transaction…)
  workers/       # Background workers (cleanupWorkers)
  modules/
    arbitraje/           # asignación de árbitros + PDF
    categoria/           # catálogo de categorías
    cleanup/             # lógica de limpieza de datos obsoletos
    disponibilidad-cancha/  # lectura de ocupación de canchas por liga (derivada de Partido)
    campeon/             # campeón de división (equipo) y campeón de goleo
    division/            # divisiones + estados + reset
    division-equipo/     # pivot division↔equipo
    equipo/              # equipos + código de invitación
    estado-liga/         # catálogo de estados con `codigo` estable
    goleadores/          # tabla de goleadores por división
    jornada/             # generación de jornadas + notificación
    jugador/             # jugadores + perfil "mi perfil" (/me)
    liga/                # ligas CRUD + queries públicas filtradas
    media/               # uploads firmados a Cloudinary
    notification/        # envío de push OneSignal
    notification-subscription/  # subscribe/unsubscribe por división
    partido/             # partidos individuales
    premio/              # bolsa de premios por posición — completo, **sin cliente todavía**
    referee-access/      # acceso árbitro por token (QR) a partido/resultado
    ronda-playoff/       # rondas de playoff
    tabla-posicion/      # tabla de posiciones
    tipo/                # catálogo (Fútbol 7, Fútbol 11, etc.)
    tipo-competencia/    # catálogo (Liga, Copa, etc.)
    ubicacion/           # ubicaciones (Google Places)
    user/                # cuenta del usuario (rol liga, visibilidad teléfono, updateMe)
  app.ts         # createApp() — wiring de todo Express
  auth.ts        # Better Auth config
  index.ts       # App bootstrap
  instrument.ts  # Sentry bootstrap
```

Each module owns its full stack: `Route → Controller → Service → Repository interface/impl → Prisma`

**Request flow within a module:**
- Route defines HTTP method + path, delegates to controller.
- Controller parses/validates input via `zod.safeParse`, calls service, formats response.
- Service contains business rules, throws `AppError` subclasses.
- Repository (`repository.interface.ts` = contract, `repository.ts` = impl) wraps Prisma queries.

**Standard API response envelope:**
```ts
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}
```
- `ok(res, data, message?)` → `200 { success: true, data, message? }`
- `created(res, data, message?)` → `201 { success: true, data, message? }`
- `noContent(res)` → `204` (vacío)
- `errorHandler` → `{ success: false, error: "mensaje" }`

PrismaClient singleton in `src/config/database.ts` (shared with Better Auth).

## Error Handling

**Error hierarchy** (`src/utils/errors.ts`):
```
Error
└── AppError(statusCode, message)
    ├── NotFoundError(404)       — "{resource} no encontrado"
    ├── ValidationError(422)     — mensaje personalizado
    ├── BadRequestError(400)     — mensaje personalizado
    ├── ConflictError(409)       — mensaje personalizado
    ├── UnauthorizedError(401)   — "No autorizado"
    └── ForbiddenError(403)      — "No autorizado" (CORS/roles)
```

**Response helpers** (`src/utils/response.ts`):
```ts
interface ApiResponse<T> { success: boolean; data?: T; message?: string; error?: string }
```
- `ok(res, data, message?)` → 200 `{ success: true, data, message? }`
- `created(res, data, message?)` → 201 `{ success: true, data, message? }`
- `noContent(res)` → 204 (vacío)

**Global error handler** (`src/middlewares/errorHandler.ts`):
- Si es `AppError` → responde con `statusCode` del error y `{ success: false, error: mensaje }`
- Si no → log a consola, responde 500 `{ success: false, error: "Error interno del servidor" }`
- Integra Sentry (`Sentry.setupExpressErrorHandler`) solo para errores ≥ 500 que no sean `AppError`.

## Middleware

**`requireAuth`** (`src/middlewares/authMiddleware.ts`):
- Valida sesión vía `auth.api.getSession()` con headers de la request
- Si no hay sesión → lanza `UnauthorizedError`
- Puebla `req.user` con `AuthenticatedUser` (`{ id, email, name, rol }`)

**`optionalAuth`** (`authMiddleware.ts`):
- Igual que `requireAuth`, pero no lanza si no hay sesión (puebla `req.user` solo cuando existe). Usado en rutas públicas (jugadores, goleadores, subscriptions, referee-access).

**`requireRole(...roles)`** (`authMiddleware.ts`):
- Factory que retorna middleware
- Verifica que `req.user.rol` esté incluido en los roles permitidos (o sea `ADMINISTRADOR`)
- Roles disponibles (`src/types/auth.ts`): `CAPITAN`, `LIGA`, `ADMINISTRADOR`

**`requestContext`** (`src/middlewares/requestContext.ts`):
- Genera `req.requestId` y lo expone (usado por pino y tracing).

**`rateLimits`** (`src/middlewares/rateLimits.ts`):
- `createRateLimiter({ limit, windowMs })` con `express-rate-limit`
- Exporta: `globalApiLimiter` (montado en `/api`), `authLimiter`, `otpSendLimiter`, `otpVerifyLimiter`, `subscriptionLimiter`, `uploadLimiter`, `playerPhoneLookupLimiter`, `refereeReadLimiter`, `refereeWriteLimiter`, `jornadaGenerationLimiter`, `playoffGenerationLimiter`, `destructiveOperationLimiter`
- Límites configurables vía env (`GLOBAL_RATE_LIMIT`, `AUTH_RATE_LIMIT`, `OTP_SEND_RATE_LIMIT`, `OTP_VERIFY_RATE_LIMIT`, `SUBSCRIPTION_RATE_LIMIT`, `UPLOAD_RATE_LIMIT`, `PLAYER_PHONE_LOOKUP_RATE_LIMIT`, `REFEREE_READ_RATE_LIMIT`, `EXPENSIVE_OPERATION_RATE_LIMIT`)

## Workers

`src/workers/cleanupWorkers.ts` y `src/workers/dueProcessor.ts`:
- Cuatro procesadores single-flight reemplazan los pollers de 60 segundos.
- Cada enqueue emite una señal después del commit; cada batch consulta `nextDueAt` para programar el timer exacto.
- El arranque consulta todas las colas para recuperar trabajo durable después de deploys o crashes.
- `stopWorkers()` cancela timers y espera el batch activo durante shutdown.
- Railway Cron ejecuta `pnpm maintenance` cada 30 minutos como red de recuperación; detalles en `BACKGROUND-JOBS.md`.
- Test: `src/workers/dueProcessor.test.ts`

## Testing

- **Runner**: Vitest (`vitest.config.ts`)
- **Scripts**: `pnpm test` (run), `pnpm test:watch` (watch mode)
- **Ubicación**: tests junto al código bajo `src/**/*.test.ts` (dentro de `__tests__/` en algunos módulos, o al lado del archivo en `middlewares/`, `utils/`, `plugins/`, `workers/`)
- **Patrón de mocking**: `vi.mock(...)` para prisma y repositorios
  - Prisma: se mockea `src/config/database` con funciones vi.fn() para cada modelo
  - Repositorios: se mockean directo con `vi.fn()` en las funciones expuestas
- **Referencias**: `src/modules/jornada/__tests__/generateNext.test.ts`, `src/modules/user/controller.test.ts`, `src/middlewares/errorHandler.test.ts`, `src/plugins/otpUniqueness.test.ts`
- **Errores de validación**: los controladores usan `firstIssueMessage(parsed.error)` (`src/utils/validation.ts`), que antepone el campo a los mensajes propios de zod — `Invalid input: expected string, received undefined` por sí solo no dice cuál falló. Los mensajes de código `custom` los escribimos nosotros y se dejan intactos. **No vuelvas a usar `error.issues[0].message` directo en un controlador.**

### Tests de integración (base real)

- **Script**: `pnpm test:integration` (config `vitest.integration.config.ts`). Requiere `TEST_DATABASE_URL` con `schema=tenka_integration` y la extensión `btree_gist`.
- **Aislamiento**: el global setup hace `DROP SCHEMA … CASCADE` y recrea `tenka_integration`; `getIntegrationDatabaseUrl()` rechaza cualquier URL que no apunte a ese esquema, así que nunca puede tocar desarrollo ni producción.
- **Migración baselineada**: `vitest.integration.global-setup.ts` marca `20260813233356_league_timezone_and_instant` como aplicada (`migrate resolve --applied`) antes del `deploy`. Esa migración consulta `table_schema = 'public'` hardcodeado mientras su `ALTER TABLE` resuelve por `search_path`, así que falla contra un esquema que no sea `public`. **No editar ese archivo** — ya está aplicado en producción y cambiarlo rompería su checksum. Es un no-op sobre un esquema recién creado.
- **Para qué sirven**: cubren lo que los mocks no pueden observar — concurrencia, locks y constraints reales. Ver `src/test/integration/data-integrity.integration.test.ts`.
- **Cómo probar un lock**: nunca sincronices con un `setTimeout` fijo; contra una base remota no distingue "bloqueado" de "lento" y el test pasa aunque quites el lock. Usa el patrón de `waitForBlockedAdvisoryLock()`, que espera a ver una sesión parada en un advisory lock **no otorgado** en `pg_locks`. Al escribir un test de concurrencia, **verifica que falle al quitar el lock**.
- **Un solo reloj por comparación temporal.** El reloj del proceso y el de Neon derivan unos cientos de milisegundos en ambos sentidos. Si escribes un timestamp con el reloj de la app (Prisma `@default(now())`, `new Date()`) y luego lo comparas contra `NOW()` del servidor, el test pasa o falla según la deriva del momento. El código de producción ya usa `NOW()` en ambos lados (ver `notification/scheduleChangeOutbox.ts` y `notification/service.ts`); **los tests deben hacer lo mismo** — ancla las filas con `NOW() - INTERVAL '1 minute'` en vez de confiar en el default de Prisma.
- **Acota las consultas a los datos del propio test.** Las colas se consultan por estado (`status = 'PENDING'`), así que un test sin filtro recoge las filas que dejaron los otros del mismo archivo y su resultado depende del orden de ejecución.

## Seed Data (`prisma/seed.ts`)

**Catálogos:**
| Tabla | Registros |
|-------|-----------|
| `categorias` | LIBRE, VARONIL, FEMENIL, INFANTIL, INFANTIL FEMENIL, JUVENIL, SUB-15, SUB-15 FEMENIL, SUB-18, SUB-18 FEMENIL, SUB-20, SUB-20 FEMENIL, VETERANOS, VETERANOS FEMENIL, MIXTO |
| `tipos` | FUTBOL 7, RAPIDO, FUTBOL 9, SOCCER, SALA, FUTBOL 5 |
| `estados_liga` | Borrador, Abierta, En Curso, Finalizada, Cancelada — cada uno con su `codigo` |
| `tipos_competencia` | Liga y Eliminatorias, Eliminatoria |

**Demo data** (creada con `upsert` para ser idempotente):
| Entidad | ID fijo | Detalle |
|---------|---------|---------|
| **Usuario** | `demo@tenka.app` | Demo Capitán, rol CAPITAN |
| **Ubicación** | (autogenerado) | Ciudad de México, CDMX |
| **Ubicación** | (autogenerado) | Monterrey, Nuevo León |
| **Liga** | `seed-liga-1` | Liga Nocturna CDMX (Fut 7, viernes) |
| **Liga** | `seed-liga-2` | Liga Premier Monterrey (soccer, domingos) |
| **División** | `seed-div-1` | Libre Varomil — CDMX — Abierta — Liga y Eliminatorias |
| **División** | `seed-div-2` | Femenil — CDMX — **Borrador** — Liga y Eliminatorias |
| **División** | `seed-div-3` | Primera Fuerza — Monterrey — En Curso — Liga y Eliminatorias |
| **División** | `seed-div-4` | Sala Mixto — Monterrey — Finalizada — Liga y Eliminatorias |

## Better Auth

Configured in `src/auth.ts`. Uses shared `prisma` instance from `config/database.ts`. Auth routes served via `toNodeHandler(auth)` under `/api/auth/*`.

**Config:**
- `user.additionalFields`: `rol` (string) y `showPhoneInPublicLeague` (boolean, default false)
- `emailAndPassword.enabled = false` — no hay login email/contraseña
- `account.accountLinking`: `enabled: true`, `trustedProviders: ["google"]`
- `session`: expira en 7 días, `updateAge` de 1 día
- `advanced`: cookies seguras en producción, `sameSite: "lax"`, `httpOnly: true`
- `trustedOrigins`: `tenka://`, `https://appleid.apple.com`, orígenes de `CORS_ALLOWED_ORIGINS`, y en no-producción `exp://localhost|127.0.0.1|192.168.*`

**Plugins:**
- `expo` — mobile auth support
- `phoneNumber` — OTP por teléfono. `sendOTP` delega en `createPhoneOtpDelivery(env.PHONE_OTP_MODE, …)` (`src/utils/phoneOtp.ts`): modos `console` (loguea el código), `twilio` (envía SMS vía Twilio REST), `disabled` (lanza error). `expiresIn` 5 min, `allowedAttempts` 5, `phoneNumberValidator` E.164 (`/^\+[1-9]\d{7,14}$/`). Endpoints: `sendOTP()`, `verify()` con `updatePhoneNumber: true` persiste `phoneNumber` en el User.
- `preventOtpForRegisteredPhone()` (`src/plugins/otpUniqueness.ts`) — hook `before` en `/phone-number/send-otp`: si ya existe un User con ese `phoneNumber`, lanza `APIError.from("BAD_REQUEST", { code: "PHONE_NUMBER_EXIST", … })` **sin enviar el SMS**.

**Social providers:**
- **Google**: requerido (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`).
- **Apple**: opcional — se activa solo si están las 4 vars (`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`). El `clientSecret` es un JWT ES256 generado on-the-fly con `jose` (`generateAppleClientSecret`): `iss` = teamId, `sub`/`aud` = clientId, expiración 180 días. `APPLE_APP_BUNDLE_IDENTIFIER` opcional para el `appBundleIdentifier`.

## Required env vars

Todas se validan en `src/config/env.ts` con zod. `APP_ENV` debe ser `local` en dev; en `preview`/`production` se exigen HTTPS estable (sin ngrok) en `BETTER_AUTH_URL`, `PHONE_OTP_MODE` distinto de `console`, `SENTRY_DSN` y orígenes CORS.

| Var | Notes |
|-----|-------|
| `APP_ENV` | `local` \| `preview` \| `production` |
| `NODE_ENV` | `development` \| `test` \| `production` |
| `PORT` | Default 3000 |
| `DATABASE_URL` | Neon PostgreSQL (set) |
| `BETTER_AUTH_SECRET` | Min 32 chars (set) |
| `BETTER_AUTH_URL` | Base URL pública HTTPS (set) |

**Social login**
| Var | Notes |
|-----|-------|
| `GOOGLE_CLIENT_ID` | Requerido (set) |
| `GOOGLE_CLIENT_SECRET` | Requerido (set) |
| `APPLE_CLIENT_ID` | Opcional — activa Apple junto con TEAM_ID, KEY_ID y PRIVATE_KEY |
| `APPLE_TEAM_ID` | Opcional (Apple Developer Team ID) |
| `APPLE_KEY_ID` | Opcional (Key ID de la private key) |
| `APPLE_PRIVATE_KEY` | Opcional (private key ES256, multiline) |
| `APPLE_APP_BUNDLE_IDENTIFIER` | Opcional (iOS bundle identifier) |

**Phone OTP / Twilio**
| Var | Notes |
|-----|-------|
| `PHONE_OTP_MODE` | `console` (loguea código) \| `twilio` (envía SMS) \| `disabled`. Fuera de `local` debe ser `twilio` o `disabled` |
| `TWILIO_ACCOUNT_SID` | Requerida si `PHONE_OTP_MODE=twilio` |
| `TWILIO_AUTH_TOKEN` | Requerida si `PHONE_OTP_MODE=twilio` |
| `TWILIO_PHONE_NUMBER` | Requerida si twilio — debe ser E.164 (`+[1-9]…`) |

**Cloudinary**
| Var | Notes |
|-----|-------|
| `CLOUDINARY_CLOUD_NAME` | Requerido |
| `CLOUDINARY_API_KEY` | Requerido |
| `CLOUDINARY_API_SECRET` | Requerido |
| `CLOUDINARY_DELIVERY_HOST` | Default `res.cloudinary.com` |

**Logging / Monitoring**
| Var | Notes |
|-----|-------|
| `LOG_LEVEL` | Default `info` (fatal…silent) |
| `SENTRY_DSN` | Requerida fuera de `local` |
| `SENTRY_RELEASE` | Opcional |
| `RAILWAY_GIT_COMMIT_SHA` | Opcional (release) |
| `READINESS_TIMEOUT_MS` | Default 5000 |
| `PROVIDER_TIMEOUT_MS` | Default 5000 |
| `SHUTDOWN_GRACE_MS` | Default 10000 |

**Rate limits**
| Var | Default | Uso |
|-----|---------|-----|
| `GLOBAL_RATE_LIMIT` | 400 | globalApiLimiter (15 min) |
| `AUTH_RATE_LIMIT` | 100 | authLimiter (15 min) |
| `OTP_SEND_RATE_LIMIT` | 5 | otpSendLimiter (10 min) |
| `OTP_VERIFY_RATE_LIMIT` | 10 | otpVerifyLimiter (10 min) |
| `SUBSCRIPTION_RATE_LIMIT` | 30 | subscriptionLimiter (15 min) |
| `UPLOAD_RATE_LIMIT` | 30 | uploadLimiter (15 min) |
| `PLAYER_PHONE_LOOKUP_RATE_LIMIT` | 30 | playerPhoneLookupLimiter (10 min) |
| `REFEREE_READ_RATE_LIMIT` | 40 | refereeReadLimiter (15 min) |
| `EXPENSIVE_OPERATION_RATE_LIMIT` | 20 | `jornadaGenerationLimiter`, `playoffGenerationLimiter` y `destructiveOperationLimiter` (60 min) |

**HTTP / CORS**
| Var | Default | Notes |
|-----|---------|-------|
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8081,http://localhost:19006,http://localhost:3000` | Lista separada por comas; sin wildcard; HTTPS en producción |
| `JSON_BODY_LIMIT` | `100kb` | express.json limit |
| `URLENCODED_BODY_LIMIT` | `100kb` | express.urlencoded limit |
| `HTTP_REQUEST_TIMEOUT_MS` | 30000 | server.requestTimeout |
| `HTTP_HEADERS_TIMEOUT_MS` | 35000 | server.headersTimeout (debe ser mayor que KEEP_ALIVE) |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | 5000 | server.keepAliveTimeout |
