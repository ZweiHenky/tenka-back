# backend

Express + TypeScript + Better Auth + Prisma (PostgreSQL).

## Commands

| Action | Command |
|--------|---------|
| Dev server (hot reload) | `pnpm dev` |
| Build (tsc) | `pnpm build` |
| Seed database | `pnpm seed` |
| Generate Prisma client | `npx prisma generate` |
| Run Prisma migrations | `npx prisma migrate dev` |
| Open Prisma Studio | `npx prisma studio` |
| Run tests | `pnpm test` |
| Run tests (watch) | `pnpm test:watch` |

Testing con **Vitest** (config en `vitest.config.ts`). Tests en `src/**/*.test.ts`.

## Package manager

Uses **pnpm** (see `pnpm-lock.yaml`). Do not use npm/yarn. All scripts and commands must be run with `pnpm`.

> ⚠️ El **backend** usa **pnpm**. No usar npm ni yarn.

## Prisma

- Uses `prisma-client` generator (not `@prisma/client`). Generated output: `src/generated/prisma/` (gitignored, must be generated before first build).
- `prisma.config.ts` loads env via `dotenv/config` so the Prisma CLI picks up `DATABASE_URL`. Also defines `migrations.seed` for the seed script.
- Driver adapter: `@prisma/adapter-pg` + `pg` (instantiated in `src/auth.ts`).
- Models: `User`, `Account`, `Session`, `Verification` — Better Auth models with `phoneNumber` + `phoneNumberVerified` on User. Plus domain models for the league system.
- Migration already applied (`prisma/migrations/`).
- Catalog seed data in `prisma/seed.ts` (categorias, tipos, estadoLiga, tipoCompetencia). Run via `pnpm seed` or `npx prisma db seed`.

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

## Division States (Draft / Publish)

Las divisiones pasan por un ciclo de vida con 4 estados (`EstadoLiga`):

| Estado | Descripción |
|--------|-------------|
| **Borrador** | No visible al público. Solo el dueño puede verla/editarla. |
| **En Curso** | Publicada. Visible para todos, se pueden crear jornadas y partidos. |
| **Terminada** | Temporada finalizada. Solo lectura. |
| **Suspendida** | Suspendida. No se pueden crear más partidos. |

**Comportamiento en el código:**
- `division/service.ts:37` — Si no se envía `estadoLigaId` al crear, se auto-asigna **Borrador**
- `division/validator.ts:13` — `estadoLigaId` es `z.string().optional()` al crear
- `division/service.ts:41-44` — `update()` permite cambiar `estadoLigaId` a cualquier valor
- `division/service.ts:51-62` — `resetDivision()` elimina jornadas, rondas playoff y tabla de posiciones (vuelve a estado inicial)

**Filtro de visibilidad pública** (`liga/repository.ts`):
- `DIVISIONES_INCLUDE_PUBLIC`: filtra `where: { estadoLiga: { nombre: { not: "Borrador" } } }`
- `findAll()`: solo ligas que tienen al menos una división no-Borrador
- `findAllPaginated()`: igual, con filtro compuesto
- `findById()`: usa `DIVISIONES_INCLUDE_PUBLIC`
- `findByUser()`: usa `DIVISIONES_INCLUDE` (sin filtro) — el dueño ve todo

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
- Las notificaciones a no registrados no usan tabla propia; dependen de tags OneSignal agregados desde el botón de suscripción por división en frontend

## Entrypoint

`src/index.ts` — boots Express on `env.port`. Exports `app` (supertest-friendly). Imports `dotenv/config` first so env vars are available.

## Architecture

Modular monolithic structure (organized by domain):

