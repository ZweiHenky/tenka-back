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
| Reconcile RevenueCat sandbox | Protected command documented in `../DATABASE-SAFETY.md` |
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

## Ligas cercanas

`GET /api/ligas` acepta `latitude` y `longitude` opcionales, siempre juntas y solo en modo publico.
El repositorio calcula Haversine en PostgreSQL antes de paginar, sin PostGIS, y ordena por distancia,
`createdAt DESC`, `id ASC`. La consulta raw es parametrizada y corre en una transaccion despues de
`configureRawQuerySchema`, porque integracion usa `tenka_integration` y el adapter no configura el
`search_path` para SQL raw.

La visibilidad y categoria/tipo/estado viven en el mismo `EXISTS` de division y la visibilidad se
decide por `EstadoLiga.codigo <> 'BORRADOR'`. SQL devuelve IDs, distancia y total; Prisma hidrata la
proyeccion publica y el repositorio reconstruye el orden. El DTO incluye
`ubicacion.nombreCompleto` y `distanceKm?`. Sin coordenadas se conserva Prisma con desempate por ID.

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
- **Jugador** es una entidad ligada a un `User` vía `phoneNumber` (perfil "mi perfil"). No tiene dorsal global: el dorsal actual pertenece a `EquipoJugador` y se resuelve siempre por `equipoId`. `DivisionJugador.dorsal` preserva la plantilla de la división y se sincroniza cuando el dueño cambia el dorsal del equipo; los dorsales de anotaciones y participaciones son snapshots históricos y no se reescriben.

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

## Mínimo de partidos para eliminatorias (`minPartidosEliminatoria`)

Campo de `Division`, **0 por defecto = sin requisito**, así que ninguna división existente cambia de
comportamiento. Solo tiene sentido con `registrarParticipaciones` encendido: sin él no existe el
dato de quién jugó, y exigir un mínimo dejaría fuera al plantel entero — por eso
`elegibilidadService` lo ignora en ese caso.

**Qué partidos cuentan** — [`elegibilidad/service.ts`](src/modules/elegibilidad/service.ts),
`participacionesQueCuentan`: finalizados, de la fase regular (`rondaPlayoffId: null`), y

| Tipo | Cuenta |
|---|---|
| `REGULAR` | Sí, los dos equipos |
| `COMPLEMENTO` | **Solo `ladoMarcador: 'LOCAL'`**, el que suma puntos |
| `AMISTOSO` | No |
| Del cuadro | No |

Lo del complemento no es arbitrario: es el mismo criterio de `tablaPosicion.recalcular`, donde el
visitante "repite sin puntos" y tampoco recibe nada. Se agrupa por `jugadorIdSnapshot`, que
sobrevive a la baja del jugador.

**Dónde se bloquea**: en `resultWriter`, junto a las validaciones que ya existen de la lista de
participantes, y solo si el partido es de eliminatoria y el mínimo es mayor que 0. El error nombra a
los jugadores y sus partidos.

**La excepción no necesita un permiso propio.** `writeResultInTransaction` no recibe el actor, pero
su llamador en `partido/service.ts` ya pasó por `assertOwnerOrAdmin` y el del árbitro no. Así que la
autorización es un campo del input, `permitirInelegibles`, **declarado solo en `resultSchema`**: los
dos esquemas son `.strict()`, de modo que la petición del árbitro se **rechaza** si lo trae. Hay un
test en `referee-access/validator.test.ts` que detiene a quien lo agregue "por simetría".

## El complemento (`tipo: 'complemento'`)

Un partido de relleno para que un equipo atrasado alcance a los demás. Tiene dos lados asimétricos:
**"Puntos"** (`equipoLocalId`, el único que suma en la tabla — ver `tablaPosicion.recalcular`) y
**"Sin puntos"** (`equipoVisitanteId`, que repite partido sin recibir nada).

**Los dos lados pueden repetir.** El efecto de Puntos sobre los regulares depende de la paridad del
grupo que queda por emparejar:

