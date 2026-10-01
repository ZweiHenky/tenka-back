import { NotFoundError } from '../../utils/errors';
import { prisma } from '../../config/database';
import { tablaPosicionRepository } from './repository';
import type { TablaPosicionEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import { observeResourceAccessShadowInTransaction } from '../billing/resourceAccessShadow';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import type { Prisma } from '../../generated/prisma/client';

async function assertDivisionOwner(divisionId: string, actor: AuthenticatedUser): Promise<void> {
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { liga: { select: { userId: true } } },
  });
  if (!division) throw new NotFoundError('División');
  assertOwnerOrAdmin(actor, division.liga.userId, 'División');
}

export const tablaPosicionService = {
  async findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<TablaPosicionEntity[]> {
    const division = await tablaPosicionRepository.findByDivision(divisionId, actor);
    if (!division) throw new NotFoundError('División');
    if (division.tablaPosiciones.length > 0) return division.tablaPosiciones;

    const teams = await tablaPosicionRepository.findTeamsByDivision(divisionId, actor);
    if (!teams) throw new NotFoundError('División');
    return teams.equipos.map((t) => ({
      id: `placeholder-${t.equipoId}`,
      partidosJugados: 0,
      ganados: 0,
      empatados: 0,
      perdidos: 0,
      golesFavor: 0,
      golesContra: 0,
      diferenciaGoles: 0,
      puntos: 0,
      divisionId,
      equipoId: t.equipoId,
      equipo: t.equipo,
    }));
  },

  async recalcular(divisionId: string, transaction?: Prisma.TransactionClient): Promise<void> {
    const recalculate = async (tx: Prisma.TransactionClient): Promise<void> => {
      const [teams, partidos] = await Promise.all([
        tx.divisionEquipo.findMany({
          where: { divisionId },
          select: { equipoId: true },
        }),
        tx.partido.findMany({
          where: {
            jornada: { divisionId },
            estado: 'FINALIZADO',
            rondaPlayoffId: null,
          },
          select: {
            equipoLocalId: true,
            equipoVisitanteId: true,
            golesLocal: true,
            golesVisitante: true,
            penalesLocal: true,
            penalesVisitante: true,
            tipoPartido: true,
          },
        }),
      ]);

      const stats = new Map<string, { pj: number; g: number; e: number; p: number; gf: number; gc: number; gp: number }>();

      for (const equipoId of teams.map((t) => t.equipoId)) {
        stats.set(equipoId, { pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, gp: 0 });
      }

      for (const p of partidos) {
      if (!p.equipoLocalId || !p.equipoVisitanteId) continue;
      const local = stats.get(p.equipoLocalId);
      const visit = stats.get(p.equipoVisitanteId);
      if (!local || !visit) continue;

      if (p.tipoPartido === 'AMISTOSO') {
        continue;
      }
      if (p.tipoPartido === 'COMPLEMENTO') {
        local.pj++;
        local.gf += p.golesLocal;
        local.gc += p.golesVisitante;
        if (p.golesLocal > p.golesVisitante) local.g++;
        else if (p.golesLocal < p.golesVisitante) local.p++;
        else {
          local.e++;
          const tienePenales = p.penalesLocal != null && p.penalesVisitante != null;
          if (tienePenales && p.penalesLocal! !== p.penalesVisitante! && p.penalesLocal! > p.penalesVisitante!) {
            local.gp++;
          }
        }
        continue;
      }

      local.pj++;
      visit.pj++;
      local.gf += p.golesLocal;
      local.gc += p.golesVisitante;
      visit.gf += p.golesVisitante;
      visit.gc += p.golesLocal;

      if (p.golesLocal > p.golesVisitante) {
        local.g++;
        visit.p++;
      } else if (p.golesLocal < p.golesVisitante) {
        local.p++;
        visit.g++;
      } else {
        local.e++;
        visit.e++;
        const tienePenales = p.penalesLocal != null && p.penalesVisitante != null;
        if (tienePenales && p.penalesLocal !== p.penalesVisitante) {
          if (p.penalesLocal! > p.penalesVisitante!) {
            local.gp++;
          } else {
            visit.gp++;
          }
        }
      }
      }

      const data: { divisionId: string; equipoId: string; partidosJugados: number; ganados: number; empatados: number; perdidos: number; golesFavor: number; golesContra: number; diferenciaGoles: number; puntos: number }[] = [];

      for (const t of teams) {
      const s = stats.get(t.equipoId)!;
      data.push({
        divisionId,
        equipoId: t.equipoId,
        partidosJugados: s.pj,
        ganados: s.g,
        empatados: s.e,
        perdidos: s.p,
        golesFavor: s.gf,
        golesContra: s.gc,
        diferenciaGoles: s.gf - s.gc,
        puntos: s.g * 3 + s.e + s.gp,
      });
      }

      data.sort((a, b) => b.puntos - a.puntos || (b.diferenciaGoles - a.diferenciaGoles));

      await tx.tablaPosicion.deleteMany({ where: { divisionId } });
      await tx.tablaPosicion.createMany({ data });
    };

    if (transaction) {
      await recalculate(transaction);
      return;
    }
    await prisma.$transaction(recalculate, { isolationLevel: 'RepeatableRead' });
  },

  async findOne(divisionId: string, equipoId: string, actor?: AuthenticatedUser): Promise<TablaPosicionEntity> {
    const division = await tablaPosicionRepository.findOne(divisionId, equipoId, actor);
    if (!division) throw new NotFoundError('División');
    const position = division.tablaPosiciones[0];
    if (!position) throw new NotFoundError('Posición');
    return position;
  },

  async upsert(divisionId: string, equipoId: string, data: Record<string, unknown>, actor: AuthenticatedUser): Promise<TablaPosicionEntity> {
    await assertDivisionOwner(divisionId, actor);
    return prisma.$transaction(async (tx) => {
      await observeResourceAccessShadowInTransaction(tx, { operation: 'standings.upsert', capability: 'MANAGE_DIVISION', actor, divisionId, resourceType: 'DIVISION' });
      return tx.tablaPosicion.upsert({
        where: { divisionId_equipoId: { divisionId, equipoId } },
        create: { divisionId, equipoId, ...data } as any,
        update: data,
      });
    });
  },

  async delete(divisionId: string, equipoId: string, actor: AuthenticatedUser): Promise<void> {
    await assertDivisionOwner(divisionId, actor);
    await prisma.$transaction(async (tx) => {
      await observeResourceAccessShadowInTransaction(tx, { operation: 'standings.delete', capability: 'MANAGE_DIVISION', actor, divisionId, resourceType: 'DIVISION' });
      await tx.tablaPosicion.delete({ where: { divisionId_equipoId: { divisionId, equipoId } } });
    });
  },
};