```
src/
  config/        # Singleton instances (env, prisma)
  middlewares/   # Express middleware (error handler, etc.)
  utils/         # Shared helpers (errors, response)
  modules/
    categoria/         # entity, repository, service, controller, validator, routes
    division/          # same pattern
    division-equipo/   # pivot table
    equipo/            # same pattern
    estado-liga/       # catalog (Borrador, En Curso, Terminada, Suspendida)
    jornada/           # matchweek scheduling
    liga/              # league CRUD + public filtered queries
    partido/           # individual matches
    premio/            # awards
    ronda-playoff/     # playoff rounds
    tabla-posicion/    # standings
    tipo/              # catalog (Fútbol 7, Fútbol 11, etc.)
    tipo-competencia/  # catalog (Liga, Copa, etc.)
    ubicacion/         # location picker
    notification/      # OneSignal push notifications
  auth.ts        # Better Auth config
  index.ts       # App bootstrap
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
    └── UnauthorizedError(401)   — "No autorizado"
```

**Response helpers** (`src/utils/response.ts`):
```ts
interface ApiResponse<T> { success: boolean; data?: T; message?: string; error?: string }
```
- `ok(res, data, message?)` → 200 `{ success: true, data, message? }`
- `created(res, data, message?)` → 201 `{ success: true, data, message? }`
- `noContent(res)` → 204 (vací­o)

**Global error handler** (`src/middlewares/errorHandler.ts`):
- Si es `AppError` → responde con `statusCode` del error y `{ success: false, error: mensaje }`
- Si no → log a consola, responde 500 `{ success: false, error: "Error interno del servidor" }`

## Middleware

**`requireAuth`** (`src/middlewares/authMiddleware.ts:5`):
- Valida sesión­ via `auth.api.getSession()` con headers de la request
- Si no hay sesión­ → lanza `UnauthorizedError`
- Puebla `req.user` con `{ id, email, name, rol }`

**`requireRole(...roles)`** (`authMiddleware.ts:16`):
- Factory que retorna middleware
- Verifica que `req.user.rol` esté incluido en los roles permitidos
- Roles disponibles: `CAPITAN`, `LIGA`, `ADMINISTRADOR`

## Testing

- **Runner**: Vitest (`vitest.config.ts`)
- **Scripts**: `pnpm test` (run), `pnpm test:watch` (watch mode)
- **Ubicación**: `src/**/*.test.ts` — dentro de `__tests__/` en cada módulo
- **Patrón de mocking**: `vi.mock(...)` para prisma y repositorios
  - Prisma: se mockea `src/config/database` con funciones vi.fn() para cada modelo
  - Repositorios: se mockean directo con `vi.fn()` en las funciones expuestas
- **Referencia**: `src/modules/jornada/__tests__/generateNext.test.ts`

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

- Configured in `src/auth.ts`. Uses shared `prisma` instance from `config/database.ts`.
- Auth routes served via `toNodeHandler(auth)` under `/api/auth/*`.
- Plugins:
  - `expo` — mobile auth support
  - `phoneNumber` — OTP flow (code logged to console — replace with SMS provider). Enpoints: `sendOTP()`, `verify()` con `updatePhoneNumber: true` persiste `phoneNumber` en el User.
- Social providers: Google and Apple (fill env vars before using).
- User model fields: `phoneNumber` (String, unique), `phoneNumberVerified` (Boolean).

## Required env vars

| Var | Notes |
|-----|-------|
| `DATABASE_URL` | Neon PostgreSQL (set) |
| `BETTER_AUTH_SECRET` | Min 32 chars (set) |
| `BETTER_AUTH_URL` | Base URL (set) |
| `GOOGLE_CLIENT_ID` | Empty — fill before using Google sign-in |
| `GOOGLE_CLIENT_SECRET` | Empty — fill before using Google sign-in |
| `APPLE_CLIENT_ID` | Empty — fill before using Apple sign-in |
| `APPLE_CLIENT_SECRET` | Empty — fill before using Apple sign-in |
| `ONESIGNAL_APP_ID` | OneSignal app id para push notifications |
| `ONESIGNAL_REST_API_KEY` | OneSignal REST API key para enviar notificaciones |
