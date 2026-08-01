import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { ok } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { mediaService } from '../media/service';
import { userService } from './service';

const phoneVisibilitySchema = z.object({
  showPhoneInPublicLeague: z.boolean(),
});

const updateMeSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  image: z.string().nullable().optional(),
  imagePublicId: z.string().nullable().optional(),
});

export const userController = {
  async activateLeagueRole(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.activateLeagueRole(req.user!.id);
      ok(res, user, 'Rol de liga activado');
    } catch (err) {
      next(err);
    }
  },

  async updatePhoneVisibility(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = phoneVisibilitySchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data: { showPhoneInPublicLeague: parsed.data.showPhoneInPublicLeague },
        select: { id: true, showPhoneInPublicLeague: true },
      });

      ok(res, user, 'Preferencia actualizada');
    } catch (err) {
      next(err);
    }
  },

  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = updateMeSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

      if (parsed.data.image !== undefined) {
        const old = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { image: true, imagePublicId: true } });
        if (old && parsed.data.image !== old.image) {
          await mediaService.scheduleImageCleanup(old.image, old.imagePublicId);
        }
      }

      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data: parsed.data,
        select: { id: true, name: true, image: true, imagePublicId: true },
      });

      ok(res, user, 'Perfil actualizado');
    } catch (err) {
      next(err);
    }
  },
};
