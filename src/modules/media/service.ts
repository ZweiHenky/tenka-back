import { randomUUID } from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';
import { NotFoundError, ValidationError } from '../../utils/errors';
import type { MediaKind, Prisma } from '../../generated/prisma/client';
import type { BatchResult } from '../../workers/dueProcessor';
import { signalBackgroundJob } from '../../workers/jobSignals';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'heic'] as const;
const INTENT_TTL_MS = 15 * 60 * 1000;
const SIGNATURE_CLEANUP_DELAY_MS = 70 * 60 * 1000;
const POLICIES: Record<MediaKind, { width: number; height: number }> = {
  LEAGUE_LOGO: { width: 200, height: 200 },
  LEAGUE_COVER: { width: 1200, height: 675 },
  TEAM_LOGO: { width: 200, height: 200 },
  ACCOUNT_AVATAR: { width: 200, height: 200 },
  PLAYER_PHOTO: { width: 200, height: 200 },
};

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  timeout: env.PROVIDER_TIMEOUT_MS,
});

type Db = Prisma.TransactionClient | typeof prisma;
type MediaTargetTable = 'user' | 'liga' | 'equipo' | 'jugador';

async function lockAttachmentTarget(tx: Prisma.TransactionClient, table: MediaTargetTable, id: string): Promise<void> {
  if (table === 'user') await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
  else if (table === 'liga') await tx.$queryRaw`SELECT id FROM ligas WHERE id = ${id} FOR UPDATE`;
  else if (table === 'equipo') await tx.$queryRaw`SELECT id FROM equipos WHERE id = ${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM jugadores WHERE id = ${id} FOR UPDATE`;
}

function extractPublicId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== env.CLOUDINARY_DELIVERY_HOST || parsed.search || parsed.hash) return null;
    const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (segments[0] !== env.CLOUDINARY_CLOUD_NAME || segments[1] !== 'image' || segments[2] !== 'upload') return null;
    const versionIndex = segments.findIndex((segment, index) => index >= 3 && /^v\d+$/.test(segment));
    if (versionIndex < 0) return null;
    const start = versionIndex + 1;
    if (start >= segments.length || segments.slice(start).some((segment) => !segment || segment === '.' || segment === '..')) return null;
    return segments.slice(start).join('/').replace(/\.[a-z0-9]+$/i, '') || null;
  } catch {
    return null;
  }
}

function assertDeliveryUrl(url: string, publicId: string): void {
  if (extractPublicId(url) !== publicId) throw new ValidationError('La URL de Cloudinary no coincide con el recurso');
}

