import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { ok, created, noContent } from '../../utils/response';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { assertOwnerOrAdmin, isAdmin } from '../../utils/authorization';
import { assignJugadorSchema, createJugadorSchema, createMeSchema, divisionJugadorSchema, updateJugadorSchema, updateMeSchema } from './validator';
import { mediaService } from '../media/service';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';

function sanitizePublic(jugador: any) {
  return {
    ...jugador,
    telefono: jugador.showPhoneInPublicProfile ? jugador.telefono : null,
    userId: undefined,
    fotoPublicId: undefined,
  };
}

async function assertTeamOwner(equipoId: string, req: Request) {
  const equipo = await prisma.equipo.findUnique({ where: { id: equipoId }, select: { userId: true } });
  if (!equipo) throw new NotFoundError('Equipo');
  assertOwnerOrAdmin(req.user!, equipo.userId, 'Equipo');
}

async function assertTeamInDivision(divisionId: string, equipoId: string) {
  const membership = await prisma.divisionEquipo.findUnique({
    where: { divisionId_equipoId: { divisionId, equipoId } },
  });
  if (!membership) throw new NotFoundError('Equipo');
}

const jugadorInclude = {
  equipos: {
    include: { equipo: { select: { id: true, nombre: true, logo: true } } },
  },
} as const;

