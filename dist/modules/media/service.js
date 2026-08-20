"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaService = void 0;
const crypto_1 = require("crypto");
const cloudinary_1 = require("cloudinary");
const database_1 = require("../../config/database");
const env_1 = require("../../config/env");
const logger_1 = require("../../config/logger");
const instrument_1 = require("../../instrument");
const errors_1 = require("../../utils/errors");
const jobSignals_1 = require("../../workers/jobSignals");
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'heic'];
const INTENT_TTL_MS = 15 * 60 * 1000;
const SIGNATURE_CLEANUP_DELAY_MS = 70 * 60 * 1000;
const POLICIES = {
    LEAGUE_LOGO: { width: 200, height: 200 },
    LEAGUE_COVER: { width: 1200, height: 675 },
    TEAM_LOGO: { width: 200, height: 200 },
    ACCOUNT_AVATAR: { width: 200, height: 200 },
    PLAYER_PHOTO: { width: 200, height: 200 },
};
cloudinary_1.v2.config({
    cloud_name: env_1.env.CLOUDINARY_CLOUD_NAME,
    api_key: env_1.env.CLOUDINARY_API_KEY,
    api_secret: env_1.env.CLOUDINARY_API_SECRET,
    timeout: env_1.env.PROVIDER_TIMEOUT_MS,
});
async function lockAttachmentTarget(tx, table, id) {
    if (table === 'user')
        await tx.$queryRaw `SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
    else if (table === 'liga')
        await tx.$queryRaw `SELECT id FROM ligas WHERE id = ${id} FOR UPDATE`;
    else if (table === 'equipo')
        await tx.$queryRaw `SELECT id FROM equipos WHERE id = ${id} FOR UPDATE`;
    else
        await tx.$queryRaw `SELECT id FROM jugadores WHERE id = ${id} FOR UPDATE`;
}
function extractPublicId(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.hostname !== env_1.env.CLOUDINARY_DELIVERY_HOST || parsed.search || parsed.hash)
            return null;
        const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        if (segments[0] !== env_1.env.CLOUDINARY_CLOUD_NAME || segments[1] !== 'image' || segments[2] !== 'upload')
            return null;
        const versionIndex = segments.findIndex((segment, index) => index >= 3 && /^v\d+$/.test(segment));
        if (versionIndex < 0)
            return null;
        const start = versionIndex + 1;
        if (start >= segments.length || segments.slice(start).some((segment) => !segment || segment === '.' || segment === '..'))
            return null;
        return segments.slice(start).join('/').replace(/\.[a-z0-9]+$/i, '') || null;
    }
    catch {
        return null;
    }
}
function assertDeliveryUrl(url, publicId) {
    if (extractPublicId(url) !== publicId)
        throw new errors_1.ValidationError('La URL de Cloudinary no coincide con el recurso');
}
async function createUploadIntent(ownerId, kind) {
    const policy = POLICIES[kind];
    const publicId = `tenka/${env_1.env.APP_ENV}/${ownerId}/${kind.toLowerCase()}/${(0, crypto_1.randomUUID)()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const gravity = kind === 'LEAGUE_LOGO' || kind === 'TEAM_LOGO' ? 'g_center' : 'g_auto';
    const uploadParams = {
        public_id: publicId,
        timestamp,
        allowed_formats: ALLOWED_FORMATS.join(','),
        overwrite: false,
        transformation: `c_fill,${gravity},w_${policy.width},h_${policy.height}`,
    };
    const signature = cloudinary_1.v2.utils.api_sign_request(uploadParams, env_1.env.CLOUDINARY_API_SECRET);
    const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
    const intent = await database_1.prisma.mediaAsset.create({
        data: { ownerId, kind, publicId, expiresAt },
        select: { id: true },
    });
    (0, jobSignals_1.signalBackgroundJob)('media-intents', expiresAt);
    return {
        intentId: intent.id,
        publicId,
        signature,
        apiKey: env_1.env.CLOUDINARY_API_KEY,
        cloudName: env_1.env.CLOUDINARY_CLOUD_NAME,
        uploadParams,
    };
}
async function completeUpload(ownerId, intentId, input) {
    const intent = await database_1.prisma.mediaAsset.findFirst({ where: { id: intentId, ownerId } });
    if (!intent)
        throw new errors_1.NotFoundError('Intento de carga');
    if (intent.status !== 'PENDING' || intent.expiresAt <= new Date())
        throw new errors_1.ValidationError('El intento de carga ya no es válido');
    if (input.public_id !== intent.publicId)
        throw new errors_1.ValidationError('El public ID no coincide con el intento');
    assertDeliveryUrl(input.secure_url, intent.publicId);
    let resource;
    try {
        resource = await cloudinary_1.v2.api.resource(intent.publicId, { resource_type: 'image', type: 'upload' });
    }
    catch {
        throw new errors_1.ValidationError('No se pudo verificar el recurso en Cloudinary');
    }
    const format = String(resource.format).toLowerCase();
    const policy = POLICIES[intent.kind];
    if (resource.public_id !== intent.publicId || resource.secure_url !== input.secure_url)
        throw new errors_1.ValidationError('La respuesta no coincide con Cloudinary');
    if (resource.bytes !== input.bytes || resource.width !== input.width || resource.height !== input.height || format !== input.format.toLowerCase()) {
        throw new errors_1.ValidationError('Los metadatos de carga no coinciden con Cloudinary');
    }
    if (!ALLOWED_FORMATS.includes(format) || resource.bytes > MAX_BYTES || resource.width !== policy.width || resource.height !== policy.height) {
        throw new errors_1.ValidationError('La imagen no cumple la política de carga');
    }
    if (typeof resource.pages === 'number' && resource.pages > 1)
        throw new errors_1.ValidationError('No se permiten imágenes animadas');
    assertDeliveryUrl(resource.secure_url, intent.publicId);
    const updated = await database_1.prisma.mediaAsset.updateMany({
        where: { id: intent.id, ownerId, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { secureUrl: resource.secure_url, bytes: resource.bytes, format, width: resource.width, height: resource.height, status: 'UPLOADED' },
    });
    if (updated.count !== 1)
        throw new errors_1.ValidationError('El intento de carga ya no es válido');
    return { mediaAssetId: intent.id, url: resource.secure_url };
}
async function abandonUpload(ownerId, intentId) {
    const dueAt = await database_1.prisma.$transaction(async (tx) => {
        const asset = await tx.mediaAsset.findFirst({ where: { id: intentId, ownerId, status: { in: ['PENDING', 'UPLOADED'] } } });
        if (!asset)
            return null;
        await tx.mediaAsset.update({ where: { id: asset.id }, data: { status: 'ABANDONED' } });
        const nextTryAt = asset.status === 'PENDING'
            ? new Date(asset.createdAt.getTime() + SIGNATURE_CLEANUP_DELAY_MS)
            : new Date();
        await scheduleDeletion(asset.publicId, tx, nextTryAt);
        return nextTryAt;
    });
    if (dueAt)
        (0, jobSignals_1.signalBackgroundJob)('media-deletion', dueAt);
}
async function resolveAttachment(tx, assetId, ownerId, kind) {
    const asset = await tx.mediaAsset.findFirst({
        where: { id: assetId, ownerId, kind, status: 'UPLOADED', attachedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!asset?.secureUrl)
        throw new errors_1.ValidationError('El recurso multimedia no está disponible para adjuntar');
    return asset;
}
async function markAttached(tx, assetId) {
    const result = await tx.mediaAsset.updateMany({
        where: { id: assetId, status: 'UPLOADED', attachedAt: null },
        data: { status: 'ATTACHED', attachedAt: new Date() },
    });
    if (result.count !== 1)
        throw new errors_1.ValidationError('El recurso multimedia ya fue utilizado');
}
async function prepareAttachment(tx, assetId, ownerId, kind, oldUrl, oldPublicId) {
    if (assetId === undefined)
        return undefined;
    if (assetId === null) {
        await scheduleImageCleanup(oldUrl, oldPublicId, tx);
        return { url: null, publicId: null };
    }
    const asset = await resolveAttachment(tx, assetId, ownerId, kind);
    if (oldPublicId !== asset.publicId || oldUrl !== asset.secureUrl)
        await scheduleImageCleanup(oldUrl, oldPublicId, tx);
    await markAttached(tx, asset.id);
    return { url: asset.secureUrl, publicId: asset.publicId };
}
async function scheduleDeletion(publicId, db = database_1.prisma, nextTryAt = new Date()) {
    if (!publicId)
        return;
    await db.mediaDeletionJob.upsert({
        where: { publicId },
        create: { publicId, nextTryAt },
        update: { publicId },
    });
    if (db === database_1.prisma)
        (0, jobSignals_1.signalBackgroundJob)('media-deletion', nextTryAt);
}
async function scheduleImageCleanup(url, storedPublicId, db = database_1.prisma) {
    if (!url)
        return;
    const parsed = extractPublicId(url);
    if (!parsed || (storedPublicId && storedPublicId !== parsed))
        return;
    await scheduleDeletion(storedPublicId || parsed, db);
}
async function deleteImage(publicId) {
    let timer;
    try {
        const providerCall = cloudinary_1.v2.uploader.destroy(publicId, { invalidate: true, resource_type: 'image', type: 'upload' });
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cloudinary destroy timed out')), env_1.env.PROVIDER_TIMEOUT_MS); });
        const result = await Promise.race([providerCall, timeout]);
        return result.result === 'ok' || result.result === 'not found';
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
async function isPublicIdReferenced(publicId) {
    const [users, leaguesByLogo, leaguesByCover, teams, players] = await Promise.all([
        database_1.prisma.user.count({ where: { imagePublicId: publicId } }),
        database_1.prisma.liga.count({ where: { logoPublicId: publicId } }),
        database_1.prisma.liga.count({ where: { canchaPublicId: publicId } }),
        database_1.prisma.equipo.count({ where: { logoPublicId: publicId } }),
        database_1.prisma.jugador.count({ where: { fotoPublicId: publicId } }),
    ]);
    return users + leaguesByLogo + leaguesByCover + teams + players > 0;
}
async function claimDeletionJobs(workerId, take = 20) {
    return database_1.prisma.$queryRaw `
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
async function nextDeletionDueAt() {
    const [row] = await database_1.prisma.$queryRaw `
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
async function processDeletionJobs(take = 20) {
    const workerId = (0, crypto_1.randomUUID)();
    const jobs = await claimDeletionJobs(workerId, take);
    await Promise.all(jobs.map(async (job) => {
        try {
            if (await isPublicIdReferenced(job.publicId))
                throw new Error('Cloudinary resource is still referenced');
            const ok = await deleteImage(job.publicId);
            if (!ok)
                throw new Error('Cloudinary destroy returned a failure result');
            await database_1.prisma.mediaDeletionJob.deleteMany({ where: { id: job.id, lockedBy: workerId, status: 'LEASED' } });
        }
        catch (cause) {
            const attempts = job.attempts;
            const dead = attempts >= job.maxAttempts;
            const error = cause instanceof Error ? cause : new Error('Cloudinary destroy failed');
            const base = Math.min(60000 * 2 ** Math.max(0, attempts - 1), 86400000);
            await database_1.prisma.mediaDeletionJob.updateMany({
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
            if (dead)
                instrument_1.Sentry.captureException(error, { tags: { provider: 'cloudinary', operation: 'destroy_image', terminal: 'true' }, extra: { publicId: job.publicId, attempts } });
            logger_1.logger.warn({ err: error, publicId: job.publicId, attempts, dead }, 'Cloudinary deletion job failed');
        }
    }));
    return { processedCount: jobs.length, nextDueAt: await nextDeletionDueAt() };
}
async function nextIntentDueAt() {
    const [row] = await database_1.prisma.$queryRaw `
    SELECT MIN("expiresAt") AS "nextDueAt" FROM media_assets
    WHERE status IN ('PENDING', 'UPLOADED') AND "attachedAt" IS NULL
  `;
    return row?.nextDueAt ? new Date(row.nextDueAt) : null;
}
async function cleanupExpiredIntents(take = 100) {
    const [result] = await database_1.prisma.$queryRaw `
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
    if (result?.deletionDueAt)
        (0, jobSignals_1.signalBackgroundJob)('media-deletion', new Date(result.deletionDueAt));
    return { processedCount: result?.processedCount ?? 0, nextDueAt: await nextIntentDueAt() };
}
exports.mediaService = {
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
//# sourceMappingURL=service.js.map