async function createUploadIntent(ownerId: string, kind: MediaKind) {
  const policy = POLICIES[kind];
  const publicId = `myleague/${env.APP_ENV}/${ownerId}/${kind.toLowerCase()}/${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const gravity = kind === 'LEAGUE_LOGO' || kind === 'TEAM_LOGO' ? 'g_center' : 'g_auto';
  const uploadParams = {
    public_id: publicId,
    timestamp,
    allowed_formats: ALLOWED_FORMATS.join(','),
    overwrite: false,
    transformation: `c_fill,${gravity},w_${policy.width},h_${policy.height}`,
  };
  const signature = cloudinary.utils.api_sign_request(uploadParams, env.CLOUDINARY_API_SECRET);
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
  const intent = await prisma.mediaAsset.create({
    data: { ownerId, kind, publicId, expiresAt },
    select: { id: true },
  });
  signalBackgroundJob('media-intents', expiresAt);
  return {
    intentId: intent.id,
    publicId,
    signature,
    apiKey: env.CLOUDINARY_API_KEY,
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    uploadParams,
  };
}

interface CompletionInput {
  public_id: string;
  secure_url: string;
  bytes: number;
  format: string;
  width: number;
  height: number;
}

async function completeUpload(ownerId: string, intentId: string, input: CompletionInput) {
  const intent = await prisma.mediaAsset.findFirst({ where: { id: intentId, ownerId } });
  if (!intent) throw new NotFoundError('Intento de carga');
  if (intent.status !== 'PENDING' || intent.expiresAt <= new Date()) throw new ValidationError('El intento de carga ya no es válido');
  if (input.public_id !== intent.publicId) throw new ValidationError('El public ID no coincide con el intento');
  assertDeliveryUrl(input.secure_url, intent.publicId);

  let resource: Awaited<ReturnType<typeof cloudinary.api.resource>>;
  try {
    resource = await cloudinary.api.resource(intent.publicId, { resource_type: 'image', type: 'upload' });
  } catch {
    throw new ValidationError('No se pudo verificar el recurso en Cloudinary');
  }
  const format = String(resource.format).toLowerCase();
  const policy = POLICIES[intent.kind];
  if (resource.public_id !== intent.publicId || resource.secure_url !== input.secure_url) throw new ValidationError('La respuesta no coincide con Cloudinary');
  if (resource.bytes !== input.bytes || resource.width !== input.width || resource.height !== input.height || format !== input.format.toLowerCase()) {
    throw new ValidationError('Los metadatos de carga no coinciden con Cloudinary');
  }
  if (!ALLOWED_FORMATS.includes(format as typeof ALLOWED_FORMATS[number]) || resource.bytes > MAX_BYTES || resource.width !== policy.width || resource.height !== policy.height) {
    throw new ValidationError('La imagen no cumple la política de carga');
  }
  if (typeof resource.pages === 'number' && resource.pages > 1) throw new ValidationError('No se permiten imágenes animadas');
  assertDeliveryUrl(resource.secure_url, intent.publicId);

  const updated = await prisma.mediaAsset.updateMany({
    where: { id: intent.id, ownerId, status: 'PENDING', expiresAt: { gt: new Date() } },
    data: { secureUrl: resource.secure_url, bytes: resource.bytes, format, width: resource.width, height: resource.height, status: 'UPLOADED' },
  });
  if (updated.count !== 1) throw new ValidationError('El intento de carga ya no es válido');
  return { mediaAssetId: intent.id, url: resource.secure_url };
}

async function abandonUpload(ownerId: string, intentId: string): Promise<void> {
  const dueAt = await prisma.$transaction(async (tx) => {
    const asset = await tx.mediaAsset.findFirst({ where: { id: intentId, ownerId, status: { in: ['PENDING', 'UPLOADED'] } } });
    if (!asset) return null;
    await tx.mediaAsset.update({ where: { id: asset.id }, data: { status: 'ABANDONED' } });
    const nextTryAt = asset.status === 'PENDING'
      ? new Date(asset.createdAt.getTime() + SIGNATURE_CLEANUP_DELAY_MS)
      : new Date();
    await scheduleDeletion(asset.publicId, tx, nextTryAt);
    return nextTryAt;
  });
  if (dueAt) signalBackgroundJob('media-deletion', dueAt);
}

async function resolveAttachment(tx: Prisma.TransactionClient, assetId: string, ownerId: string, kind: MediaKind) {
  const asset = await tx.mediaAsset.findFirst({
    where: { id: assetId, ownerId, kind, status: 'UPLOADED', attachedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!asset?.secureUrl) throw new ValidationError('El recurso multimedia no está disponible para adjuntar');
  return asset;
}

async function markAttached(tx: Prisma.TransactionClient, assetId: string): Promise<void> {
  const result = await tx.mediaAsset.updateMany({
    where: { id: assetId, status: 'UPLOADED', attachedAt: null },
    data: { status: 'ATTACHED', attachedAt: new Date() },
  });
  if (result.count !== 1) throw new ValidationError('El recurso multimedia ya fue utilizado');
}

async function prepareAttachment(
  tx: Prisma.TransactionClient,
  assetId: string | null | undefined,
  ownerId: string,
  kind: MediaKind,
  oldUrl?: string | null,
  oldPublicId?: string | null,
): Promise<{ url: string | null; publicId: string | null } | undefined> {
  if (assetId === undefined) return undefined;
  if (assetId === null) {
    await scheduleImageCleanup(oldUrl, oldPublicId, tx);
    return { url: null, publicId: null };
  }
  const asset = await resolveAttachment(tx, assetId, ownerId, kind);
  if (oldPublicId !== asset.publicId || oldUrl !== asset.secureUrl) await scheduleImageCleanup(oldUrl, oldPublicId, tx);
  await markAttached(tx, asset.id);
  return { url: asset.secureUrl, publicId: asset.publicId };
}

async function scheduleDeletion(publicId: string, db: Db = prisma, nextTryAt = new Date()): Promise<void> {
  if (!publicId) return;
  await db.mediaDeletionJob.upsert({
    where: { publicId },
    create: { publicId, nextTryAt },
    update: { publicId },
  });
  if (db === prisma) signalBackgroundJob('media-deletion', nextTryAt);
}

async function scheduleImageCleanup(url: string | null | undefined, storedPublicId?: string | null, db: Db = prisma): Promise<void> {
  if (!url) return;
  const parsed = extractPublicId(url);
  if (!parsed || (storedPublicId && storedPublicId !== parsed)) return;
  await scheduleDeletion(storedPublicId || parsed, db);
}

async function deleteImage(publicId: string): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const providerCall = cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: 'image', type: 'upload' });
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Cloudinary destroy timed out')), env.PROVIDER_TIMEOUT_MS); });
    const result = await Promise.race([providerCall, timeout]);
    return result.result === 'ok' || result.result === 'not found';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function isPublicIdReferenced(publicId: string): Promise<boolean> {
  const [users, leaguesByLogo, leaguesByCover, teams, players] = await Promise.all([
    prisma.user.count({ where: { imagePublicId: publicId } }),
    prisma.liga.count({ where: { logoPublicId: publicId } }),
    prisma.liga.count({ where: { canchaPublicId: publicId } }),
    prisma.equipo.count({ where: { logoPublicId: publicId } }),
    prisma.jugador.count({ where: { fotoPublicId: publicId } }),
  ]);
  return users + leaguesByLogo + leaguesByCover + teams + players > 0;
}

interface ClaimedJob { id: string; publicId: string; attempts: number; maxAttempts: number }

async function claimDeletionJobs(workerId: string, take = 20): Promise<ClaimedJob[]> {
  return prisma.$queryRaw<ClaimedJob[]>`
    WITH exhausted AS (
      UPDATE media_deletion_jobs
      SET status = 'DEAD', "deadAt" = NOW(), "lockedBy" = NULL, "leaseUntil" = NULL,
          "lastError" = 'lease_expired_after_max_attempts', "updatedAt" = NOW()
      WHERE status = 'LEASED' AND "leaseUntil" <= NOW() AND attempts >= "maxAttempts"
    ), due AS (
      SELECT id FROM media_deletion_jobs
      WHERE attempts < "maxAttempts" AND (
        (status = 'PENDING' AND "nextTryAt" <= NOW())
        OR (status = 'LEASED' AND "leaseUntil" <= NOW())
      )
      ORDER BY "nextTryAt"
      FOR UPDATE SKIP LOCKED
      LIMIT ${take}
    )
    UPDATE media_deletion_jobs j
    SET status = 'LEASED', attempts = j.attempts + 1, "lockedBy" = ${workerId},
        "leaseUntil" = NOW() + INTERVAL '60 seconds', "updatedAt" = NOW()
    FROM due WHERE j.id = due.id
    RETURNING j.id, j."publicId", j.attempts, j."maxAttempts"
  `;
}

async function nextDeletionDueAt(): Promise<Date | null> {
  const [row] = await prisma.$queryRaw<Array<{ nextDueAt: Date | null }>>`
    SELECT MIN(due_at) AS "nextDueAt" FROM (
      SELECT "nextTryAt" AS due_at FROM media_deletion_jobs
      WHERE status = 'PENDING' AND attempts < "maxAttempts"
      UNION ALL
      SELECT "leaseUntil" AS due_at FROM media_deletion_jobs
      WHERE status = 'LEASED'
    ) due
  `;
  return row?.nextDueAt ? new Date(row.nextDueAt) : null;
}

async function processDeletionJobs(take = 20): Promise<BatchResult> {
  const workerId = randomUUID();
  const jobs = await claimDeletionJobs(workerId, take);
  await Promise.all(jobs.map(async (job) => {
    try {
      if (await isPublicIdReferenced(job.publicId)) throw new Error('Cloudinary resource is still referenced');
      const ok = await deleteImage(job.publicId);
      if (!ok) throw new Error('Cloudinary destroy returned a failure result');
      await prisma.mediaDeletionJob.deleteMany({ where: { id: job.id, lockedBy: workerId, status: 'LEASED' } });
    } catch (cause) {
      const attempts = job.attempts;
      const dead = attempts >= job.maxAttempts;
      const error = cause instanceof Error ? cause : new Error('Cloudinary destroy failed');
      const base = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 86_400_000);
      await prisma.mediaDeletionJob.updateMany({
        where: { id: job.id, lockedBy: workerId, status: 'LEASED' },
        data: {
          attempts,
          lastError: error.message.slice(0, 1000),
          status: dead ? 'DEAD' : 'PENDING',
          deadAt: dead ? new Date() : null,
          nextTryAt: new Date(Date.now() + base + Math.floor(Math.random() * Math.max(1, base / 4))),
          lockedBy: null,
          leaseUntil: null,
        },
      });
      if (dead) Sentry.captureException(error, { tags: { provider: 'cloudinary', operation: 'destroy_image', terminal: 'true' }, extra: { publicId: job.publicId, attempts } });
      logger.warn({ err: error, publicId: job.publicId, attempts, dead }, 'Cloudinary deletion job failed');
    }
  }));
  return { processedCount: jobs.length, nextDueAt: await nextDeletionDueAt() };
}

async function nextIntentDueAt(): Promise<Date | null> {
  const [row] = await prisma.$queryRaw<Array<{ nextDueAt: Date | null }>>`
    SELECT MIN("expiresAt") AS "nextDueAt" FROM media_assets
    WHERE status IN ('PENDING', 'UPLOADED') AND "attachedAt" IS NULL
  `;
  return row?.nextDueAt ? new Date(row.nextDueAt) : null;
}

async function cleanupExpiredIntents(take = 100): Promise<BatchResult> {
  const [result] = await prisma.$queryRaw<Array<{ processedCount: number; deletionDueAt: Date | null }>>`
    WITH expired AS (
      SELECT id FROM media_assets
      WHERE status IN ('PENDING', 'UPLOADED') AND "attachedAt" IS NULL AND "expiresAt" <= NOW()
      ORDER BY "expiresAt" FOR UPDATE SKIP LOCKED LIMIT ${take}
    ), abandoned AS (
      UPDATE media_assets a SET status = 'ABANDONED', "updatedAt" = NOW()
      FROM expired WHERE a.id = expired.id RETURNING a."publicId", a."createdAt"
    ), queued AS (
      INSERT INTO media_deletion_jobs (id, "publicId", status, attempts, "maxAttempts", "nextTryAt", "createdAt", "updatedAt")
      SELECT md5(random()::text || clock_timestamp()::text || "publicId"), "publicId", 'PENDING', 0, 8,
             GREATEST(NOW(), "createdAt" + INTERVAL '70 minutes'), NOW(), NOW() FROM abandoned
      ON CONFLICT ("publicId") DO NOTHING
      RETURNING "nextTryAt"
    ) SELECT
      (SELECT COUNT(*)::int FROM abandoned) AS "processedCount",
      (SELECT MIN("nextTryAt") FROM queued) AS "deletionDueAt"
  `;
  if (result?.deletionDueAt) signalBackgroundJob('media-deletion', new Date(result.deletionDueAt));
  return { processedCount: result?.processedCount ?? 0, nextDueAt: await nextIntentDueAt() };
}

export const mediaService = {
  MAX_BYTES,
  ALLOWED_FORMATS,
  POLICIES,
  lockAttachmentTarget,
  extractPublicId,
  createUploadIntent,
  completeUpload,
  abandonUpload,
  resolveAttachment,
  markAttached,
  prepareAttachment,
  scheduleDeletion,
  scheduleImageCleanup,
  deleteImage,
  isPublicIdReferenced,
  claimDeletionJobs,
  nextDeletionDueAt,
  processDeletionJobs,
  nextIntentDueAt,
  cleanupExpiredIntents,
};