| Equipo de "Puntos" | Efecto |
|---|---|
| Sin slot regular y grupo impar | Queda reservado: absorbe al sobrante y no juega regular. |
| Sin slot regular y grupo par | Conserva un regular automático y además juega el complemento. |
| Con un regular asignado a mano | Conserva su regular **y** juega el complemento. |

**Solo un slot regular impide que Puntos absorba el descanso.** Son los únicos que el servidor
procesa antes y que alimentan `usedTeamIds`; un amistoso no reserva a nadie. Entre los equipos de
Puntos libres se reserva como máximo uno, y únicamente si el grupo regular es impar. El cliente
replica esa regla en [`utils/descanso.ts`](../frontend/src/features/division/utils/descanso.ts): de
ahí salen el aviso de "elige quién descansa" y `maxRegularSlots`, y los **tres** llamadores de
`getActiveSlots` reciben ese conteo, no `habilitados.length`. Si divergen, la pantalla muestra un
slot que la generación no puede llenar.

Con habilitados impares, si todos los equipos de Puntos ya tienen regular, el complemento no cubre
el descanso: el request debe incluir `descansoEquipoId`. Esa es la única combinación válida de
complemento y descanso; si algún Puntos libre ya absorbe al sobrante, mandar ambos se rechaza.

**Un complemento NO cuenta como que esa pareja ya se enfrentó**, y es deliberado.
`buildHistoricalMatchCounts(existing, 'REGULAR')` descarta cualquier otro tipo, así que A vs B en un
complemento no impide que el calendario los cruce en un regular — ni siquiera el mismo día, porque
el filtro de parejas duplicadas exime a los complementos. El complemento empareja calendarios; el
enfrentamiento de verdad sigue pendiente. Los amistosos sí llevan historial propio y prohíben
repetir pareja.

## Reparto de equipos a slots (`generateNext`)

**Dos pasadas, y el orden no es cosmético**: primero los slots que ya traen un equipo puesto a mano,
después los vacíos.

En una sola pasada un slot vacío anterior tomaba "el primer equipo sin partido" y podía llevarse al
equipo fijado en un slot **posterior**, junto con su rival. Al llegar a ese slot se rearmaba la misma
pareja y el filtro de duplicados la descartaba: la jornada se guardaba con **un partido menos y dos
equipos habilitados sin jugar, sin ningún error**. El único rastro eran los partidos jugados
descuadrados en la tabla de posiciones. Se disparaba siempre que hubiera un slot vacío antes de uno
con equipo fijado — por ejemplo, fijar un equipo en el primer slot y otro en el noveno.

**Un slot que se queda sin equipos ya no se descarta en silencio.** Si al terminar el reparto sobran
dos o más equipos sin emparejar, `generateNext` lanza `ValidationError`. El umbral es dos porque con
un número impar de equipos siempre sobra uno, y ese descansa.

`computeMinimumHistoryMatching` ([`regularMatching.ts`](src/modules/jornada/regularMatching.ts)) **no
crea aristas entre dos equipos fijados**: están clavados en slots distintos y no pueden jugar entre
sí. Consecuencia medida: cada fijado necesita consumir un equipo libre como rival, así que si los
fijados superan a los libres, los sobrantes se quedan sin pareja. Con los slots acotados a
`ceil(equipos / 2)` y un fijado por slot eso no debería alcanzarse, pero es la razón de que exista la
red de arriba.

Lo cubre [`generateNext.pinned-slots.test.ts`](src/modules/jornada/__tests__/generateNext.pinned-slots.test.ts).

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

**`division.resetDivision` tampoco se bloquea**, y además **devuelve la división a `EN_CURSO`** si
estaba en un estado de solo lectura. Es la acción que se hace sobre una división cerrada para
reutilizarla —la división se auto-finaliza al cerrarse la final—, y sin reabrirla quedaría vacía
pero todavía bloqueada, sin poder generar siquiera el cuadro nuevo. Un borrador se queda en borrador.

