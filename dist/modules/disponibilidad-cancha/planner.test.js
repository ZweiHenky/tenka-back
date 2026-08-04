"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const planner_1 = require("./planner");
const at = (hour) => new Date(`2026-08-01T${String(hour).padStart(2, '0')}:00:00.000Z`);
const interval = (id, start, end, canchaId = null) => ({
    id,
    fecha: at(start),
    fechaFin: at(end),
    canchaId,
});
(0, vitest_1.describe)('halfOpenOverlaps', () => {
    (0, vitest_1.it)('does not overlap intervals that only touch at an endpoint', () => {
        (0, vitest_1.expect)((0, planner_1.halfOpenOverlaps)(interval('a', 10, 11), interval('b', 11, 12))).toBe(false);
    });
    (0, vitest_1.it)('detects containment and partial overlap in either direction', () => {
        (0, vitest_1.expect)((0, planner_1.halfOpenOverlaps)(interval('a', 10, 14), interval('b', 11, 12))).toBe(true);
        (0, vitest_1.expect)((0, planner_1.halfOpenOverlaps)(interval('b', 11, 12), interval('a', 10, 14))).toBe(true);
    });
});
(0, vitest_1.describe)('planCourtAssignments', () => {
    (0, vitest_1.it)('assigns deterministically to the least-loaded available active court', () => {
        const result = (0, planner_1.planCourtAssignments)({
            mode: 'MULTIPLE',
            canchas: [{ id: 'b' }, { id: 'a' }],
            ocupaciones: [interval('persisted', 8, 9, 'a')],
            borradores: [interval('second', 11, 12), interval('first', 10, 11)],
        });
        (0, vitest_1.expect)(result.asignados.map(({ id, canchaId }) => [id, canchaId])).toEqual([
            ['first', 'b'],
            ['second', 'a'],
        ]);
        (0, vitest_1.expect)(result.conflictos).toEqual([]);
    });
    (0, vitest_1.it)('reserves valid manual assignments and reports their overlaps without moving them', () => {
        const result = (0, planner_1.planCourtAssignments)({
            mode: 'MULTIPLE',
            canchas: [{ id: 'a' }, { id: 'b' }],
            ocupaciones: [interval('persisted', 10, 12, 'a')],
            borradores: [interval('automatic', 10, 11), interval('manual', 10, 11, 'a')],
        });
        (0, vitest_1.expect)(result.asignados).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({ id: 'manual', canchaId: 'a', fecha: at(10) }),
            vitest_1.expect.objectContaining({ id: 'automatic', canchaId: 'b', fecha: at(10) }),
        ]));
        (0, vitest_1.expect)(result.conflictos).toContainEqual({
            partidoId: 'manual', canchaId: 'a', conPartidos: ['persisted'], reason: 'OVERLAP',
        });
    });
    (0, vitest_1.it)('reassigns an inactive manual court and reports drafts when all capacity overlaps', () => {
        const reassigned = (0, planner_1.planCourtAssignments)({
            mode: 'MULTIPLE',
            canchas: [{ id: 'active' }],
            ocupaciones: [],
            borradores: [interval('draft', 10, 11, 'inactive')],
        });
        (0, vitest_1.expect)(reassigned.asignados[0].canchaId).toBe('active');
        const blocked = (0, planner_1.planCourtAssignments)({
            mode: 'MULTIPLE',
            canchas: [{ id: 'active' }],
            ocupaciones: [interval('persisted', 10, 12, 'active')],
            borradores: [interval('draft', 11, 13)],
        });
        (0, vitest_1.expect)(blocked.sinAsignar.map(({ id }) => id)).toEqual(['draft']);
        (0, vitest_1.expect)(blocked.conflictos).toEqual([{
                partidoId: 'draft', canchaId: null, conPartidos: ['persisted'], reason: 'NO_CAPACITY',
            }]);
    });
    (0, vitest_1.it)('uses one virtual capacity in SINGLE mode regardless of persisted canchaId', () => {
        const result = (0, planner_1.planCourtAssignments)({
            mode: 'SINGLE',
            canchas: [{ id: 'ignored' }],
            ocupaciones: [interval('persisted', 10, 11, null)],
            borradores: [interval('touching', 11, 12, 'ignored'), interval('overlap', 10, 11, 'ignored')],
        });
        (0, vitest_1.expect)(result.asignados).toEqual([vitest_1.expect.objectContaining({ id: 'touching', canchaId: null })]);
        (0, vitest_1.expect)(result.sinAsignar.map(({ id }) => id)).toEqual(['overlap']);
    });
});
//# sourceMappingURL=planner.test.js.map