import { prisma } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin } from '../../utils/authorization';

type DirectAssignment = { partidoId: string; arbitroIds: string[] };
type DivisionMatches = { id: string; partidos: Array<{ id: string; fecha: Date | null; fechaFin: Date | null }> };
export type RefereeCandidatePagination = { page: number; limit: number; skip: number; take: number };

export const overlaps = (a: Date, b: Date, c: Date, d: Date) => a < d && b > c;

export function planLeagueAssignments(divisionIds: string[], assignments: DirectAssignment[], divisions: DivisionMatches[], activeRefereeIds: string[], existing: Array<{ arbitroId: string; fecha: Date | null; fechaFin: Date | null }> = []) {
  if (new Set(divisionIds).size !== divisionIds.length) throw new ValidationError('Las divisiones no pueden repetirse');
  if (divisions.length !== divisionIds.length) throw new ValidationError('Todas las divisiones deben pertenecer a la liga');
  const partidoIds = assignments.map((assignment) => assignment.partidoId);
  if (new Set(partidoIds).size !== partidoIds.length) throw new ValidationError('Los partidos no pueden repetirse');

  const matches = new Map(divisions.flatMap((division) => division.partidos).map((match) => [match.id, match]));
  const active = new Set(activeRefereeIds);
  const intervals = new Map<string, Array<{ start: Date; end: Date }>>();
  for (const row of existing) {
    if (row.fecha && row.fechaFin) intervals.set(row.arbitroId, [...(intervals.get(row.arbitroId) ?? []), { start: row.fecha, end: row.fechaFin }]);
  }
  const rows: Array<{ partidoId: string; arbitroId: string }> = [];
  for (const assignment of assignments) {
    const match = matches.get(assignment.partidoId);
    if (!match) throw new ValidationError('Todos los partidos deben pertenecer a una división seleccionada');
    if (new Set(assignment.arbitroIds).size !== assignment.arbitroIds.length) throw new ValidationError('Los árbitros no pueden repetirse en un partido');
    if (assignment.arbitroIds.some((id) => !active.has(id))) throw new ValidationError('Todos los árbitros deben estar activos y pertenecer a la liga');
    if (assignment.arbitroIds.length && (!match.fecha || !match.fechaFin || match.fecha >= match.fechaFin)) throw new ValidationError('Los partidos con árbitros deben tener fecha y fechaFin válidas');
    for (const arbitroId of assignment.arbitroIds) {
      if ((intervals.get(arbitroId) ?? []).some((interval) => overlaps(match.fecha!, match.fechaFin!, interval.start, interval.end))) {
        throw new ValidationError('Un árbitro no puede tener partidos en horarios traslapados');
      }
      intervals.set(arbitroId, [...(intervals.get(arbitroId) ?? []), { start: match.fecha!, end: match.fechaFin! }]);
      rows.push({ partidoId: assignment.partidoId, arbitroId });
    }
  }
  return rows;
}

const partidoRelations = {
  equipoLocal: { select: { id: true, nombre: true, logo: true } }, equipoVisitante: { select: { id: true, nombre: true, logo: true } },
  cancha: { select: { id: true, nombre: true } }, arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
} as const;

const candidateMatchSelect = {
  id: true,
  fecha: true,
  fechaFin: true,
  equipoLocal: { select: { id: true, nombre: true } },
  equipoVisitante: { select: { id: true, nombre: true } },
  cancha: { select: { id: true, nombre: true } },
  arbitros: { select: { arbitro: { select: { id: true, nombre: true } } } },
} as const;

const candidateDivisionSelect = {
  id: true,
  nombre: true,
  jornadas: {
    orderBy: { numero: 'asc' },
    select: { id: true, numero: true, partidos: { where: { tandas: { none: {} } }, orderBy: { fecha: 'asc' }, select: candidateMatchSelect } },
  },
  rondasPlayoff: {
    orderBy: { orden: 'asc' },
    select: { id: true, nombre: true, orden: true, partidos: { where: { tandas: { none: {} } }, orderBy: { fecha: 'asc' }, select: candidateMatchSelect } },
  },
} as const;