**Excepción deliberada: `campeon.assign` y `remove` no se bloquean.** Coronar es el acto de cierre;
bloquearlo en Finalizada haría imposible cerrar una división después de marcarla como tal. Y con el
cierre automático de abajo eso dejó de ser hipotético: para cuando toca coronar, la división **ya
está** finalizada.

**Cierre automático al terminar el cuadro.** `resultWriter` finaliza la división sola cuando el
resultado que se guarda cierra la última ronda (`finalizarDivisionSiTerminoElCuadro`, misma
transacción, justo después de `syncAdvancement`). Va en el servidor porque la final también puede
cerrarla un árbitro desde su enlace por token, y los dos caminos escriben por ahí.

- **Desde `BORRADOR` no se finaliza**: `FINALIZADA` es pública y un cuadro jugado en borrador es una
  prueba, no un torneo que se publica solo.
- No hay guarda contra "ya finalizada": esos estados son de solo lectura, así que el gate del
  principio rechaza la escritura y no se llega. Es la razón de que **corregir la final exija reabrir
  la división** — de ahí la acción "Reabrir división" en la app.
- Si falta la fila `FINALIZADA` del catálogo se omite en silencio: un hueco ahí no puede tumbar la
  captura de un resultado.

**`isCuadroCompleto`** ([`utils/bracketCompletion.ts`](src/utils/bracketCompletion.ts)) es la única
definición de "el cuadro terminó" —última ronda por `orden`, con partidos, todos `FINALIZADO`— y la
comparten el gate del campeón y el cierre automático.

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

**El palmarés es historia: una división acumula N títulos**, uno por temporada. `archivadoEn`
distingue el vigente (nulo) de los anteriores, y un **índice único parcial** por SQL crudo
—`ON ("divisionId") WHERE "archivadoEn" IS NULL`— garantiza como mucho un vigente por división.
Prisma no sabe declararlo, así que `assign` **no puede ser un `upsert`**: `saveVigente` actualiza el
vigente o crea, y el índice es el respaldo contra dos creaciones a la vez.

| Acción | Qué le hace al título |
|---|---|
| `rondaPlayoff.generate` | **Archiva el vigente.** Un cuadro nuevo es una temporada nueva, y es el único momento inequívoco. |
| `rondaPlayoff.delete` / `deleteByDivision` | **Nada.** Sigue vigente para que el dueño lo corrija con "Quitar campeón"; archivarlo ahí lo volvería irreversible. |
| `division.resetDivision` | **Archiva el vigente.** Reiniciar es la forma normal de arrancar la temporada siguiente: borrarlo destruiría al campeón de cada temporada. La marcha atrás de coronar mal es "Quitar campeón" **antes** de reiniciar. |
| `division.delete` | Nada explícito: `SetNull` deja los títulos huérfanos. |

**El palmarés sobrevive a la división.** `divisionId` es nullable con `SetNull`, y la fila guarda
`divisionNombre`, `ligaId`, `ligaNombre`, `ligaLogo` y **`divisionEstadoCodigo`** como snapshots que
escribe el servidor al coronar. Ese último resuelve la visibilidad de un huérfano, que ya no tiene
división contra la cual comprobarla:

- **División viva** → manda su estado de ahora (`visibleDivisionWhere`), como siempre.
- **División borrada** → manda el snapshot: se ve si `divisionEstadoCodigo` no es `BORRADOR`.

El estado va **por título y no por división** a propósito: una división puede haber coronado
campeones legítimos estando En Curso y terminar su vida en borrador. Con un solo dato de la división
se habrían escondido todos.

**Palmarés por equipo**: `GET /api/campeones/equipo/:equipoId` devuelve las divisiones que ganó un
equipo —vigentes, archivadas y huérfanas—, ordenadas por `createdAt` descendente, con la regla de
visibilidad de arriba. **No se puede derivar de `DivisionEquipo`**: ese pivote es la inscripción, y
al sacar al equipo de la división desaparece, mientras que el título sobrevive.

