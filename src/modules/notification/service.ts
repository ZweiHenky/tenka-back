import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';

const ONESIGNAL_URL = 'https://api.onesignal.com/notifications';

type OneSignalPayload = Record<string, unknown>;

async function send(payload: OneSignalPayload) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(ONESIGNAL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${env.ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const error = new Error(`OneSignal send failed with status ${res.status}`);
      logger.warn({ provider: 'onesignal', operation: 'send_notification', status: res.status, durationMs: Date.now() - startedAt, timeout: false }, 'Provider operation failed');
      Sentry.captureException(error, { tags: { provider: 'onesignal', operation: 'send_notification' }, extra: { status: res.status } });
    } else {
      logger.info({ provider: 'onesignal', operation: 'send_notification', status: res.status, durationMs: Date.now() - startedAt, timeout: false }, 'Provider operation completed');
    }
  } catch (e) {
    const timeout = controller.signal.aborted;
    const error = e instanceof Error ? e : new Error('OneSignal send failed');
    logger.warn({ provider: 'onesignal', operation: 'send_notification', status: 'error', durationMs: Date.now() - startedAt, timeout, errorName: error.name }, 'Provider operation failed');
    Sentry.captureException(error, { tags: { provider: 'onesignal', operation: 'send_notification', timeout: String(timeout) } });
  } finally {
    clearTimeout(timer);
  }
}

function buildPayload(title: string, body: string, data: Record<string, unknown>, extra: OneSignalPayload = {}): OneSignalPayload {
  return {
    app_id: env.ONESIGNAL_APP_ID,
    target_channel: 'push',
    headings: { en: title, es: title },
    contents: { en: body, es: body },
    data: data ?? {},
    ...extra,
  };
}

export const notificationService = {
  async notifyJornadaGenerated(jornadaId: string, divisionId: string, ligaId: string) {
    const jornada = await prisma.jornada.findUnique({
      where: { id: jornadaId },
      select: { numero: true },
    });
    if (!jornada) return;

    const division = await prisma.division.findUnique({
      where: { id: divisionId },
      select: { nombre: true, liga: { select: { nombre: true } } },
    });
    if (!division) return;

    const title = 'Nueva jornada generada';
    const body = `Ya está disponible la Jornada ${jornada.numero} de la división ${division.nombre} en la liga ${division.liga.nombre}`;
    const data = {
      type: 'jornada_generated',
      jornadaId,
      divisionId,
      ligaId,
      url: `/(drawer)/(public)/liga/${ligaId}?divisionId=${divisionId}&tab=horario`,
    };

    // 1. Enviar a usuarios registrados (dueños/capitanes de equipos)
    const links = await prisma.divisionEquipo.findMany({
      where: { divisionId },
      include: { equipo: { select: { userId: true } } },
    });
    const userIds = [...new Set(links.map((l) => l.equipo.userId).filter(Boolean))];

    if (userIds.length > 0) {
      await send(buildPayload(title, body, data, {
        include_aliases: { external_id: userIds },
      }));
    }

    // 2. Enviar a seguidores de la división (suscripción anónima por tag)
    await send(buildPayload(title, body, data, {
      filters: [
        { field: 'tag', key: `division_${divisionId}`, relation: '=', value: 'true' },
      ],
    }));
  },
};
