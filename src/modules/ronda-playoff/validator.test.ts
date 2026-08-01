import { describe, expect, it } from 'vitest';
import { generateSchema } from './validator';

describe('ronda playoff generation validation', () => {
  it.each([2, 4, 8, 16, 32])('accepts supported team count %i', (cantidadEquipos) => {
    expect(generateSchema.safeParse({ divisionId: 'division-1', cantidadEquipos }).success).toBe(true);
  });

  it.each([1, 3, 6, 64])('rejects unsupported team count %i with the supported values', (cantidadEquipos) => {
    const result = generateSchema.safeParse({ divisionId: 'division-1', cantidadEquipos });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe('Debe ser 2, 4, 8, 16 o 32');
  });
});