**Títulos anteriores de una división**: `GET /api/campeones/division/:divisionId/historial`, solo los
archivados, más nuevos primero.

**Palmarés de goleo de un jugador**: `GET /api/campeones/jugador/:jugadorId`. El campeón de goleo
**vive en la misma fila** que el de equipo (`jugadorId`, `jugadorNombre`, `jugadorFoto`,
`jugadorGoles`), así que hereda gratis los snapshots, el archivado y la supervivencia al borrado de
la división: no hay historial aparte que mantener. El `where` de visibilidad lo comparten las
lecturas de equipo y de jugador en `campeonVisibleWhere`, con un test que impide que se separen.

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
- Hasta siete procesadores single-flight reemplazan los pollers de 60 segundos; inbox y retencion solo se registran con `BILLING_REVENUECAT_ENABLED=true`, y la reconciliacion periodica exige ademas `BILLING_PERIODIC_RECONCILIATION_ENABLED=true`.
- Cada enqueue emite una señal después del commit; cada batch consulta `nextDueAt` para programar el timer exacto.
- El arranque consulta todas las colas para recuperar trabajo durable después de deploys o crashes.
- `stopWorkers()` cancela timers y espera el batch activo durante shutdown.
- Railway Cron ejecuta `pnpm maintenance` cada dos horas como red de recuperación; detalles en `BACKGROUND-JOBS.md`.
- Test: `src/workers/dueProcessor.test.ts`

El inbox `billing_webhook_events` recibe y deduplica eventos de RevenueCat. Su worker resuelve solamente identidades `billing_*` ya presentes en `BillingProviderIdentity`, consulta RevenueCat v2 y reconcilia el ledger con leases, retries, cuarentena y dead letters; no crea cuentas ni concede acceso. La excepcion observada del dashboard es `TEST` + `SANDBOX` con `APP_STORE` o `PLAY_STORE`, que termina como no-op sin identidad ni llamada al proveedor; `APP_STORE` sigue rechazado para eventos comerciales. El endpoint usa body crudo antes de `express.json`, rechaza `Content-Encoding` comprimido, guarda solo una proyección redactada y señala el worker después del commit. Siempre verifica Bearer. HMAC usa `REVENUECAT_WEBHOOK_SIGNATURE_MODE=disabled|observe|enforce`; los dos ultimos requieren signing secret. `observe` requiere `REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL`, como maximo 24 horas, y al vencer se comporta automaticamente como `enforce`; produccion habilitada no permite `disabled`. Para activar: habilitar signing en RevenueCat mientras el despliegue anterior sigue Bearer-only, copiar el secreto, validar con una ventana `observe` y desplegar `enforce`. Para rotar: abrir primero una ventana `observe`, rotar en RevenueCat y desplegar el secreto nuevo con `enforce` antes del vencimiento. Un segundo job purga payloads de eventos procesados según `BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS`.

La administracion del inbox vive en `/api/billing/admin/webhook-events` y exige `ADMINISTRADOR`. Listado y detalle nunca devuelven `payloadRedacted`; sus lecturas quedan en `BillingAuditLog`. El replay solo acepta `QUARANTINED` o `DEAD_LETTER`, requiere motivo e `Idempotency-Key`, reinicia a `PENDING` junto con una fila auditada en una sola transaccion y señala `billing-webhook` despues del commit. `BillingAuditLog` no tiene claves foraneas deliberadamente: sus IDs son snapshots y el trigger PostgreSQL rechaza update, delete y truncate para preservar el historial aunque desaparezca el actor o evento.

