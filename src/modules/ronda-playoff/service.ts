import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { assertDivisionWritable } from '../../utils/divisionState';
import { prisma } from '../../config/database';
import { rondaPlayoffRepository } from './repository';
import type { RondaPlayoffEntity, RondaPlayoffReadEntity } from './entity';
import type { Siembra } from './validator';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin, isAdmin } from '../../utils/authorization';
import { assertVisibleDivision, visibleDivisionWhere } from '../../utils/divisionVisibility';
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock';
import type { Prisma } from '../../generated/prisma/client';
import type { Pagination } from '../../utils/pagination';

async function assertDivisionOwner(divisionId: string, actor: AuthenticatedUser): Promise<void> {
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { liga: { select: { userId: true } } },
  });
  if (!division) throw new NotFoundError('División');
  assertOwnerOrAdmin(actor, division.liga.userId, 'División');
}

async function findForWrite(id: string, actor: AuthenticatedUser): Promise<RondaPlayoffEntity> {
  const ronda = await rondaPlayoffRepository.findById(id);
  if (!ronda) throw new NotFoundError('Ronda de playoff');
  await assertVisibleDivision(ronda.divisionId, actor);
  return ronda;
}

type WinnerFields = {
  golesLocal: number;
  golesVisitante: number;
  penalesLocal: number | null;
  penalesVisitante: number | null;
  equipoLocalId: string | null;
  equipoVisitanteId: string | null;
};

function getWinner(p: WinnerFields): string | null {
  if (p.golesLocal > p.golesVisitante) return p.equipoLocalId;
  if (p.golesVisitante > p.golesLocal) return p.equipoVisitanteId;
  if (p.penalesLocal != null && p.penalesVisitante != null) {
    if (p.penalesLocal > p.penalesVisitante) return p.equipoLocalId;
    if (p.penalesVisitante > p.penalesLocal) return p.equipoVisitanteId;
  }
  return null;
}

const NOMBRES_RONDAS: Record<number, string[]> = {
  2: ['Final'],
  4: ['Semifinal', 'Final'],
  8: ['Cuartos', 'Semifinal', 'Final'],
  16: ['Octavos', 'Cuartos', 'Semifinal', 'Final'],
  32: ['Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinal', 'Final'],
};

const CANTIDADES_EQUIPOS = [2, 4, 8, 16, 32];
const spanishNameCollator = new Intl.Collator('es', { sensitivity: 'base' });

type EquipoClasificable = {
  equipoId: string;
  nombre: string;
  puntos: number;
  diferenciaGoles: number;
  ganados: number;
  golesFavor: number;
};

/** Un cruce ya resuelto. Cada estrategia de siembra produce esta misma lista. */
type Llave = { equipoLocalId: string; equipoVisitanteId: string };

export interface GenerateOptions {
  siembra?: Siembra;
  llaves?: Llave[];
  /** Inyectable para poder fijar el sorteo en los tests. */
  random?: () => number;
}

/** Fisher-Yates sobre una copia; no toca el arreglo recibido. */
function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Siembra clásica: el mejor contra el peor. Es el comportamiento histórico y no debe cambiar. */
function llavesPorPosiciones(equipos: EquipoClasificable[], cantidadEquipos: number): Llave[] {
  const clasificados = [...equipos]
    .sort((a, b) => b.puntos - a.puntos
      || b.diferenciaGoles - a.diferenciaGoles
      || b.ganados - a.ganados
      || b.golesFavor - a.golesFavor
      || spanishNameCollator.compare(a.nombre, b.nombre)
      || a.equipoId.localeCompare(b.equipoId))
    .slice(0, cantidadEquipos);

  return Array.from({ length: clasificados.length / 2 }, (_, i) => ({
    equipoLocalId: clasificados[i].equipoId,
    equipoVisitanteId: clasificados[clasificados.length - 1 - i].equipoId,
  }));
}

