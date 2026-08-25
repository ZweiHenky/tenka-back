import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { ok, noContent } from '../../utils/response';
import { ForbiddenError, ValidationError } from '../../utils/errors';
import { mediaService } from '../media/service';
import { userService } from './service';
import { signalBackgroundJob } from '../../workers/jobSignals';
import { firstIssueMessage } from '../../utils/validation';
import { getAccountQuota } from '../../utils/accountQuota';

const phoneVisibilitySchema = z.object({
  showPhoneInPublicLeague: z.boolean(),
});

const updateMeSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  avatarAssetId: z.string().min(1).nullable().optional(),
});

const deleteAccountSchema = z.object({
  email: z.string().email(),
});

export const userController = {
  async quota(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await getAccountQuota(req.user!.id));
    } catch (err) {
      next(err);
    }
  },

  async quotaByUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (req.user!.id !== req.params.userId && req.user!.rol !== 'ADMINISTRADOR') {
        throw new ForbiddenError();
      }
      ok(res, await getAccountQuota(req.params.userId));
    } catch (err) {
      next(err);
    }
  },

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
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));

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
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));

      const user = await prisma.$transaction(async (tx) => {
        await mediaService.lockAttachmentTarget(tx, 'user', req.user!.id);
        const old = await tx.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { image: true, imagePublicId: true } });
        const media = await mediaService.prepareAttachment(tx, parsed.data.avatarAssetId, req.user!.id, 'ACCOUNT_AVATAR', old.image, old.imagePublicId);
        return tx.user.update({
          where: { id: req.user!.id },
          data: { name: parsed.data.name, ...(media && { image: media.url, imagePublicId: media.publicId }) },
          select: { id: true, name: true, image: true },
        });
      });
      signalBackgroundJob('media-deletion');

      ok(res, user, 'Perfil actualizado');
    } catch (err) {
      next(err);
    }
  },

  async deleteAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = deleteAccountSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));

      await userService.deleteAccount(req.user!.id, parsed.data.email);
      noContent(res);
    } catch (err) {
      next(err);
    }
  },
};