const partidoInclude = {
  jornada: { select: { id: true, numero: true, division: { select: { id: true, nombre: true } } } },
  rondaPlayoff: { select: { id: true, nombre: true, division: { select: { id: true, nombre: true } } } },
  ...partidoRelations,
} as const;

async function ownLeague(ligaId: string, actor: AuthenticatedUser) {
  const league = await prisma.liga.findUnique({ where: { id: ligaId }, select: { userId: true } });
  if (!league) throw new NotFoundError('Liga');
  assertOwnerOrAdmin(actor, league.userId, 'Liga');
}
async function ownBatch(ligaId: string, tandaId: string, actor: AuthenticatedUser) {
  const batch = await prisma.tandaArbitral.findFirst({
    where: { id: tandaId, ligaId },
    select: { id: true, ligaId: true, liga: { select: { userId: true } } },
  });
  if (!batch) throw new NotFoundError('Tanda arbitral');
  assertOwnerOrAdmin(actor, batch.liga.userId, 'Liga');
  return batch;
}
async function activeReferees(ligaId: string, ids?: string[]) {
  const rows = await prisma.ligaArbitro.findMany({ where: { ligaId, activo: true, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, nombre: true } });
  if (ids && rows.length !== ids.length) throw new ValidationError('Todos los árbitros deben estar activos y pertenecer a la liga');
  return rows;
}