function llavesAleatorias(equipos: EquipoClasificable[], cantidadEquipos: number, random: () => number): Llave[] {
  const sorteados = shuffled(equipos, random).slice(0, cantidadEquipos);
  return Array.from({ length: sorteados.length / 2 }, (_, i) => ({
    equipoLocalId: sorteados[i * 2].equipoId,
    equipoVisitanteId: sorteados[i * 2 + 1].equipoId,
  }));
}

/**
 * Las llaves manuales se validan contra los equipos que la división tiene **en este momento**,
 * dentro de la transacción: entre que el usuario armó el cuadro y lo envió, un equipo pudo
 * haberse dado de baja.
 */
function validarLlavesManuales(llaves: Llave[], equipos: EquipoClasificable[]): Llave[] {
  const porId = new Map(equipos.map((equipo) => [equipo.equipoId, equipo]));
  const vistos = new Map<string, number>();

  llaves.forEach((llave, index) => {
    // Antes que el chequeo de repetidos: un equipo duplicado dentro de la misma llave se
    // reportaría como "aparece en las llaves #1 y #1", que no le dice nada al usuario.
    if (llave.equipoLocalId === llave.equipoVisitanteId) {
      throw new ValidationError(`La llave #${index + 1} enfrenta a un equipo consigo mismo`);
    }
    for (const equipoId of [llave.equipoLocalId, llave.equipoVisitanteId]) {
      const equipo = porId.get(equipoId);
      if (!equipo) {
        throw new ValidationError(`El equipo de la llave #${index + 1} no está asignado a esta división`);
      }
      const anterior = vistos.get(equipoId);
      if (anterior !== undefined) {
        throw new ValidationError(`El equipo "${equipo.nombre}" aparece en las llaves #${anterior + 1} y #${index + 1}`);
      }
      vistos.set(equipoId, index);
    }
  });

  return llaves;
}

async function serializablePlayoffWrite<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, conflictMessage: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error: any) {
      if (error?.code === 'P2034' && attempt < 2) continue;
      if (error?.code === 'P2034' || error?.code === 'P2002') throw new ConflictError(conflictMessage);
      throw error;
    }
  }
  throw new ConflictError(conflictMessage);
}

/**
 * `Partido` cascadea desde `RondaPlayoff`, así que borrar las rondas se lleva los partidos del
 * cuadro **pero deja viva la jornada que los contenía**. En una división de puro cuadro esa jornada
 * solo tenía partidos del bracket, o sea que queda en cero y sigue apareciendo en el horario.
 *
 * Acotado a `partidos: { none: {} }`, así que una jornada que conserve los suyos —el caso de una
 * división de liga, que solo pierde los de playoff— no se toca.
 */
async function deleteEmptyJornadas(tx: Prisma.TransactionClient, divisionId: string): Promise<void> {
  await tx.jornada.deleteMany({ where: { divisionId, partidos: { none: {} } } });
}

/**
 * El campeón se declara a partir de la final. Si esa final deja de existir el título se queda sin
 * respaldo: la app volvería a esconder la acción de asignarlo mientras sigue mostrando el banner.
 */
async function deleteCampeon(tx: Prisma.TransactionClient, divisionId: string): Promise<void> {
  await tx.divisionCampeon.deleteMany({ where: { divisionId } });
}

async function lockedDivision(tx: Prisma.TransactionClient, divisionId: string, actor: AuthenticatedUser) {
  const lockTarget = await tx.division.findUnique({ where: { id: divisionId }, select: { ligaId: true } });
  if (!lockTarget) throw new NotFoundError('División');
  await acquireLeagueScheduleLock(tx, lockTarget.ligaId);
  const division = await tx.division.findUnique({
    where: { id: divisionId },
    select: { ligaId: true, estadoLiga: { select: { codigo: true } }, liga: { select: { userId: true } } },
  });
  if (!division) throw new NotFoundError('División');
  if (division.ligaId !== lockTarget.ligaId) throw new ConflictError('La división cambió de liga durante la operación; vuelve a intentarlo');
  assertOwnerOrAdmin(actor, division.liga.userId, 'División');
  assertDivisionWritable(division.estadoLiga);
  return division;
}

