"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const node_crypto_1 = require("node:crypto");
const env_1 = require("../../config/env");
const database_1 = require("../../config/database");
const logger_1 = require("../../config/logger");
const instrument_1 = require("../../instrument");
const onesignal_client_1 = require("../notification-subscription/onesignal-client");
function retryDate(attempts, retryAfterMs) {
    const base = Math.min(5000 * 2 ** Math.max(0, attempts - 1), 3600000);
    const delay = Math.max(retryAfterMs ?? 0, base + Math.floor(Math.random() * Math.max(1, base / 4)));
    return new Date(Date.now() + delay);
}
async function claimJobs(workerId, take = 20) {
    return database_1.prisma.$queryRaw `
    WITH exhausted AS (
      UPDATE notification_outbox
      SET status = 'DEAD', "lockedBy" = NULL, "leaseUntil" = NULL,
          "aggregationKey" = NULL, "lastErrorCode" = 'lease_expired_after_max_attempts', "updatedAt" = NOW()
      WHERE status = 'PROCESSING' AND "leaseUntil" <= NOW() AND attempts >= "maxAttempts"
    ), due AS (
      SELECT id FROM notification_outbox
      WHERE attempts < "maxAttempts" AND (
        (status = 'PENDING' AND "nextAttemptAt" <= NOW())
        OR (status = 'PROCESSING' AND "leaseUntil" <= NOW())
      )
      ORDER BY "nextAttemptAt"
      FOR UPDATE SKIP LOCKED
      LIMIT ${take}
    )
    UPDATE notification_outbox job
    SET status = 'PROCESSING', attempts = job.attempts + 1, "lockedBy" = ${workerId},
        "leaseUntil" = NOW() + INTERVAL '60 seconds', "aggregationKey" = NULL, "updatedAt" = NOW()
    FROM due WHERE job.id = due.id
    RETURNING job.id, job."jornadaId", job."divisionId", job.audience, job."eventType",
              job.payload, job."targetUserIds", job."providerIdempotencyKey", job.attempts, job."maxAttempts"
  `;
}
async function complete(jobId, workerId, status) {
    await database_1.prisma.notificationOutbox.updateMany({
        where: { id: jobId, lockedBy: workerId, status: 'PROCESSING' },
        data: { status, aggregationKey: null, sentAt: status === 'SENT' ? new Date() : null, lockedBy: null, leaseUntil: null, lastErrorCode: null },
    });
}
async function resolveNotification(job) {
    if (job.eventType === 'SCHEDULE_CHANGED') {
        const division = await database_1.prisma.division.findUnique({
            where: { id: job.divisionId },
            select: { id: true, ligaId: true },
        });
        if (!division)
            return undefined;
        const storedPayload = job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
            ? job.payload
            : {};
        const targetUserIds = Array.isArray(job.targetUserIds)
            ? [...new Set(job.targetUserIds.filter((id) => typeof id === 'string'))]
            : [];
        if (!targetUserIds.length)
            return null;
        const title = 'Tu programación fue actualizada';
        const body = 'Uno o más partidos de tu equipo cambiaron. Revisa la programación actualizada.';
        return {
            app_id: env_1.env.ONESIGNAL_APP_ID,
            target_channel: 'push',
            headings: { en: title, es: title },
            contents: { en: body, es: body },
            data: {
                type: 'schedule_changed',
                divisionId: division.id,
                ligaId: division.ligaId,
                jornadaIds: storedPayload.jornadaIds,
                partidoIds: storedPayload.partidoIds,
                url: `/(drawer)/(public)/liga/${division.ligaId}?divisionId=${division.id}&tab=horario`,
            },
            include_aliases: { external_id: targetUserIds },
        };
    }
    if (!job.jornadaId)
        return undefined;
    const jornada = await database_1.prisma.jornada.findUnique({
        where: { id: job.jornadaId },
        select: { id: true, numero: true, division: { select: { id: true, nombre: true, ligaId: true, liga: { select: { nombre: true } } } } },
    });
    if (!jornada || jornada.division.id !== job.divisionId)
        return undefined;
    const ownerRows = await database_1.prisma.divisionEquipo.findMany({
        where: { divisionId: job.divisionId },
        select: { equipo: { select: { userId: true } } },
    });
    const ownerIds = [...new Set(ownerRows.map((row) => row.equipo.userId))];
    let target;
    if (job.audience === 'REGISTERED') {
        if (!ownerIds.length)
            return null;
        target = { include_aliases: { external_id: ownerIds } };
    }
    else {
        const followers = await database_1.prisma.divisionNotificationSubscription.findMany({
            where: {
                divisionId: job.divisionId,
                pushSubscriptionId: { not: null },
                OR: [{ userId: null }, { userId: { notIn: ownerIds } }],
            },
            select: { pushSubscriptionId: true },
        });
        if (!followers.length)
            return null;
        const pushIds = [...new Set(followers.map((row) => row.pushSubscriptionId).filter((id) => Boolean(id)))];
        if (!pushIds.length)
            return null;
        target = { include_subscription_ids: pushIds };
    }
    const title = 'Nueva jornada generada';
    const body = `Ya está disponible la Jornada ${jornada.numero} de la división ${jornada.division.nombre} en la liga ${jornada.division.liga.nombre}`;
    return {
        app_id: env_1.env.ONESIGNAL_APP_ID,
        target_channel: 'push',
        headings: { en: title, es: title },
        contents: { en: body, es: body },
        data: {
            type: 'jornada_generated', jornadaId: jornada.id, divisionId: jornada.division.id, ligaId: jornada.division.ligaId,
            url: `/(drawer)/(public)/liga/${jornada.division.ligaId}?divisionId=${jornada.division.id}&tab=horario`,
        },
        ...target,
    };
}
async function processJob(job, workerId) {
    try {
        const payload = await resolveNotification(job);
        if (payload === undefined)
            return complete(job.id, workerId, 'CANCELLED');
        if (payload === null)
            return complete(job.id, workerId, 'SENT');
        await (0, onesignal_client_1.sendNotification)(payload, job.providerIdempotencyKey);
        await complete(job.id, workerId, 'SENT');
    }
    catch (cause) {
        const providerError = cause instanceof onesignal_client_1.OneSignalProviderError ? cause : null;
        if (!providerError) {
            instrument_1.Sentry.captureException(cause, { tags: { worker: 'notification-outbox', operation: 'process_job' } });
        }
        const attempts = job.attempts;
        const dead = providerError ? (!providerError.retryable || attempts >= job.maxAttempts) : attempts >= job.maxAttempts;
        try {
            const result = await database_1.prisma.notificationOutbox.updateMany({
                where: { id: job.id, lockedBy: workerId, status: 'PROCESSING' },
                data: {
                    attempts,
                    status: dead ? 'DEAD' : 'PENDING',
                    aggregationKey: null,
                    nextAttemptAt: retryDate(attempts, providerError?.retryAfterMs),
                    lastErrorCode: (providerError?.code ?? 'internal_error').slice(0, 100),
                    lockedBy: null,
                    leaseUntil: null,
                },
            });
            if (dead && providerError && result.count === 1) {
                instrument_1.Sentry.captureException(providerError, { tags: { provider: 'onesignal', operation: 'send_notification', terminal: 'true' }, extra: { attempts } });
            }
        }
        catch (databaseError) {
            instrument_1.Sentry.captureException(databaseError, { tags: { worker: 'notification-outbox', operation: 'persist_failure' } });
            return;
        }
        logger_1.logger.warn({ event: 'notification.job_failed', attempts, dead, errorCode: providerError?.code ?? 'internal_error' }, 'Notification job failed');
    }
}
async function nextOutboxDueAt() {
    const [row] = await database_1.prisma.$queryRaw `
    SELECT MIN(due_at) AS "nextDueAt" FROM (
      SELECT "nextAttemptAt" AS due_at FROM notification_outbox
      WHERE status = 'PENDING' AND attempts < "maxAttempts"
      UNION ALL
      SELECT "leaseUntil" AS due_at FROM notification_outbox
      WHERE status = 'PROCESSING'
    ) due
  `;
    return row?.nextDueAt ? new Date(row.nextDueAt) : null;
}
async function processOutboxJobs(take = 20) {
    const workerId = (0, node_crypto_1.randomUUID)();
    const jobs = await claimJobs(workerId, take);
    await Promise.all(jobs.map((job) => processJob(job, workerId)));
    return { processedCount: jobs.length, nextDueAt: await nextOutboxDueAt() };
}
exports.notificationService = { claimJobs, processJob, nextOutboxDueAt, processOutboxJobs, retryDate };
//# sourceMappingURL=service.js.map