export const arbitrajeService = {
  async list(ligaId: string, actor: AuthenticatedUser) {
    const league = await prisma.liga.findUnique({
      where: { id: ligaId },
      select: { userId: true, tandasArbitrales: { orderBy: { createdAt: 'desc' }, include: { _count: { select: { partidos: true } } } } },
    });
    if (!league) throw new NotFoundError('Liga');
    assertOwnerOrAdmin(actor, league.userId, 'Liga');
    return league.tandasArbitrales;
  },
  async detail(ligaId: string, tandaId: string, actor: AuthenticatedUser) {
    const row = await prisma.tandaArbitral.findFirst({
      where: { id: tandaId, ligaId },
      include: { liga: { select: { userId: true } }, partidos: { include: { partido: { include: partidoInclude } } } },
    });
    if (!row) throw new NotFoundError('Tanda arbitral');
    assertOwnerOrAdmin(actor, row.liga.userId, 'Liga');
    const { liga: _liga, ...batch } = row;
    return { ...batch, partidos: row.partidos.map((p) => ({ ...p.partido, arbitros: p.partido.arbitros.map((a) => a.arbitro) })) };
  },
  async candidates(ligaId: string, actor: AuthenticatedUser, pagination?: RefereeCandidatePagination) {
    const league = await prisma.liga.findUnique({
      where: { id: ligaId },
      select: { userId: true },
    });
    if (!league) throw new NotFoundError('Liga');
    assertOwnerOrAdmin(actor, league.userId, 'Liga');
    const where = { ligaId };
    const [divisions, total] = await Promise.all([
      prisma.division.findMany({
        where,
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
        select: candidateDivisionSelect,
      }),
      pagination ? prisma.division.count({ where }) : Promise.resolve(0),
    ]);
    const rows = divisions.map((division) => ({
      ...division,
      jornadas: division.jornadas.map((jornada) => ({
        ...jornada,
        partidos: jornada.partidos.map((partido) => ({ ...partido, jornada: { id: jornada.id, numero: jornada.numero, division: { id: division.id, nombre: division.nombre } }, rondaPlayoff: null, arbitros: partido.arbitros.map((row) => row.arbitro) })),
      })),
      rondasPlayoff: division.rondasPlayoff.map((ronda) => ({
        ...ronda,
        partidos: ronda.partidos.map((partido) => ({ ...partido, jornada: null, rondaPlayoff: { id: ronda.id, nombre: ronda.nombre, division: { id: division.id, nombre: division.nombre } }, arbitros: partido.arbitros.map((row) => row.arbitro) })),
      })),
    }));
    return pagination ? { rows, total, page: pagination.page, limit: pagination.limit } : rows;
  },
  async removeAssignment(ligaId: string, assignmentId: string, actor: AuthenticatedUser) {
    await ownBatch(ligaId, assignmentId, actor);
    const links = await prisma.tandaArbitralPartido.findMany({ where: { tandaId: assignmentId }, select: { partidoId: true } });
    const partidoIds = links.map((link) => link.partidoId);
    await prisma.$transaction([
      prisma.partidoArbitro.deleteMany({ where: { partidoId: { in: partidoIds } } }),
      prisma.tandaArbitral.delete({ where: { id: assignmentId } }),
    ]);
  },
  async replaceLeagueAssignments(ligaId: string, actor: AuthenticatedUser, data: { asignacionId?: string; divisionIds: string[]; asignaciones: DirectAssignment[] }) {
    const partidoIds = data.asignaciones.map((assignment) => assignment.partidoId);
    let linkedIds: string[] = [];
    if (data.asignacionId) {
      await ownBatch(ligaId, data.asignacionId, actor);
      const links = await prisma.tandaArbitralPartido.findMany({ where: { tandaId: data.asignacionId }, select: { partidoId: true } });
      linkedIds = links.map((link) => link.partidoId);
      const linked = new Set(linkedIds);
      if (partidoIds.some((id) => !linked.has(id))) throw new ValidationError('Solo se pueden editar partidos de la asignación indicada');
    } else {
      await ownLeague(ligaId, actor);
    }
    const conflictExclusions = linkedIds.length ? linkedIds : partidoIds;
    const refereeIds = [...new Set(data.asignaciones.flatMap((assignment) => assignment.arbitroIds))];
    const [divisions, referees, existingAssignments] = await Promise.all([
      prisma.division.findMany({
        where: { ligaId, id: { in: data.divisionIds } },
        select: {
          id: true,
          jornadas: { select: { partidos: { select: { id: true, fecha: true, fechaFin: true } } } },
          rondasPlayoff: { select: { partidos: { select: { id: true, fecha: true, fechaFin: true } } } },
        },
      }),
      activeReferees(ligaId, refereeIds),
      prisma.partidoArbitro.findMany({
        where: {
          arbitroId: { in: refereeIds },
          ...(conflictExclusions.length ? { partidoId: { notIn: conflictExclusions } } : {}),
          partido: { OR: [{ jornada: { division: { ligaId } } }, { rondaPlayoff: { division: { ligaId } } }] },
        },
        select: { arbitroId: true, partido: { select: { fecha: true, fechaFin: true } } },
      }),
    ]);
    const normalized = divisions.map((division) => ({
      id: division.id,
      partidos: [...division.jornadas.flatMap((jornada) => jornada.partidos), ...division.rondasPlayoff.flatMap((ronda) => ronda.partidos)],
    }));
    const existing = existingAssignments.map((row) => ({ arbitroId: row.arbitroId, fecha: row.partido.fecha, fechaFin: row.partido.fechaFin }));
    const rows = planLeagueAssignments(data.divisionIds, data.asignaciones, normalized, referees.map((referee) => referee.id), existing);
    let asignacionId = data.asignacionId;
    try {
      await prisma.$transaction(async (tx) => {
        if (!asignacionId) {
          const alreadyLinked = await tx.tandaArbitralPartido.findMany({ where: { partidoId: { in: partidoIds } }, select: { partidoId: true } });
          if (alreadyLinked.length) throw new ConflictError('Uno o más partidos ya pertenecen a una asignación arbitral');
          const now = new Date();
          const pad = (value: number) => String(value).padStart(2, '0');
          const nombre = `Asignación ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())} (${crypto.randomUUID().slice(0, 8)})`;
          const tanda = await tx.tandaArbitral.create({ data: { ligaId, nombre } });
          asignacionId = tanda.id;
          if (partidoIds.length) await tx.tandaArbitralPartido.createMany({ data: partidoIds.map((partidoId) => ({ tandaId: tanda.id, partidoId })) });
        }
        await tx.partidoArbitro.deleteMany({ where: { partidoId: { in: partidoIds } } });
        if (rows.length) await tx.partidoArbitro.createMany({ data: rows });
      });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictError('Uno o más partidos ya pertenecen a una asignación arbitral');
      throw error;
    }
    return { asignacionId: asignacionId!, partidosAsignados: data.asignaciones.filter((assignment) => assignment.arbitroIds.length > 0).length, asignacionesCreadas: rows.length };
  },
};
