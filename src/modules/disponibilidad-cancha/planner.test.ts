import { describe, expect, it } from 'vitest';
import { halfOpenOverlaps, planCourtAssignments, type PlanningInterval } from './planner';

const at = (hour: number) => new Date(`2026-08-01T${String(hour).padStart(2, '0')}:00:00.000Z`);
const interval = (id: string, start: number, end: number, canchaId: string | null = null): PlanningInterval => ({
  id,
  fecha: at(start),
  fechaFin: at(end),
  canchaId,
});

describe('halfOpenOverlaps', () => {
  it('does not overlap intervals that only touch at an endpoint', () => {
    expect(halfOpenOverlaps(interval('a', 10, 11), interval('b', 11, 12))).toBe(false);
  });

  it('detects containment and partial overlap in either direction', () => {
    expect(halfOpenOverlaps(interval('a', 10, 14), interval('b', 11, 12))).toBe(true);
    expect(halfOpenOverlaps(interval('b', 11, 12), interval('a', 10, 14))).toBe(true);
  });
});

describe('planCourtAssignments', () => {
  it('assigns deterministically to the least-loaded available active court', () => {
    const result = planCourtAssignments({
      mode: 'MULTIPLE',
      canchas: [{ id: 'b' }, { id: 'a' }],
      ocupaciones: [interval('persisted', 8, 9, 'a')],
      borradores: [interval('second', 11, 12), interval('first', 10, 11)],
    });

    expect(result.asignados.map(({ id, canchaId }) => [id, canchaId])).toEqual([
      ['first', 'b'],
      ['second', 'a'],
    ]);
    expect(result.conflictos).toEqual([]);
  });

  it('reserves valid manual assignments and reports their overlaps without moving them', () => {
    const result = planCourtAssignments({
      mode: 'MULTIPLE',
      canchas: [{ id: 'a' }, { id: 'b' }],
      ocupaciones: [interval('persisted', 10, 12, 'a')],
      borradores: [interval('automatic', 10, 11), interval('manual', 10, 11, 'a')],
    });

    expect(result.asignados).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manual', canchaId: 'a', fecha: at(10) }),
      expect.objectContaining({ id: 'automatic', canchaId: 'b', fecha: at(10) }),
    ]));
    expect(result.conflictos).toContainEqual({
      partidoId: 'manual', canchaId: 'a', conPartidos: ['persisted'], reason: 'OVERLAP',
    });
  });

  it('reassigns an inactive manual court and reports drafts when all capacity overlaps', () => {
    const reassigned = planCourtAssignments({
      mode: 'MULTIPLE',
      canchas: [{ id: 'active' }],
      ocupaciones: [],
      borradores: [interval('draft', 10, 11, 'inactive')],
    });
    expect(reassigned.asignados[0].canchaId).toBe('active');

    const blocked = planCourtAssignments({
      mode: 'MULTIPLE',
      canchas: [{ id: 'active' }],
      ocupaciones: [interval('persisted', 10, 12, 'active')],
      borradores: [interval('draft', 11, 13)],
    });
    expect(blocked.sinAsignar.map(({ id }) => id)).toEqual(['draft']);
    expect(blocked.conflictos).toEqual([{
      partidoId: 'draft', canchaId: null, conPartidos: ['persisted'], reason: 'NO_CAPACITY',
    }]);
  });

  it('uses one virtual capacity in SINGLE mode regardless of persisted canchaId', () => {
    const result = planCourtAssignments({
      mode: 'SINGLE',
      canchas: [{ id: 'ignored' }],
      ocupaciones: [interval('persisted', 10, 11, null)],
      borradores: [interval('touching', 11, 12, 'ignored'), interval('overlap', 10, 11, 'ignored')],
    });

    expect(result.asignados).toEqual([expect.objectContaining({ id: 'touching', canchaId: null })]);
    expect(result.sinAsignar.map(({ id }) => id)).toEqual(['overlap']);
  });
});
