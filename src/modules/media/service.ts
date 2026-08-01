import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  timeout: env.PROVIDER_TIMEOUT_MS,
});

function extractPublicId(url: string): string | null {
  if (!url) return null;
  if (!url.includes('res.cloudinary.com')) return null;
  try {
    const parts = url.split('/');
    const uploadIndex = parts.findIndex((p) => p === 'upload');
    if (uploadIndex === -1) return null;
    const afterVersion = parts.slice(uploadIndex + 2).join('/');
    const withoutExt = afterVersion.replace(/\.[^.]+$/, '');
    return decodeURIComponent(withoutExt) || null;
  } catch {
    return null;
  }
}

async function deleteImage(publicId: string): Promise<boolean> {
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const providerCall = cloudinary.uploader.destroy(publicId).then(
      (result) => result,
      (error) => { throw error; },
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Cloudinary destroy timed out')), env.PROVIDER_TIMEOUT_MS);
    });
    const result = await Promise.race([providerCall, timeout]);
    const ok = result.result === 'ok' || result.result === 'not found';
    const status = ok ? 'success' : 'failed';
    logger[ok ? 'info' : 'warn']({ provider: 'cloudinary', operation: 'destroy_image', status, durationMs: Date.now() - startedAt, timeout: false }, `Provider operation ${ok ? 'completed' : 'failed'}`);
    if (!ok) Sentry.captureException(new Error('Cloudinary destroy failed'), { tags: { provider: 'cloudinary', operation: 'destroy_image' } });
    return ok;
  } catch (e) {
    const error = e instanceof Error ? e : new Error('Cloudinary destroy failed');
    const timedOut = error.message === 'Cloudinary destroy timed out';
    logger.warn({ provider: 'cloudinary', operation: 'destroy_image', status: 'error', durationMs: Date.now() - startedAt, timeout: timedOut, errorName: error.name }, 'Provider operation failed');
    Sentry.captureException(error, { tags: { provider: 'cloudinary', operation: 'destroy_image', timeout: String(timedOut) } });
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function generateSignature(params: Record<string, string>): { signature: string; timestamp: number } {
  const timestamp = Math.round(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { ...params, timestamp },
    env.CLOUDINARY_API_SECRET,
  );
  return { signature, timestamp };
}

async function scheduleDeletion(publicId: string): Promise<void> {
  if (!publicId) return;
  await prisma.mediaDeletionJob.create({ data: { publicId } });
}

async function scheduleImageCleanup(url: string | null | undefined, storedPublicId: string | null | undefined): Promise<void> {
  const pid = storedPublicId || (url ? extractPublicId(url) : null);
  if (pid) await scheduleDeletion(pid);
}

async function processDeletionJobs(): Promise<void> {
  const jobs = await prisma.mediaDeletionJob.findMany({
    where: { nextTryAt: { lte: new Date() } },
    take: 20,
  });
  for (const job of jobs) {
    const ok = await deleteImage(job.publicId);
    if (ok) {
      await prisma.mediaDeletionJob.delete({ where: { id: job.id } });
    } else {
      await prisma.mediaDeletionJob.update({
        where: { id: job.id },
        data: {
          attempts: { increment: 1 },
          lastError: 'cloudinary destroy failed',
          nextTryAt: new Date(Date.now() + Math.min(60000 * 2 ** job.attempts, 86400000)),
        },
      });
    }
  }
}

export const mediaService = {
  extractPublicId,
  deleteImage,
  generateSignature,
  scheduleDeletion,
  scheduleImageCleanup,
  processDeletionJobs,
};
