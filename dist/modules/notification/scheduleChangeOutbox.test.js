"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const scheduleChangeOutbox_1 = require("./scheduleChangeOutbox");
(0, vitest_1.describe)('schedule change outbox', () => {
    (0, vitest_1.it)('collects before and after participants only for material participant changes', () => {
        (0, vitest_1.expect)((0, scheduleChangeOutbox_1.collectScheduleChanges)([
            {
                id: 'unchanged', jornadaId: 'jornada-1',
                expected: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
                data: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
            },
            {
                id: 'changed', jornadaId: 'jornada-2',
                expected: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
                data: { equipoLocalId: 'team-3', equipoVisitanteId: 'team-2' },
            },
        ])).toEqual({
            teamIds: ['team-1', 'team-2', 'team-3'],
            jornadaIds: ['jornada-2'],
            partidoIds: ['changed'],
        });
    });
    (0, vitest_1.it)('suppresses an outbox event when every rewrite is a no-op', async () => {
        const tx = { equipo: { findMany: vitest_1.vi.fn() }, $queryRaw: vitest_1.vi.fn(), $executeRaw: vitest_1.vi.fn() };
        await (0, scheduleChangeOutbox_1.enqueueScheduleChange)(tx, {
            divisionId: 'division-1', ligaId: 'liga-1',
            changes: (0, scheduleChangeOutbox_1.collectScheduleChanges)([{
                    id: 'partido-1', jornadaId: 'jornada-1',
                    expected: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
                    data: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
                }]),
        });
        (0, vitest_1.expect)(tx.equipo.findMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(tx.$executeRaw).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('deduplicates owners and uses one atomic aggregate upsert with a 30 second debounce', async () => {
        const executeRaw = vitest_1.vi.fn().mockResolvedValue(1);
        const tx = {
            equipo: { findMany: vitest_1.vi.fn().mockResolvedValue([
                    { userId: 'owner-2' }, { userId: 'owner-1' }, { userId: 'owner-2' },
                ]) }, $queryRaw: vitest_1.vi.fn().mockResolvedValue([{ set_config: 'public' }]),
            $executeRaw: executeRaw,
        };
        await (0, scheduleChangeOutbox_1.enqueueScheduleChange)(tx, {
            divisionId: 'division-1', ligaId: 'liga-1',
            changes: { teamIds: ['team-1'], jornadaIds: ['jornada-1'], partidoIds: ['partido-1'] },
        });
        (0, vitest_1.expect)(tx.equipo.findMany).toHaveBeenCalledWith({
            where: { id: { in: ['team-1'] } }, select: { userId: true },
        });
        const sql = executeRaw.mock.calls[0][0].join(' ');
        const values = executeRaw.mock.calls[0].slice(1);
        (0, vitest_1.expect)(sql).toContain('ON CONFLICT ("aggregationKey") DO UPDATE');
        (0, vitest_1.expect)(sql).toContain("INTERVAL '30 seconds'");
        (0, vitest_1.expect)(sql).toContain('jsonb_array_elements_text');
        (0, vitest_1.expect)(values).toContain('schedule-change:division-1');
        (0, vitest_1.expect)(values).toContain('["owner-1","owner-2"]');
    });
    (0, vitest_1.it)('does not enqueue when affected teams have no owners', async () => {
        const tx = { equipo: { findMany: vitest_1.vi.fn().mockResolvedValue([]) }, $queryRaw: vitest_1.vi.fn(), $executeRaw: vitest_1.vi.fn() };
        await (0, scheduleChangeOutbox_1.enqueueScheduleChange)(tx, {
            divisionId: 'division-1', ligaId: 'liga-1',
            changes: { teamIds: ['team-1'], jornadaIds: ['jornada-1'], partidoIds: ['partido-1'] },
        });
        (0, vitest_1.expect)(tx.$executeRaw).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=scheduleChangeOutbox.test.js.map