export const jugadorController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { equipoId, search } = req.query;
      const where: any = {};
      if (equipoId) where.equipos = { some: { equipoId: equipoId as string } };
      if (search) where.nombre = { contains: search as string, mode: 'insensitive' };

      const jugadores = await prisma.jugador.findMany({
        where,
        orderBy: { nombre: 'asc' },
        include: jugadorInclude,
      });
      ok(res, jugadores.map(sanitizePublic));
    } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const jugador = await prisma.jugador.findUnique({
        where: { id: req.params.id },
        include: jugadorInclude,
      });
      if (!jugador) throw new ValidationError('Jugador no encontrado');
      ok(res, sanitizePublic(jugador));
    } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const p = createJugadorSchema.safeParse(req.body);
      if (!p.success) throw new ValidationError(p.error.issues[0].message);
      const { equipoId, dorsal, ...jugadorData } = p.data;
      await assertTeamOwner(equipoId, req);

      const jugador = await prisma.$transaction(async (tx) => {
        const existing = await tx.jugador.findUnique({ where: { telefono: jugadorData.telefono } });
        if (existing) {
          await tx.equipoJugador.create({ data: { equipoId, jugadorId: existing.id, dorsal } });
          return tx.jugador.findUniqueOrThrow({ where: { id: existing.id }, include: jugadorInclude });
        }
        return tx.jugador.create({
          data: {
            ...jugadorData,
            equipos: { create: { equipoId, dorsal } },
          },
          include: jugadorInclude,
        });
      });
      created(res, jugador, 'Jugador creado exitosamente');
    } catch (e: any) {
      if (e?.code === 'P2002') next(new ConflictError('Ese jugador ya está en este equipo o el dorsal ya está usado'));
      else next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const p = updateJugadorSchema.safeParse(req.body);
      if (!p.success) throw new ValidationError(p.error.issues[0].message);
      const { equipoId, dorsal, ...jugadorData } = p.data;

      if (!isAdmin(req.user!)) {
        if (!equipoId || dorsal == null || Object.keys(jugadorData).length > 0) {
          throw new ForbiddenError('Los dueños de equipo solo pueden actualizar el dorsal');
        }
        await assertTeamOwner(equipoId, req);
      } else if (equipoId) {
        await assertTeamOwner(equipoId, req);
      }

      if (jugadorData.foto !== undefined) {
        const old = await prisma.jugador.findUnique({ where: { id: req.params.id }, select: { foto: true, fotoPublicId: true } });
        if (old && jugadorData.foto !== old.foto) {
          await mediaService.scheduleImageCleanup(old.foto, old.fotoPublicId);
        }
      }

      const jugador = await prisma.$transaction(async (tx) => {
        if (dorsal != null && equipoId) {
          await tx.equipoJugador.update({
            where: { equipoId_jugadorId: { equipoId, jugadorId: req.params.id } },
            data: { dorsal },
          });
        }
        return Object.keys(jugadorData).length > 0
          ? tx.jugador.update({ where: { id: req.params.id }, data: jugadorData, include: jugadorInclude })
          : tx.jugador.findUniqueOrThrow({ where: { id: req.params.id }, include: jugadorInclude });
      });
      ok(res, jugador, 'Jugador actualizado exitosamente');
    } catch (e: any) {
      if (e?.code === 'P2002') next(new ConflictError('Ese dorsal ya está usado en este equipo'));
      else next(e);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const jugador = await prisma.jugador.findUnique({ where: { id: req.params.id }, select: { userId: true, foto: true, fotoPublicId: true } });
      if (!jugador) throw new NotFoundError('Jugador');
      if (!isAdmin(req.user!) && jugador.userId !== req.user!.id) throw new NotFoundError('Jugador');
      if (jugador) await mediaService.scheduleImageCleanup(jugador.foto, jugador.fotoPublicId);
      await prisma.jugador.delete({ where: { id: req.params.id } });
      noContent(res);
    } catch (e) { next(e); }
  },

  async assignToTeam(req: Request, res: Response, next: NextFunction) {
    try {
      const p = assignJugadorSchema.safeParse(req.body);
      if (!p.success) throw new ValidationError(p.error.issues[0].message);
      await assertTeamOwner(p.data.equipoId, req);
      const result = await prisma.equipoJugador.create({ data: p.data });
      created(res, result, 'Jugador asignado al equipo');
    } catch (e: any) {
      if (e?.code === 'P2002') next(new ConflictError('Ese jugador o dorsal ya está asignado en este equipo'));
      else next(e);
    }
  },

  async removeFromTeam(req: Request, res: Response, next: NextFunction) {
    try {
      await assertTeamOwner(req.params.equipoId, req);
      await prisma.equipoJugador.delete({
        where: { equipoId_jugadorId: { equipoId: req.params.equipoId, jugadorId: req.params.jugadorId } },
      });
      noContent(res);
    } catch (e) { next(e); }
  },

  async listDivisionsByPlayer(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await prisma.divisionJugador.findMany({
        where: { jugadorId: req.params.jugadorId, division: visibleDivisionWhere(req.user) },
        include: {
          division: {
            include: {
              liga: { select: { id: true, nombre: true, logo: true } },
              estadoLiga: { select: { id: true, nombre: true } },
            },
          },
          equipo: { select: { id: true, nombre: true, logo: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      ok(res, data);
    } catch (e) { next(e); }
  },

  async listByDivisionTeam(req: Request, res: Response, next: NextFunction) {
    try {
      const division = await prisma.division.findFirst({
        where: { id: req.params.divisionId, ...visibleDivisionWhere(req.user) },
        select: {
          jugadores: {
            where: { equipoId: req.params.equipoId },
            include: { jugador: true },
            orderBy: { jugador: { nombre: 'asc' } },
          },
        },
      });
      if (!division) throw new NotFoundError('División');
      ok(res, division.jugadores.map((entry) => ({ ...entry, jugador: sanitizePublic(entry.jugador) })));
    } catch (e) { next(e); }
  },

  async assignToDivision(req: Request, res: Response, next: NextFunction) {
    try {
      const p = divisionJugadorSchema.safeParse(req.body);
      if (!p.success) throw new ValidationError(p.error.issues[0].message);
      await assertTeamOwner(p.data.equipoId, req);
      await assertTeamInDivision(p.data.divisionId, p.data.equipoId);
      const result = await prisma.divisionJugador.create({ data: p.data, include: { jugador: true } });
      created(res, { ...result, jugador: sanitizePublic(result.jugador) }, 'Jugador habilitado en división');
    } catch (e: any) {
      if (e?.code === 'P2002') next(new ConflictError('Ese jugador ya está habilitado en esta división'));
      else if (e?.code === 'P2003') next(new ValidationError('El jugador debe pertenecer al equipo y el equipo a la división'));
      else next(e);
    }
  },

  async removeFromDivision(req: Request, res: Response, next: NextFunction) {
    try {
      await assertTeamOwner(req.params.equipoId, req);
      await assertTeamInDivision(req.params.divisionId, req.params.equipoId);
      await prisma.divisionJugador.delete({
        where: { divisionId_equipoId_jugadorId: { divisionId: req.params.divisionId, equipoId: req.params.equipoId, jugadorId: req.params.jugadorId } },
      });
      noContent(res);
    } catch (e) { next(e); }
  },

  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const jugador = await prisma.jugador.findUnique({
        where: { userId: req.user!.id },
        include: jugadorInclude,
      });
      if (!jugador) return ok(res, null);
      ok(res, jugador);
    } catch (e) { next(e); }
  },

  async createMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) throw new ValidationError('Usuario no encontrado');
      if (!user.phoneNumber || !user.phoneNumberVerified)
        throw new ValidationError('Debes tener un teléfono verificado para crear un perfil de jugador');

      const existing = await prisma.jugador.findUnique({ where: { userId: user.id } });
      if (existing) return ok(res, existing);

      const p = createMeSchema.safeParse(req.body);
      if (!p.success) throw new ValidationError(p.error.issues[0].message);

      const byPhone = await prisma.jugador.findUnique({ where: { telefono: user.phoneNumber } });
      if (byPhone) {
        if (byPhone.userId) throw new ConflictError('Este perfil ya está vinculado a otra cuenta');
        const linked = await prisma.jugador.update({
          where: { id: byPhone.id },
          data: { userId: user.id },
          include: jugadorInclude,
        });
        return ok(res, linked, 'Perfil de jugador vinculado');
      }

      const jugador = await prisma.jugador.create({
        data: { ...p.data, telefono: user.phoneNumber, userId: user.id },
        include: jugadorInclude,
      });
      created(res, jugador, 'Perfil de jugador creado');
    } catch (e: any) {
      if (e?.code === 'P2002') next(new ConflictError('Ya existe un perfil de jugador para esta cuenta'));
      else next(e);
    }
  },

  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const jugador = await prisma.jugador.findUnique({ where: { userId: req.user!.id } });
      if (!jugador) throw new ValidationError('No tienes un perfil de jugador');

      const p = updateMeSchema.safeParse(req.body);
      if (!p.success) throw new ValidationError(p.error.issues[0].message);

      if (p.data.foto !== undefined && p.data.foto !== jugador.foto) {
        await mediaService.scheduleImageCleanup(jugador.foto, jugador.fotoPublicId);
      }

      const updated = await prisma.jugador.update({
        where: { id: jugador.id },
        data: p.data,
        include: jugadorInclude,
      });
      ok(res, updated, 'Perfil actualizado');
    } catch (e) { next(e); }
  },
};
