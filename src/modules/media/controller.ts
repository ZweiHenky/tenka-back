import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok, noContent } from '../../utils/response';
import { mediaService } from './service';
import { ValidationError } from '../../utils/errors';

const kindSchema = z.enum(['LEAGUE_LOGO', 'LEAGUE_COVER', 'TEAM_LOGO', 'ACCOUNT_AVATAR', 'PLAYER_PHOTO']);
const completionSchema = z.object({
  intentId: z.string().min(1),
  public_id: z.string().min(1),
  secure_url: z.url(),
  bytes: z.number().int().positive(),
  format: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues[0].message);
  return result.data;
}

export const mediaController = {
  async signUpload(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await mediaService.createUploadIntent(req.user!.id, parse(z.object({ kind: kindSchema }), req.body).kind)); } catch (err) { next(err); }
  },
  async complete(req: Request, res: Response, next: NextFunction) {
    try {
      const { intentId, ...metadata } = parse(completionSchema, req.body);
      ok(res, await mediaService.completeUpload(req.user!.id, intentId, metadata));
    } catch (err) { next(err); }
  },
  async abandon(req: Request, res: Response, next: NextFunction) {
    try { await mediaService.abandonUpload(req.user!.id, req.params.intentId); noContent(res); } catch (err) { next(err); }
  },
};
