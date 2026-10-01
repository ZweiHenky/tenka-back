import { describe, expect, it } from 'vitest';
import { effectiveCapacityAt } from './effectiveCapacity';

describe('effectiveCapacityAt', () => {
  const at = new Date('2026-09-24T12:00:00Z');

  it('uses the latest effective grant with deterministic tie breaking', () => {
    expect(effectiveCapacityAt(2, [
      { id: 'a', effectiveAt: new Date('2026-09-24T11:00:00Z'), sequence: 1, newCapacity: 3 },
      { id: 'b', effectiveAt: new Date('2026-09-24T11:00:00Z'), sequence: 2, newCapacity: 4 },
    ], at)).toBe(4);
  });

  it('ignores grants that are not effective yet', () => {
    expect(effectiveCapacityAt(2, [
      { id: 'future', effectiveAt: new Date('2026-09-24T13:00:00Z'), sequence: 1, newCapacity: 5 },
    ], at)).toBe(2);
  });
});
