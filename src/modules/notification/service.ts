import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';
import { OneSignalProviderError, sendNotification } from '../notification-subscription/onesignal-client';

interface ClaimedNotificationJob {
  id: string;
  jornadaId: string | null;
  divisionId: string;
  audience: 'REGISTERED' | 'FOLLOWERS';
  eventType: 'JORNADA_GENERATED' | 'SCHEDULE_CHANGED';
  payload: unknown;
  targetUserIds: unknown;
  providerIdempotencyKey: string;
  attempts: number;
  maxAttempts: number;
}

function retryDate(attempts: number, retryAfterMs?: number): Date {
  const base = Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
  const delay = Math.max(retryAfterMs ?? 0, base + Math.floor(Math.random() * Math.max(1, base / 4)));
  return new Date(Date.now() + delay);
}

async function claimJobs(workerId: string, take = 20): Promise<ClaimedNotificationJob[]> {
  return prisma.$queryRaw<ClaimedNotificationJob[]>`
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

async function complete(jobId: string, workerId: string, status: 'SENT' | 'CANCELLED'): Promise<void> {
  await prisma.notificationOutbox.updateMany({
    where: { id: jobId, lockedBy: workerId, status: 'PROCESSING' },
    data: { status, aggregationKey: null, sentAt: status === 'SENT' ? new Date() : null, lockedBy: null, leaseUntil: null, lastErrorCode: null },
  });
}

async function resolveNotification(job: ClaimedNotificationJob): Promise<Record<string, unknown> | null | undefined> {
  if (job.eventType === 'SCHEDULE_CHANGED') {
    const division = await prisma.division.findUnique({
      where: { id: job.divisionId },
      select: { id: true, ligaId: true },
    });
    if (!division) return undefined;

    const storedPayload = job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
      ? job.payload as Record<string, unknown>
      : {};
    const targetUserIds = Array.isArray(job.targetUserIds)
      ? [...new Set(job.targetUserIds.filter((id): id is string => typeof id === 'string'))]
      : [];
    if (!targetUserIds.length) return null;

    const title = 'Tu programación fue actualizada';
    const body = 'Uno o más partidos de tu equipo cambiaron. Revisa la programación actualizada.';
    return {
      app_id: env.ONESIGNAL_APP_ID,
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

  if (!job.jornadaId) return undefined;
  const jornada = await prisma.jornada.findUnique({
    where: { id: job.jornadaId },
    select: { id: true, numero: true, division: { select: { id: true, nombre: true, ligaId: true, liga: { select: { nombre: true } } } } },
  });
  if (!jornada || jornada.division.id !== job.divisionId) return undefined;

  const ownerRows = await prisma.divisionEquipo.findMany({
    where: { divisionId: job.divisionId },
    select: { equipo: { select: { userId: true } } },
  });
  const ownerIds = [...new Set(ownerRows.map((row) => row.equipo.userId))];
  let target: Record<string, unknown>;
  if (job.audience === 'REGISTERED') {
    if (!ownerIds.length) return null;
    target = { include_aliases: { external_id: ownerIds } };
  } else {
    const followers = await prisma.divisionNotificationSubscription.findMany({
      where: {
        divisionId: job.divisionId,
        pushSubscriptionId: { not: null },
        OR: [{ userId: null }, { userId: { notIn: ownerIds } }],
      },
      select: { pushSubscriptionId: true },
    });
    if (!followers.length) return null;
    const pushIds = [...new Set(followers.map((row) => row.pushSubscriptionId).filter((id): id is string => Boolean(id)))];
    if (!pushIds.length) return null;
    target = { include_subscription_ids: pushIds };
  }

  const title = 'Nueva jornada generada';
  const body = `Ya está disponible la Jornada ${jornada.numero} de la división ${jornada.division.nombre} en la liga ${jornada.division.liga.nombre}`;
  return {
    app_id: env.ONESIGNAL_APP_ID,
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

async function processJob(job: ClaimedNotificationJob, workerId: string): Promise<void> {
  try {
    const payload = await resolveNotification(job);
    if (payload === undefined) return complete(job.id, workerId, 'CANCELLED');
    if (payload === null) return complete(job.id, workerId, 'SENT');
    await sendNotification(payload, job.providerIdempotencyKey);
    await complete(job.id, workerId, 'SENT');
  } catch (cause) {
    const providerError = cause instanceof OneSignalProviderError ? cause : null;
    if (!providerError) {
      Sentry.captureException(cause, { tags: { worker: 'notification-outbox', operation: 'process_job' } });
    }
    const attempts = job.attempts;
    const dead = providerError ? (!providerError.retryable || attempts >= job.maxAttempts) : attempts >= job.maxAttempts;
    try {
      const result = await prisma.notificationOutbox.updateMany({
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
        Sentry.captureException(providerError, { tags: { provider: 'onesignal', operation: 'send_notification', terminal: 'true' }, extra: { attempts } });
      }
    } catch (databaseError) {
      Sentry.captureException(databaseError, { tags: { worker: 'notification-outbox', operation: 'persist_failure' } });
      return;
    }
    logger.warn({ event: 'notification.job_failed', attempts, dead, errorCode: providerError?.code ?? 'internal_error' }, 'Notification job failed');
  }
}

async function processOutboxJobs(take = 20): Promise<void> {
  const workerId = randomUUID();
  const jobs = await claimJobs(workerId, take);
  await Promise.all(jobs.map((job) => processJob(job, workerId)));
}

export const notificationService = { claimJobs, processJob, processOutboxJobs, retryDate };
