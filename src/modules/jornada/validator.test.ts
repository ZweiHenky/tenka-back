import { describe, expect, it } from 'vitest';
import { generateNextSchema, idempotencyKeySchema } from './validator';

const slot = {
  fecha: '2099-01-31',
  horaInicio: '18:00',
  horaFin: '19:30',
  equipoLocalId: 'team-1',
  equipoVisitanteId: 'team-2',
  tipo: 'regular' as const,
  canchaId: null,
};

describe('generateNextSchema', () => {
  it('accepts a strict valid generation request', () => {
    expect(generateNextSchema.safeParse({ slots: [slot], equipoIds: ['team-1', 'team-2'] }).success).toBe(true);
  });

  it.each([
    { ...slot, fecha: '2099-02-29' },
    { ...slot, horaInicio: '24:00' },
    { ...slot, horaFin: '18:7' },
    { ...slot, tipo: 'entrenamiento' },
    { ...slot, equipoLocalId: '' },
    { ...slot, unexpected: true },
  ])('rejects malformed slots', (invalidSlot) => {
    expect(generateNextSchema.safeParse({ slots: [invalidSlot] }).success).toBe(false);
  });

  it('rejects unknown request fields and duplicate team IDs', () => {
    expect(generateNextSchema.safeParse({ slots: [slot], unknown: true }).success).toBe(false);
    expect(generateNextSchema.safeParse({ equipoIds: ['team-1', 'team-1'] }).success).toBe(false);
  });
});

describe('idempotencyKeySchema', () => {
  it('normalizes a valid key and rejects missing, short, or oversized keys', () => {
    expect(idempotencyKeySchema.parse('  generation-key-1  ')).toBe('generation-key-1');
    expect(idempotencyKeySchema.safeParse(undefined).success).toBe(false);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});
