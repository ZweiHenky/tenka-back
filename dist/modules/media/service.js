"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaService = void 0;
const cloudinary_1 = require("cloudinary");
const database_1 = require("../../config/database");
const env_1 = require("../../config/env");
const logger_1 = require("../../config/logger");
const instrument_1 = require("../../instrument");
cloudinary_1.v2.config({
    cloud_name: env_1.env.CLOUDINARY_CLOUD_NAME,
    api_key: env_1.env.CLOUDINARY_API_KEY,
    api_secret: env_1.env.CLOUDINARY_API_SECRET,
    timeout: env_1.env.PROVIDER_TIMEOUT_MS,
});
function extractPublicId(url) {
    if (!url)
        return null;
    if (!url.includes('res.cloudinary.com'))
        return null;
    try {
        const parts = url.split('/');
        const uploadIndex = parts.findIndex((p) => p === 'upload');
        if (uploadIndex === -1)
            return null;
        const afterVersion = parts.slice(uploadIndex + 2).join('/');
        const withoutExt = afterVersion.replace(/\.[^.]+$/, '');
        return decodeURIComponent(withoutExt) || null;
    }
    catch {
        return null;
    }
}
async function deleteImage(publicId) {
    const startedAt = Date.now();
    let timer;
    try {
        const providerCall = cloudinary_1.v2.uploader.destroy(publicId).then((result) => result, (error) => { throw error; });
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Cloudinary destroy timed out')), env_1.env.PROVIDER_TIMEOUT_MS);
        });
        const result = await Promise.race([providerCall, timeout]);
        const ok = result.result === 'ok' || result.result === 'not found';
        const status = ok ? 'success' : 'failed';
        logger_1.logger[ok ? 'info' : 'warn']({ provider: 'cloudinary', operation: 'destroy_image', status, durationMs: Date.now() - startedAt, timeout: false }, `Provider operation ${ok ? 'completed' : 'failed'}`);
        if (!ok)
            instrument_1.Sentry.captureException(new Error('Cloudinary destroy failed'), { tags: { provider: 'cloudinary', operation: 'destroy_image' } });
        return ok;
    }
    catch (e) {
        const error = e instanceof Error ? e : new Error('Cloudinary destroy failed');
        const timedOut = error.message === 'Cloudinary destroy timed out';
        logger_1.logger.warn({ provider: 'cloudinary', operation: 'destroy_image', status: 'error', durationMs: Date.now() - startedAt, timeout: timedOut, errorName: error.name }, 'Provider operation failed');
        instrument_1.Sentry.captureException(error, { tags: { provider: 'cloudinary', operation: 'destroy_image', timeout: String(timedOut) } });
        return false;
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function generateSignature(params) {
    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary_1.v2.utils.api_sign_request({ ...params, timestamp }, env_1.env.CLOUDINARY_API_SECRET);
    return { signature, timestamp };
}
async function scheduleDeletion(publicId) {
    if (!publicId)
        return;
    await database_1.prisma.mediaDeletionJob.create({ data: { publicId } });
}
async function scheduleImageCleanup(url, storedPublicId) {
    const pid = storedPublicId || (url ? extractPublicId(url) : null);
    if (pid)
        await scheduleDeletion(pid);
}
async function processDeletionJobs() {
    const jobs = await database_1.prisma.mediaDeletionJob.findMany({
        where: { nextTryAt: { lte: new Date() } },
        take: 20,
    });
    for (const job of jobs) {
        const ok = await deleteImage(job.publicId);
        if (ok) {
            await database_1.prisma.mediaDeletionJob.delete({ where: { id: job.id } });
        }
        else {
            await database_1.prisma.mediaDeletionJob.update({
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
exports.mediaService = {
    extractPublicId,
    deleteImage,
    generateSignature,
    scheduleDeletion,
    scheduleImageCleanup,
    processDeletionJobs,
};
//# sourceMappingURL=service.js.map