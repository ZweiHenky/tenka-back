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

## Package manager

Uses **pnpm** (see `pnpm-lock.yaml`). Do not use npm/yarn. All scripts and commands must be run with `pnpm`.

> ⚠️ El **backend** usa **pnpm**. No usar npm ni yarn.

## Prisma

- Uses `prisma-client` generator (not `@prisma/client`). Generated output: `src/generated/prisma/` (gitignored, must be generated before first build).
- `prisma.config.ts` loads env via `dotenv/config` so the Prisma CLI picks up `DATABASE_URL`. Also defines `migrations.seed` for the seed script.
- Driver adapter: `@prisma/adapter-pg` + `pg` (instanciado en `src/config/database.ts`, compartido con Better Auth).
- Models: `User`, `Account`, `Session`, `Verification` — modelos de Better Auth con `phoneNumber` + `phoneNumberVerified` en User. Más los modelos de dominio del sistema de ligas (incluye `Jugador`, `EquipoJugador`, `DivisionJugador`, `Goleador`, `Arbitraje`, `DisponibilidadCancha`, etc.).
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

## Division States (Draft / Publish)

Las divisiones pasan por un ciclo de vida con 4 estados (`EstadoLiga`):

| Estado | Descripción |
|--------|-------------|
| **Borrador** | No visible al público. Solo el dueño puede verla/editarla. |
| **En Curso** | Publicada. Visible para todos, se pueden crear jornadas y partidos. |
| **Terminada** | Temporada finalizada. Solo lectura. |
| **Suspendida** | Suspendida. No se pueden crear más partidos. |

**Comportamiento en el código:**
- `division/service.ts:69` — Si no se envía `estadoLigaId` al crear, se auto-asigna **Borrador** (busca `estadoLiga.findFirstOrThrow` por nombre "Borrador")
- `division/validator.ts:13` — `estadoLigaId` es `z.string().optional()` al crear
- `division/service.ts:76` — `update()` permite cambiar `estadoLigaId` a cualquier valor
- `division/service.ts:127` — `resetDivision()` elimina jornadas, rondas playoff y tabla de posiciones (vuelve a estado inicial)

**Filtro de visibilidad pública** (`liga/repository.ts`):
- `DIVISIONES_INCLUDE_PUBLIC` (línea 47): filtra `where: { estadoLiga: { nombre: { not: "Borrador" } } }`
- `findAll()` (línea 83): solo ligas que tienen al menos una división no-Borrador
- `findAllPaginated()` (línea 247): igual, con filtro compuesto (search, categoriaId, tipoId, estadoLigaId)
- `findById()` (línea 91): usa `DIVISIONES_INCLUDE` (sin filtro público)
- `findByUser()` (línea 235): usa `DIVISIONES_INCLUDE` (sin filtro) — el dueño ve todo

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

- `src/index.ts` — boots Express en `env.PORT`, configura timeouts del server (`requestTimeout`, `headersTimeout`, `keepAliveTimeout`), arranca los cleanup workers (`startCleanupWorkers`) y maneja shutdown graceful (freno workers → cierra server → `prisma.$disconnect()` → `Sentry.close()`).
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
    disponibilidad-cancha/  # disponibilidad de canchas por liga
    division/            # divisiones + estados + reset
    division-equipo/     # pivot division↔equipo
    equipo/              # equipos + código de invitación
    estado-liga/         # catálogo (Borrador, En Curso, Terminada, Suspendida)
    goleadores/          # tabla de goleadores por división
    jornada/             # generación de jornadas + notificación
    jugador/             # jugadores + perfil "mi perfil" (/me)
    liga/                # ligas CRUD + queries públicas filtradas
    media/               # uploads firmados a Cloudinary
    notification/        # envío de push OneSignal
    notification-subscription/  # subscribe/unsubscribe por división
    partido/             # partidos individuales
    premio/              # premios
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
    ├── ValidationError(400)     — mensaje personalizado
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
- Exporta: `globalApiLimiter` (montado en `/api`), `authLimiter`, `otpSendLimiter`, `otpVerifyLimiter`, `subscriptionLimiter`, `uploadLimiter`, `playerPhoneLookupLimiter`, `refereeReadLimiter`, `refereeWriteLimiter`
- Límites configurables vía env (`GLOBAL_RATE_LIMIT`, `AUTH_RATE_LIMIT`, `OTP_SEND_RATE_LIMIT`, `OTP_VERIFY_RATE_LIMIT`, `SUBSCRIPTION_RATE_LIMIT`, `UPLOAD_RATE_LIMIT`, `PLAYER_PHONE_LOOKUP_RATE_LIMIT`, `REFEREE_READ_RATE_LIMIT`, `EXPENSIVE_OPERATION_RATE_LIMIT`)

