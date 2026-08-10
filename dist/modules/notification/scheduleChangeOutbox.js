"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectScheduleChanges = collectScheduleChanges;
exports.enqueueScheduleChange = enqueueScheduleChange;
const node_crypto_1 = require("node:crypto");
const env_1 = require("../../config/env");
function databaseSchema() {
    const schema = new URL(env_1.env.DATABASE_URL).searchParams.get('schema') ?? 'public';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema))
        throw new Error('Invalid database schema');
    return schema;
}
function collectScheduleChanges(writes) {
    const teamIds = new Set();
    const jornadaIds = new Set();
    const partidoIds = new Set();
    for (const write of writes) {
        const local = write.data.equipoLocalId === undefined
            ? write.expected.equipoLocalId
            : write.data.equipoLocalId;
        const visitor = write.data.equipoVisitanteId === undefined
            ? write.expected.equipoVisitanteId
            : write.data.equipoVisitanteId;
        if (local === write.expected.equipoLocalId && visitor === write.expected.equipoVisitanteId)
            continue;
        for (const teamId of [write.expected.equipoLocalId, write.expected.equipoVisitanteId, local, visitor]) {
            if (teamId)
                teamIds.add(teamId);
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
async function enqueueScheduleChange(tx, input) {
    if (input.changes.partidoIds.length === 0)
        return;
    const teams = await tx.equipo.findMany({
        where: { id: { in: input.changes.teamIds } },
        select: { userId: true },
    });
    const targetUserIds = [...new Set(teams.map((team) => team.userId))].sort();
    if (targetUserIds.length === 0)
        return;
    const aggregationKey = `schedule-change:${input.divisionId}`;
    const id = (0, node_crypto_1.randomUUID)();
    const providerIdempotencyKey = (0, node_crypto_1.randomUUID)();
    const eventKey = `schedule-change:${id}`;
    const targetJson = JSON.stringify(targetUserIds);
    const jornadaJson = JSON.stringify(input.changes.jornadaIds);
    const partidoJson = JSON.stringify(input.changes.partidoIds);
    const url = `/(drawer)/(public)/liga/${input.ligaId}?divisionId=${input.divisionId}&tab=horario`;
    // Prisma's adapter schema qualifies ORM queries but does not set search_path for raw SQL.
    await tx.$queryRaw `SELECT set_config('search_path', ${databaseSchema()}, true)`;
    await tx.$executeRaw `
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
//# sourceMappingURL=scheduleChangeOutbox.js.map