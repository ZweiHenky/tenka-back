import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';

export interface ScheduleParticipantWrite {
  id: string;
  jornadaId: string;
  expected: { equipoLocalId: string | null; equipoVisitanteId: string | null };
  data: { equipoLocalId?: unknown; equipoVisitanteId?: unknown };
}

export interface ScheduleChangeSet {
  teamIds: string[];
  jornadaIds: string[];
  partidoIds: string[];
}

export function collectScheduleChanges(writes: ScheduleParticipantWrite[]): ScheduleChangeSet {
  const teamIds = new Set<string>();
  const jornadaIds = new Set<string>();
  const partidoIds = new Set<string>();

  for (const write of writes) {
    const local = write.data.equipoLocalId === undefined
      ? write.expected.equipoLocalId
      : write.data.equipoLocalId as string | null;
    const visitor = write.data.equipoVisitanteId === undefined
      ? write.expected.equipoVisitanteId
      : write.data.equipoVisitanteId as string | null;
    if (local === write.expected.equipoLocalId && visitor === write.expected.equipoVisitanteId) continue;

    for (const teamId of [write.expected.equipoLocalId, write.expected.equipoVisitanteId, local, visitor]) {
      if (teamId) teamIds.add(teamId);
    }
    jornadaIds.add(write.jornadaId);
    partidoIds.add(write.id);
  }

  return {
    teamIds: [...teamIds].sort(),
    jornadaIds: [...jornadaIds].sort(),
    partidoIds: [...partidoIds].sort(),
  };
}

export async function enqueueScheduleChange(
  tx: Prisma.TransactionClient,
  input: { divisionId: string; ligaId: string; changes: ScheduleChangeSet },
): Promise<void> {
  if (input.changes.partidoIds.length === 0) return;

  const teams = await tx.equipo.findMany({
    where: { id: { in: input.changes.teamIds } },
    select: { userId: true },
  });
  const targetUserIds = [...new Set(teams.map((team) => team.userId))].sort();
  if (targetUserIds.length === 0) return;

  const aggregationKey = `schedule-change:${input.divisionId}`;
  const id = randomUUID();
  const providerIdempotencyKey = randomUUID();
  const eventKey = `schedule-change:${id}`;
  const targetJson = JSON.stringify(targetUserIds);
  const jornadaJson = JSON.stringify(input.changes.jornadaIds);
  const partidoJson = JSON.stringify(input.changes.partidoIds);
  const url = `/(drawer)/(public)/liga/${input.ligaId}?divisionId=${input.divisionId}&tab=horario`;

  await configureRawQuerySchema(tx);

  await tx.$executeRaw`
    INSERT INTO notification_outbox (
      id, "eventKey", "divisionId", audience, "eventType", "aggregationKey", payload,
      "targetUserIds", "providerIdempotencyKey", "nextAttemptAt", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${eventKey}, ${input.divisionId}, 'REGISTERED'::"NotificationAudience",
      'SCHEDULE_CHANGED'::"NotificationEventType", ${aggregationKey},
      jsonb_build_object(
        'type', 'schedule_changed', 'divisionId', ${input.divisionId}::text, 'ligaId', ${input.ligaId}::text,
        'jornadaIds', ${jornadaJson}::jsonb, 'partidoIds', ${partidoJson}::jsonb, 'url', ${url}::text
      ),
      ${targetJson}::jsonb, ${providerIdempotencyKey}, NOW() + INTERVAL '30 seconds', NOW(), NOW()
    )
    ON CONFLICT ("aggregationKey") DO UPDATE SET
      "targetUserIds" = (
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT jsonb_array_elements_text(
            COALESCE(notification_outbox."targetUserIds", '[]'::jsonb) || EXCLUDED."targetUserIds"
          ) AS value
        ) merged
      ),
      payload = notification_outbox.payload || jsonb_build_object(
        'jornadaIds', (
          SELECT jsonb_agg(value ORDER BY value)
          FROM (
            SELECT DISTINCT jsonb_array_elements_text(
              COALESCE(notification_outbox.payload->'jornadaIds', '[]'::jsonb)
              || COALESCE(EXCLUDED.payload->'jornadaIds', '[]'::jsonb)
            ) AS value
          ) merged
        ),
        'partidoIds', (
          SELECT jsonb_agg(value ORDER BY value)
          FROM (
            SELECT DISTINCT jsonb_array_elements_text(
              COALESCE(notification_outbox.payload->'partidoIds', '[]'::jsonb)
              || COALESCE(EXCLUDED.payload->'partidoIds', '[]'::jsonb)
            ) AS value
          ) merged
        )
      ),
      "nextAttemptAt" = NOW() + INTERVAL '30 seconds',
      "updatedAt" = NOW()
  `;
}