La reconciliacion periodica de RevenueCat es sparse y de costo controlado. Una cuenta gratuita ordinaria no recibe fila en `billing_revenuecat_reconciliations`; solo entra por evidencia de ledger existente, reconciliacion manual con suscripciones o webhook comercial con identidad resuelta. El flag queda apagado por defecto. Con el worker activo, estado normal se revisa cada 24 horas y gracia, pago fallido, cambio pendiente o evidencia bloqueante cada 6 horas. Webhook y worker reclaman el mismo lease durable por cuenta, por lo que nunca consultan RevenueCat a la vez; un webhook respeta tambien el `nextAttemptAt` de un retry. Claims usan `SKIP LOCKED`, lease de cinco minutos, heartbeat y reloj PostgreSQL; cada fila se reclama justo antes de procesarla, la llamada al proveedor ocurre fuera de transaccion y la escritura reutiliza el lock `billing-account:{id}`. No concede acceso ni crea identidades. Maintenance limita este job a diez batches por ejecucion.

La materializacion efectiva `STORE` esta separada por `BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED`, apagado por defecto y dependiente de RevenueCat. Ledger, seleccion de fuente y materializacion comparten una transaccion Serializable bajo el lock de cuenta. `BillingPeriod` no se superpone por cuenta; fuentes, grants y asignaciones tienen constraints PostgreSQL y las asignaciones se serializan en orden cuenta -> periodo -> division. Este modo sigue siendo sombra: `resolveAccountAccessPolicy`, cuotas, grants gratuitos, gates y `purchasesEnabled` no cambian.

`BillingLocalGrace` materializa en sombra fallos de cobro recuperables despues del fin canonico. El incidente, periodo fuente y deadline son durables e inmutables; repetir evidencia no reinicia el plazo. Una recuperacion crea otro `BillingPeriod` y copia asignaciones con `GRACE_RECOVERY`; nunca reabre el anterior. `billing-grace-expiry` es un worker local registrado aun con RevenueCat y materializacion apagados: usa el lock de cuenta, no llama al proveedor y crea como maximo un grant `PAID_EXPIRATION`. El resolver sombra usa reloj PostgreSQL y deja de autorizar al llegar a `endsAt` aunque el worker se retrase.

La expiracion normal y una terminacion inmediata sin gracia tambien crean como maximo un grant `PAID_EXPIRATION` dentro de la reconciliacion y el lock de cuenta. La seleccion es materializada desde la asignacion elegible mas antigua por `assignedAt` e ID; evidencia repetida no crea otro grant. El worker de checkout solo terminaliza `OWNERSHIP_CONFLICT` cuando el SDK reporto conflicto y la reconciliacion canonica devuelve `UNSAFE_OWNERSHIP`; cualquier otro caso permanece pendiente.

`BILLING_RESOURCE_ACCESS_SHADOW_ENABLED` depende de esa materializacion y observa mutaciones administrativas sin aplicarlas. El resolver por recurso produce `FULL`, `LIMITED_SETUP`, `READ_ONLY` o `BLOCKED` para divisiones, ligas y recursos compartidos; una duda bloquea la decision sombra, pero el observer captura errores y nunca bloquea la peticion legacy. Cada hook debe declarar una `ManagementCapability`; la matriz central registra `wouldAllow` y el campo requerido hace fallar el build si se omite. `FULL` permite las capacidades, `LIMITED_SETUP` solo el setup inicial, `READ_ONLY` solo `DELETE_RESOURCE`, y `BLOCKED` ninguna. No registra IDs de usuarios, cuentas, ligas, divisiones, periodos o proveedor. Al agregar una mutacion de division o un recurso compartido, conectar el observer despues de la autorizacion existente y dentro de la transaccion cuando ya haya una.

`BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED` depende de materializacion y shadow y permanece apagado por defecto. Cuando se active, el mismo resolver deja de ser solo observacional: toma el lock `billing-account:{id}` dentro de la transaccion funcional y lanza errores tipados antes de escribir. Nunca usar el wrapper no transaccional para una mutacion; falla con `BILLING_ENFORCEMENT_TRANSACTION_REQUIRED`. El orden global es cuenta de billing, periodo, division y despues lock de calendario. La creacion pagada de division consume su primer slot en la misma transaccion Serializable y reintenta `P2034`. Los DTO privados de liga/division solo agregan `managementAccess` y `managementReason` con enforcement activo.

