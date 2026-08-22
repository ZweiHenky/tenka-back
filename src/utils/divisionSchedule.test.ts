import { describe, expect, it } from 'vitest';
import { parseConfiguredRanges } from './timeRanges';
import {
  parseConfiguredDays,
  resolveDivisionSchedule,
  summarizeDivisionSchedule,
  type DivisionScheduleSource,
} from './divisionSchedule';

const base: DivisionScheduleSource = {
  multiplesCanchas: true,
  diasPartido: 'lun, jue',
  horarioPartido: '18:00 - 20:00',
  canchaHorarios: [],
};

describe('parseConfiguredDays', () => {
  it('handles accents, separators and wrap-around ranges', () => {
    expect([...parseConfiguredDays('Sábado / Domingo')].sort()).toEqual([0, 6]);
    expect([...parseConfiguredDays('L-V')].sort()).toEqual([1, 2, 3, 4, 5]);
    expect([...parseConfiguredDays('viernes a lunes')].sort()).toEqual([0, 1, 5, 6]);
    expect([...parseConfiguredDays('lun y jue')].sort()).toEqual([1, 4]);
  });

  it('ignores unknown tokens', () => {
    expect([...parseConfiguredDays('pizza')].sort()).toEqual([]);
  });
});

describe('resolveDivisionSchedule', () => {
  it('uses the division scalars under a single-court league', () => {
    const resolved = resolveDivisionSchedule({ ...base, multiplesCanchas: false }, new Set());
    expect([...resolved.keys()]).toEqual([null]);
    expect(resolved.get(null)!.ranges).toEqual([{ start: 1080, end: 1200 }]);
  });

  it('ignores rows under a single-court league', () => {
    const source = {
      ...base,
      multiplesCanchas: false,
      canchaHorarios: [{ canchaId: 'c1', diasPartido: 'mar', horarioPartido: '09:00 - 10:00' }],
    };
    const resolved = resolveDivisionSchedule(source, new Set(['c1']));
    expect([...resolved.keys()]).toEqual([null]);
  });

  it('gives each configured court its own days and ranges', () => {
    const source = {
      ...base,
      canchaHorarios: [
        { canchaId: 'c1', diasPartido: 'lun', horarioPartido: '18:00 - 20:00' },
        { canchaId: 'c2', diasPartido: 'jue', horarioPartido: '20:00 - 22:00' },
      ],
    };
    const resolved = resolveDivisionSchedule(source, new Set(['c1', 'c2']));
    expect([...resolved.get('c1')!.days]).toEqual([1]);
    expect(resolved.get('c1')!.ranges).toEqual([{ start: 1080, end: 1200 }]);
    expect([...resolved.get('c2')!.days]).toEqual([4]);
    expect(resolved.get('c2')!.ranges).toEqual([{ start: 1200, end: 1320 }]);
  });

  it('omits courts with no row: the division does not play there', () => {
    const source = {
      ...base,
      canchaHorarios: [{ canchaId: 'c1', diasPartido: 'lun', horarioPartido: '18:00 - 20:00' }],
    };
    const resolved = resolveDivisionSchedule(source, new Set(['c1', 'c2']));
    expect(resolved.has('c2')).toBe(false);
  });

  it('drops rows whose court is inactive', () => {
    const source = {
      ...base,
      canchaHorarios: [{ canchaId: 'c1', diasPartido: 'lun', horarioPartido: '18:00 - 20:00' }],
    };
    // c1 is not in the active set, so the row is ignored and the legacy fallback kicks in.
    const resolved = resolveDivisionSchedule(source, new Set(['c2']));
    expect(resolved.has('c1')).toBe(false);
    expect(resolved.has('c2')).toBe(true);
  });

  it('falls back to the scalars on every active court when there are no rows', () => {
    const resolved = resolveDivisionSchedule(base, new Set(['c1', 'c2']));
    expect([...resolved.keys()].sort()).toEqual(['c1', 'c2']);
    expect(resolved.get('c1')!.ranges).toEqual([{ start: 1080, end: 1200 }]);
  });
});

describe('summarizeDivisionSchedule', () => {
  it('unions days and merges overlapping ranges', () => {
    const summary = summarizeDivisionSchedule([
      { canchaId: 'c1', diasPartido: 'lun', horarioPartido: '18:00 - 20:00' },
      { canchaId: 'c2', diasPartido: 'jue', horarioPartido: '19:00 - 22:00' },
    ]);
    expect(summary.diasPartido).toBe('lun, jue');
    expect(summary.horarioPartido).toBe('18:00 - 22:00');
  });

  it('keeps disjoint ranges separate and sorted', () => {
    const summary = summarizeDivisionSchedule([
      { canchaId: 'c1', diasPartido: 'sab', horarioPartido: '20:00 - 22:00' },
      { canchaId: 'c2', diasPartido: 'sab', horarioPartido: '08:00 - 10:00' },
    ]);
    expect(summary.horarioPartido).toBe('08:00 - 10:00 / 20:00 - 22:00');
  });

  it('round-trips through the parsers it feeds', () => {
    const summary = summarizeDivisionSchedule([
      { canchaId: 'c1', diasPartido: 'lun', horarioPartido: '18:00 - 20:00' },
      { canchaId: 'c2', diasPartido: 'dom', horarioPartido: '09:00 - 11:00' },
    ]);
    expect(parseConfiguredRanges(summary.horarioPartido)).toEqual([
      { start: 540, end: 660 },
      { start: 1080, end: 1200 },
    ]);
    expect([...parseConfiguredDays(summary.diasPartido)].sort()).toEqual([0, 1]);
  });

  it('returns empty strings with no rows', () => {
    expect(summarizeDivisionSchedule([])).toEqual({ diasPartido: '', horarioPartido: '' });
  });
});
