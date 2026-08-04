import { describe, expect, it } from 'vitest';
import { availabilityRangeSchema } from './validator';

describe('availabilityRangeSchema', () => {
  it('accepts ISO datetimes with offsets and transforms them to dates', () => {
    const result = availabilityRangeSchema.parse({
      inicio: '2026-08-01T00:00:00Z',
      fin: '2026-08-02T00:00:00+00:00',
    });
    expect(result.inicio).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    expect(result.fin).toEqual(new Date('2026-08-02T00:00:00.000Z'));
  });

  it.each([
    [{ inicio: 'not-a-date', fin: '2026-08-02T00:00:00Z' }, 'ISO'],
    [{ inicio: '2026-08-02T00:00:00Z', fin: '2026-08-01T00:00:00Z' }, 'posterior'],
    [{ inicio: '2026-08-01T00:00:00Z', fin: '2026-09-02T00:00:00Z' }, '31 dias'],
  ])('rejects invalid ranges', (input, message) => {
    const result = availabilityRangeSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain(message);
  });

  it('allows exactly 31 days', () => {
    expect(availabilityRangeSchema.safeParse({
      inicio: '2026-08-01T00:00:00Z',
      fin: '2026-09-01T00:00:00Z',
    }).success).toBe(true);
  });
});