La matriz PostgreSQL de enforcement cubre `FREE`, `PAID`, `LOCAL_GRACE`, fallback, evidencia contradictoria, recursos compartidos, borrados permitidos, DTOs privados, token arbitral y serializacion renovacion-asignacion. Los campos de management nunca se agregan a lecturas publicas anonimas ni a un usuario autenticado que no sea propietario o administrador. La carrera de renovacion debe observar una espera real en `pg_locks`; un `setTimeout` solo no demuestra el lock.

`BillingMigrationAccess` y `BillingMigrationDivision` conservan el inventario migratorio durable. Los comandos de censo y preparacion solo crean `PREPARED`, sin acceso ni reloj. Produccion se prepara exclusivamente con el wrapper protegido production-only: cohorte explicita de 1 a 10 cuentas, contexto Railway, token y confirmaciones de produccion/snapshot; no existe camino preview. La activacion administrativa exige un `BillingMigrationActivationReview` durable de 24 horas: el primer administrador crea la revision con fingerprints y blockers, un segundo administrador distinto la aprueba, y cada cuenta se activa explicitamente con `reviewId` e `Idempotency-Key`. La activacion vuelve a comprobar readiness y fingerprint bajo locks review -> cuenta; un cambio invalida la revision sin activar. Con billing operacional `ENABLED`, fija `startedAt`, `activatedAt` y el deadline de 30 dias con reloj PostgreSQL y cambia a `SELECTION_REQUIRED`; reintenta `P2034` hasta tres intentos y una repeticion posterior devuelve el estado persistido sin reiniciar fechas ni duplicar auditoria. `SELECTION_REQUIRED`, `SELECTED` y `PURCHASED` bloquean nuevas ligas y divisiones dentro de su transaccion funcional, independientemente de los flags de rollout. El usuario puede elegir una division capturada una sola vez (`SELECTED`); evidencia canonica pagada marca `PURCHASED`. El resolver da overlay `MIGRATION` solo a snapshots capturados y, si hay compra, deja `PAID` como base de los slots asignados. El worker local termina una vez en `APPLIED` y crea como maximo un grant `MIGRATION_SELECTION` o `MIGRATION_FALLBACK` cuando no hay acceso pagado. Las pausas operacionales abiertas suspenden expiracion solo para migraciones cuyo deadline era posterior al inicio de la pausa y, al cerrar, extienden cada deadline por la duracion exacta en milisegundos desde `max(pause.startedAt, migration.activatedAt)` hasta `pause.endedAt`; una pausa posterior nunca revive acceso vencido. La aplicacion append-only conserva `extensionMilliseconds` exacto y `extensionSeconds` redondeado hacia arriba. Los snapshots de preparacion siguen siendo inmutables salvo `divisionId -> NULL`.

El ensayo manual de una cuenta legacy usa `create-legacy-billing-migration-candidate`, exclusivamente development-only. Requiere un `billingAccountId` canónico explícito cuyo propietario `LIGA` no tenga ligas, grants, periodos STORE ni migración. Bajo el lock de cuenta crea transaccionalmente una liga y dos divisiones sin grant; es idempotente solo para su forma exacta y nunca corrige ni borra datos existentes. No tiene variante preview/producción.

Las lecturas operativas `GET /api/billing/admin/migrations/summary`, `GET /api/billing/admin/migrations` y `GET /api/billing/admin/migrations/:billingAccountId` son ADMIN-only (`ADMINISTRADOR`) y cada consulta crea auditoria en `BillingAuditLog`. El listado filtra `status` por uno o varios valores separados por coma, `deadline` por `OVERDUE|UPCOMING|NONE`, pagina con `cursor`/`nextCursor` y acepta `limit` de 1 a 100 (25 por defecto). Summary, listado y detalle exponen solo campos operativos y metadata de timeline allowlisted/redactada: nunca PII, payloads ni evidencia del proveedor. El detalle representa cada duracion aplicada con `extensionMilliseconds` exacto como string decimal, no con los segundos redondeados. Ninguna lectura activa cuentas; `POST /api/billing/admin/migrations/:billingAccountId/activate` permanece explicito y por cuenta, sin operacion masiva.

