import { NotFoundError, ValidationError } from '../../utils/errors';
import { prisma } from '../../config/database';
import { rondaPlayoffRepository } from './repository';
import type { RondaPlayoffEntity, RondaPlayoffReadEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin, isAdmin } from '../../utils/authorization';
import { assertVisibleDivision, visibleDivisionWhere } from '../../utils/divisionVisibility';

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

export const rondaPlayoffService = {
  async list(actor?: AuthenticatedUser): Promise<RondaPlayoffEntity[]> {
    return prisma.rondaPlayoff.findMany({ where: { division: visibleDivisionWhere(actor) } });
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
    const ronda = await findForWrite(id, actor);
    await assertDivisionOwner(ronda.divisionId, actor);
    await rondaPlayoffRepository.delete(id);
  },

  async deleteByDivision(divisionId: string, actor: AuthenticatedUser): Promise<void> {
    await assertDivisionOwner(divisionId, actor);
    await rondaPlayoffRepository.deleteByDivision(divisionId);
  },

  async generate(divisionId: string, cantidadEquipos: number, actor: AuthenticatedUser): Promise<RondaPlayoffEntity[]> {
    const division = await prisma.division.findFirst({
      where: isAdmin(actor) ? { id: divisionId } : { id: divisionId, liga: { userId: actor.id } },
      select: {
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

    if (!CANTIDADES_EQUIPOS.includes(cantidadEquipos)) {
      throw new ValidationError('La cantidad debe ser 2, 4, 8, 16 o 32');
    }

    if (division.equipos.length < cantidadEquipos) {
      throw new ValidationError(`Se necesitan al menos ${cantidadEquipos} equipos asignados a la división`);
    }

    const clasificados = division.equipos
      .map(({ equipoId, equipo }) => ({
        equipoId,
        nombre: equipo.nombre,
        puntos: equipo.tablaPosiciones[0]?.puntos ?? 0,
        diferenciaGoles: equipo.tablaPosiciones[0]?.diferenciaGoles ?? 0,
        ganados: equipo.tablaPosiciones[0]?.ganados ?? 0,
        golesFavor: equipo.tablaPosiciones[0]?.golesFavor ?? 0,
      }))
      .sort((a, b) =>
        b.puntos - a.puntos
        || b.diferenciaGoles - a.diferenciaGoles
        || b.ganados - a.ganados
        || b.golesFavor - a.golesFavor
        || spanishNameCollator.compare(a.nombre, b.nombre)
        || a.equipoId.localeCompare(b.equipoId),
      )
      .slice(0, cantidadEquipos);
    const nombresRonda = NOMBRES_RONDAS[cantidadEquipos];
    return prisma.$transaction(async (tx) => {
      const rondas = await tx.rondaPlayoff.createManyAndReturn({
        data: nombresRonda.map((nombre, index) => ({
          nombre,
          orden: index + 1,
          divisionId,
        })),
      });
      rondas.sort((a, b) => a.orden - b.orden);

      const primeraRonda = rondas[0];
      await tx.partido.createMany({
        data: Array.from({ length: clasificados.length / 2 }, (_, i) => ({
          equipoLocalId: clasificados[i].equipoId,
          equipoVisitanteId: clasificados[clasificados.length - 1 - i].equipoId,
          llave: i + 1,
          rondaPlayoffId: primeraRonda.id,
          estado: 'PROGRAMADO' as const,
          tipoPartido: 'ELIMINATORIA' as const,
        })),
      });

      return rondas;
    });
  },

  async advanceWinners(fromRondaPlayoffId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
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
      const pairCount = Math.ceil(currentRoundPartidos.length / 2);
      const creates = [];
      const updates: Array<{ id: string; equipoLocalId: string; equipoVisitanteId: string }> = [];

      for (let i = 1; i <= pairCount; i++) {
        const partidoA = currentPartidos.get(i * 2 - 1);
        const partidoB = currentPartidos.get(i * 2);
        if (!partidoA || !partidoB) continue;
        if (partidoA.estado !== 'FINALIZADO' || partidoB.estado !== 'FINALIZADO') continue;

        const winnerA = getWinner(partidoA);
        const winnerB = getWinner(partidoB);
        if (!winnerA || !winnerB) continue;

        const existing = nextPartidos.get(i);
        if (existing) {
          updates.push({ id: existing.id, equipoLocalId: winnerA, equipoVisitanteId: winnerB });
        } else {
          creates.push({
            equipoLocalId: winnerA,
            equipoVisitanteId: winnerB,
            llave: i,
            rondaPlayoffId: nextRound.id,
            estado: 'PROGRAMADO' as const,
            tipoPartido: 'ELIMINATORIA' as const,
          });
        }
      }

      await Promise.all([
        ...(creates.length ? [tx.partido.createMany({ data: creates })] : []),
        ...updates.map(({ id, ...data }) => tx.partido.update({
          where: { id },
          data: { ...data, estado: 'PROGRAMADO', golesLocal: 0, golesVisitante: 0, penalesLocal: null, penalesVisitante: null },
        })),
      ]);
    });
  },
};
