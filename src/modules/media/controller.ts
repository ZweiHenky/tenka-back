import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '../../utils/response';
import { mediaService } from './service';
import { ValidationError } from '../../utils/errors';
import { env } from '../../config/env';

const signUploadSchema = z.object({
  folder: z.string().optional(),
  public_id: z.string().optional(),
});

export const mediaController = {
  async signUpload(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = signUploadSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

      const params: Record<string, string> = {
        ...(parsed.data.folder && { folder: parsed.data.folder }),
        ...(parsed.data.public_id && { public_id: parsed.data.public_id }),
      };

      const { signature, timestamp } = mediaService.generateSignature(params);
      ok(res, {
        signature,
        timestamp,
        apiKey: env.CLOUDINARY_API_KEY,
        cloudName: env.CLOUDINARY_CLOUD_NAME,
      });
    } catch (err) {
      next(err);
    }
  },
};