La reconciliacion development-only del foundation gratuito usa `audit-billing-free-foundation` y `reconcile-billing-free-foundation`. Procesa cada usuario en una transaccion Serializable con orden de locks owner -> account: cero divisiones obtiene account e identidad sin grant; una division obtiene grant inicial solo sin STORE ni historia de grants; multiples divisiones, detached e inconsistencias se bloquean. Es idempotente, audita solo escrituras reales y nunca cambia cuotas, DTOs o acceso publico.

`BillingOperationalControl` es el kill switch durable por ambiente. Ambas filas nacen `PURCHASES_PAUSED`; los endpoints admin `GET/PUT /api/billing/admin/operational-control` exigen `ADMINISTRADOR`, y el cambio exige motivo, version esperada e `Idempotency-Key`. La escritura usa lock por ambiente, transaccion Serializable, CAS de version y auditoria atomica. `purchasesEnabled` solo puede ser true con `BILLING_PURCHASES_ENABLED`, RevenueCat, materializacion, catalogo valido y modo `ENABLED`; cualquier ausencia o error falla cerrado. El flag permanece false antes del lanzamiento.

La promoción del catálogo fuera de development usa exclusivamente `billing-catalog-promotion-script.mjs`. Carga y activación son acciones separadas, fijadas al manifest `2026-09-mx-v1` y su SHA-256 aprobado. Preview exige Railway `staging`; producción exige Railway `production`, `PRODUCTION_MIGRATION_TOKEN`, snapshot y confirmaciones explícitas. El wrapper valida target y URLs antes de cargar TypeScript, elimina secretos heredados e inyecta una autorización efímera; ejecutar `prisma/promote-billing-catalog.ts` directamente falla. La carga exacta y la activación exacta son idempotentes, pero nunca se corrige una release divergente ni retirada. Activar una release no modifica flags ni `BillingOperationalControl`.

`BillingPurchaseSelection` prepara en forma durable las asignaciones del primer periodo pagado. `GET/PUT /api/billing/purchase-selection` exige `LIGA`; capacidad y slots se derivan del catalogo, el grant gratuito ocupa el slot 1 fijo y el cliente envia solo IDs editables. Preparar `DRAFT` no depende del kill switch. Iniciar comercio pasa exclusivamente por `BillingCheckoutAttempt`: exige `purchasesEnabled=true`, crea snapshots e idempotencia y cambia la seleccion a `LOCKED` en la misma transaccion. Los outcomes del SDK solo crean trabajo de `BillingVerification`; no conceden acceso. El worker `billing-checkout` reconcilia RevenueCat con leases y backoff, libera una cancelacion o abandona un `PREPARED` de una hora solo despues de probar ausencia de evidencia, y la materializacion STORE consume la seleccion y marca intento/verificacion `VERIFIED` bajo el lock de cuenta.

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
- **Aislamiento**: la base local completa es descartable, por lo que `TEST_DATABASE_URL` puede compartirla con development, pero nunca con runtime externo, preview, produccion o shadow. Antes de cualquier DDL exige conexión directa, fija `schema` y `search_path` en `tenka_integration`, comprueba el valor efectivo y el global setup hace `DROP SCHEMA … CASCADE` solo sobre ese schema.
- **SQL destructivo raw**: nunca pongas `TRUNCATE`, `DROP` o `$executeRawUnsafe` directamente en un archivo `*.integration.test.ts`. Usa un helper central de `src/test/integration/` que llame `configureRawQuerySchema` y compruebe `current_schema() = 'tenka_integration'` antes de ejecutar. El parámetro `schema` de Prisma no configura el `search_path` del adapter para SQL raw.
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
