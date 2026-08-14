import { describe, expect, it } from 'vitest';
import { civilToInstant, dateKeyInTimeZone, isValidTimeZone, timeInTimeZone } from './timeZone';

describe('time zone utilities', () => {
  it('converts league civil time to an absolute instant', () => {
    expect(civilToInstant('2026-08-13', '14:00', 'America/Mexico_City').toISOString()).toBe('2026-08-13T20:00:00.000Z');
    expect(civilToInstant('2026-08-13', '14:00', 'Europe/Madrid').toISOString()).toBe('2026-08-13T12:00:00.000Z');
  });

  it('formats an instant in the league zone', () => {
    const instant = new Date('2026-08-13T20:00:00.000Z');
    expect(dateKeyInTimeZone(instant, 'America/Mexico_City')).toBe('2026-08-13');
    expect(timeInTimeZone(instant, 'America/Mexico_City')).toBe('14:00');
  });

  it('validates IANA zones', () => {
    expect(isValidTimeZone('America/Cancun')).toBe(true);
    expect(isValidTimeZone('not-a-zone')).toBe(false);
  });
});