export const rondaPlayoffService = {
  async list(pagination: Pagination, actor?: AuthenticatedUser) {
    const where = { division: visibleDivisionWhere(actor) };
    const [rows, total] = await Promise.all([
      prisma.rondaPlayoff.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.take }),
      prisma.rondaPlayoff.count({ where }),
    ]);
    return { rows, total };
  },

  async getById(id: string, actor?: AuthenticatedUser): Promise<RondaPlayoffEntity> {
    const t = await rondaPlayoffRepository.findVisibleById(id, actor);
    if (!t) throw new NotFoundError('Ronda de playoff');
    return t;
  },

  async findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<RondaPlayoffReadEntity[]> {
    const rondas = await rondaPlayoffRepository.findVisibleByDivision(divisionId, actor);
    if (!rondas) throw new NotFoundError('División');
    return rondas;
  },

  async create(data: { nombre: string; orden: number; divisionId: string }, actor: AuthenticatedUser): Promise<RondaPlayoffEntity> {
    await assertDivisionOwner(data.divisionId, actor);
    return rondaPlayoffRepository.create(data);
  },

  async update(id: string, data: Record<string, unknown>, actor: AuthenticatedUser): Promise<RondaPlayoffEntity> {
    const ronda = await findForWrite(id, actor);
    await assertDivisionOwner(ronda.divisionId, actor);
    return rondaPlayoffRepository.update(id, data);
  },

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    await serializablePlayoffWrite(async (tx) => {
      const lockTarget = await tx.rondaPlayoff.findUnique({
        where: { id },
        select: { divisionId: true, division: { select: { ligaId: true } } },
      });
      if (!lockTarget) throw new NotFoundError('Ronda de playoff');
      await acquireLeagueScheduleLock(tx, lockTarget.division.ligaId);
      const ronda = await tx.rondaPlayoff.findUnique({
        where: { id },
        select: { orden: true, division: { select: { ligaId: true, estadoLiga: { select: { codigo: true } }, liga: { select: { userId: true } }, rondasPlayoff: { orderBy: { orden: 'desc' }, take: 1, select: { id: true } } } } },
      });
      if (!ronda) throw new NotFoundError('Ronda de playoff');
      if (ronda.division.ligaId !== lockTarget.division.ligaId) throw new ConflictError('La ronda cambió de liga durante la eliminación; vuelve a intentarlo');
      assertOwnerOrAdmin(actor, ronda.division.liga.userId, 'División');
      assertDivisionWritable(ronda.division.estadoLiga);
      if (ronda.division.rondasPlayoff[0]?.id !== id) {
        throw new ConflictError('Solo se puede eliminar la última ronda de playoff');
      }
      await tx.rondaPlayoff.delete({ where: { id } });
      await deleteEmptyJornadas(tx, lockTarget.divisionId);
      await deleteCampeon(tx, lockTarget.divisionId);
    }, 'Las rondas de playoff cambiaron durante la eliminación; vuelve a intentarlo');
  },

  async deleteByDivision(divisionId: string, actor: AuthenticatedUser): Promise<void> {
    await serializablePlayoffWrite(async (tx) => {
      await lockedDivision(tx, divisionId, actor);
      await tx.rondaPlayoff.deleteMany({ where: { divisionId } });
      await deleteEmptyJornadas(tx, divisionId);
      await deleteCampeon(tx, divisionId);
    }, 'Las rondas de playoff cambiaron durante la eliminación; vuelve a intentarlo');
  },

  async generate(
    divisionId: string,
    cantidadEquipos: number,
    actor: AuthenticatedUser,
    options: GenerateOptions = {},
  ): Promise<RondaPlayoffEntity[]> {
    if (!CANTIDADES_EQUIPOS.includes(cantidadEquipos)) {
      throw new ValidationError('La cantidad debe ser 2, 4, 8, 16 o 32');
    }
    const siembra = options.siembra ?? 'POSICIONES';
    if (siembra === 'MANUAL' && !options.llaves) {
      throw new ValidationError('La siembra manual necesita las llaves');
    }
    return serializablePlayoffWrite(async (tx) => {
      const lockTarget = await tx.division.findUnique({ where: { id: divisionId }, select: { ligaId: true } });
      if (!lockTarget) throw new NotFoundError('División');
      await acquireLeagueScheduleLock(tx, lockTarget.ligaId);
      const division = await tx.division.findFirst({
        where: isAdmin(actor) ? { id: divisionId } : { id: divisionId, liga: { userId: actor.id } },
        select: {
          ligaId: true,
          estadoLiga: { select: { codigo: true } },
          rondasPlayoff: { take: 1, select: { id: true } },
          equipos: {
            select: {
              equipoId: true,
              equipo: {
                select: {
                  nombre: true,
                  tablaPosiciones: {
                    where: { divisionId },
                    select: { puntos: true, diferenciaGoles: true, ganados: true, golesFavor: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!division) throw new NotFoundError('División');
      if (division.ligaId !== lockTarget.ligaId) throw new ConflictError('La división cambió de liga durante la generación; vuelve a intentarlo');
      assertDivisionWritable(division.estadoLiga);
      if (division.rondasPlayoff.length > 0) throw new ConflictError('La división ya tiene rondas de playoff');
      if (division.equipos.length < cantidadEquipos) {
        throw new ValidationError(`Se necesitan al menos ${cantidadEquipos} equipos asignados a la división`);
      }
      // Sin fase de liga la tabla no existe y todos entran en cero: la siembra por posiciones
      // degenera en orden alfabético, que es justo lo que hacía falta para el cuadro puro.
      const equipos: EquipoClasificable[] = division.equipos.map(({ equipoId, equipo }) => ({
        equipoId,
        nombre: equipo.nombre,
        puntos: equipo.tablaPosiciones[0]?.puntos ?? 0,
        diferenciaGoles: equipo.tablaPosiciones[0]?.diferenciaGoles ?? 0,
        ganados: equipo.tablaPosiciones[0]?.ganados ?? 0,
        golesFavor: equipo.tablaPosiciones[0]?.golesFavor ?? 0,
      }));

      const llaves = siembra === 'MANUAL'
        ? validarLlavesManuales(options.llaves!, equipos)
        : siembra === 'ALEATORIA'
          ? llavesAleatorias(equipos, cantidadEquipos, options.random ?? Math.random)
          : llavesPorPosiciones(equipos, cantidadEquipos);

      const rondas = await tx.rondaPlayoff.createManyAndReturn({
        data: NOMBRES_RONDAS[cantidadEquipos].map((nombre, index) => ({ nombre, orden: index + 1, divisionId })),
      });
      rondas.sort((a, b) => a.orden - b.orden);

      const primeraRonda = rondas[0];
      await tx.partido.createMany({ data: llaves.map((llave, i) => ({
          equipoLocalId: llave.equipoLocalId,
          equipoVisitanteId: llave.equipoVisitanteId,
          llave: i + 1,
          rondaPlayoffId: primeraRonda.id,
          estado: 'PROGRAMADO' as const,
          tipoPartido: 'ELIMINATORIA' as const,
        })) });

      return rondas;
    }, 'Las rondas de playoff ya existen o fueron generadas concurrentemente');
  },

  async syncAdvancement(tx: Prisma.TransactionClient, fromRondaPlayoffId: string): Promise<void> {
      const currentRound = await tx.rondaPlayoff.findUnique({
        where: { id: fromRondaPlayoffId },
        select: {
          orden: true,
          division: { select: { rondasPlayoff: { select: { id: true, orden: true } } } },
        },
      });
      if (!currentRound) throw new NotFoundError('Ronda de playoff');

      const nextRound = currentRound.division.rondasPlayoff.find(
        (ronda) => ronda.orden === currentRound.orden + 1,
      );
      if (!nextRound) return;

      const partidos = await tx.partido.findMany({
        where: { rondaPlayoffId: { in: [fromRondaPlayoffId, nextRound.id] } },
        select: {
          id: true,
          rondaPlayoffId: true,
          llave: true,
          estado: true,
          golesLocal: true,
          golesVisitante: true,
          penalesLocal: true,
          penalesVisitante: true,
          equipoLocalId: true,
          equipoVisitanteId: true,
          jornadaId: true,
        },
      });
      const currentRoundPartidos = partidos.filter(
        (partido) => partido.rondaPlayoffId === fromRondaPlayoffId,
      );
      const currentPartidos = new Map(
        currentRoundPartidos.map((partido) => [partido.llave, partido]),
      );
      const nextPartidos = new Map(
        partidos
          .filter((partido) => partido.rondaPlayoffId === nextRound.id)
          .map((partido) => [partido.llave, partido]),
      );
      const highestSourceKey = Math.max(0, ...currentRoundPartidos.map((partido) => partido.llave ?? 0));
      const highestDerivedKey = Math.max(0, ...Array.from(nextPartidos.keys()).filter((llave): llave is number => llave != null));
      const pairCount = Math.max(Math.ceil(highestSourceKey / 2), highestDerivedKey);

      for (let i = 1; i <= pairCount; i++) {
        const partidoA = currentPartidos.get(i * 2 - 1);
        const partidoB = currentPartidos.get(i * 2);
        const existing = nextPartidos.get(i);
        const winnerA = partidoA?.estado === 'FINALIZADO' ? getWinner(partidoA) : null;
        const winnerB = partidoB?.estado === 'FINALIZADO' ? getWinner(partidoB) : null;
        if (!winnerA || !winnerB) {
          if (!existing) continue;
          if (existing.estado === 'FINALIZADO' || existing.jornadaId) {
            throw new ConflictError('No se puede revertir el avance porque el partido derivado ya está finalizado o asignado a una jornada');
          }
          await tx.partido.delete({ where: { id: existing.id } });
          continue;
        }
        if (existing) {
          if (existing.equipoLocalId === winnerA && existing.equipoVisitanteId === winnerB) continue;
          if (existing.estado === 'FINALIZADO' || existing.jornadaId) {
            throw new ConflictError('No se puede cambiar el avance porque el partido derivado ya está finalizado o asignado a una jornada');
          }
          await tx.partido.update({
            where: { id: existing.id },
            data: { equipoLocalId: winnerA, equipoVisitanteId: winnerB, estado: 'PROGRAMADO', golesLocal: 0, golesVisitante: 0, penalesLocal: null, penalesVisitante: null, version: { increment: 1 } },
          });
          await tx.anotacionPartido.deleteMany({ where: { partidoId: existing.id } });
          await tx.participacionPartido.deleteMany({ where: { partidoId: existing.id } });
        } else {
          await tx.partido.create({ data: {
            equipoLocalId: winnerA,
            equipoVisitanteId: winnerB,
            llave: i,
            rondaPlayoffId: nextRound.id,
            estado: 'PROGRAMADO' as const,
            tipoPartido: 'ELIMINATORIA' as const,
          } });
        }
      }
  },

  async advanceWinners(fromRondaPlayoffId: string): Promise<void> {
    await serializablePlayoffWrite(async (tx) => {
      const lockTarget = await tx.rondaPlayoff.findUnique({ where: { id: fromRondaPlayoffId }, select: { division: { select: { ligaId: true } } } });
      if (!lockTarget) throw new NotFoundError('Ronda de playoff');
      await acquireLeagueScheduleLock(tx, lockTarget.division.ligaId);
      await this.syncAdvancement(tx, fromRondaPlayoffId);
    }, 'El cuadro de playoff cambió durante el avance; vuelve a intentarlo');
  },
};