## Workers

`src/workers/cleanupWorkers.ts`:
- `startWorker(name, run, intervalMs)` — bucle de intervalo con try/catch por ejecución
- `startCleanupWorkers(intervalMs = 60_000)` — arranca los workers de limpieza (módulo `cleanup`) al bootear el server; `stopWorkers()` los detiene en el shutdown
- Test: `src/workers/cleanupWorkers.test.ts`

## Testing

- **Runner**: Vitest (`vitest.config.ts`)
- **Scripts**: `pnpm test` (run), `pnpm test:watch` (watch mode)
- **Ubicación**: tests junto al código bajo `src/**/*.test.ts` (dentro de `__tests__/` en algunos módulos, o al lado del archivo en `middlewares/`, `utils/`, `plugins/`, `workers/`)
- **Patrón de mocking**: `vi.mock(...)` para prisma y repositorios
  - Prisma: se mockea `src/config/database` con funciones vi.fn() para cada modelo
  - Repositorios: se mockean directo con `vi.fn()` en las funciones expuestas
- **Referencias**: `src/modules/jornada/__tests__/generateNext.test.ts`, `src/modules/user/controller.test.ts`, `src/middlewares/errorHandler.test.ts`, `src/plugins/otpUniqueness.test.ts`

## Seed Data (`prisma/seed.ts`)

**Catálogos:**
| Tabla | Registros |
|-------|-----------|
| `categorias` | LIBRE, MASCULINO, FEMENINO, INFANTIL, SUB-18, SUB-20, VETERANOS, MIXTO |
| `tipos` | FUTBOL 7, RAPIDO, FUTBOL 9, SOCCER, SALA, FUTBOL 5 |
| `estados_liga` | Borrador, Abierta, En Curso, Finalizada, Cancelada |
| `tipos_competencia` | Liga, Copa, Liga y Eliminatorias, Grupos y Eliminatorias |

**Demo data** (creada con `upsert` para ser idempotente):
| Entidad | ID fijo | Detalle |
|---------|---------|---------|
| **Usuario** | `demo@tenka.app` | Demo Capitán, rol CAPITAN |
| **Ubicación** | (autogenerado) | Ciudad de México, CDMX |
| **Ubicación** | (autogenerado) | Monterrey, Nuevo León |
| **Liga** | `seed-liga-1` | Liga Nocturna CDMX (Fut 7, viernes) |
| **Liga** | `seed-liga-2` | Liga Premier Monterrey (soccer, domingos) |
| **División** | `seed-div-1` | Libre Varomil — CDMX — Abierta — Liga |
| **División** | `seed-div-2` | Femenil — CDMX — **Borrador** — Copa |
| **División** | `seed-div-3` | Primera Fuerza — Monterrey — En Curso — Liga y Eliminatorias |
| **División** | `seed-div-4` | Sala Mixto — Monterrey — Finalizada — Liga |

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
| `EXPENSIVE_OPERATION_RATE_LIMIT` | 20 | expensiveOperationLimiter (60 min) |

**HTTP / CORS**
| Var | Default | Notes |
|-----|---------|-------|
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8081,http://localhost:19006,http://localhost:3000` | Lista separada por comas; sin wildcard; HTTPS en producción |
| `JSON_BODY_LIMIT` | `100kb` | express.json limit |
| `URLENCODED_BODY_LIMIT` | `100kb` | express.urlencoded limit |
| `HTTP_REQUEST_TIMEOUT_MS` | 30000 | server.requestTimeout |
| `HTTP_HEADERS_TIMEOUT_MS` | 35000 | server.headersTimeout (debe ser mayor que KEEP_ALIVE) |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | 5000 | server.keepAliveTimeout |
