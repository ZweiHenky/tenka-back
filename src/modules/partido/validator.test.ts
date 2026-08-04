import { describe, expect, it } from 'vitest';
import { updateSchema } from './validator';

describe('partido updateSchema', () => {
  it.each(['canchaId', 'fecha', 'fechaFin'])('rejects structural field %s', (field) => {
    expect(updateSchema.safeParse({ [field]: '2099-01-01T18:00:00.000Z' }).success).toBe(false);
  });

  it('keeps score and one-team swap updates available', () => {
    expect(updateSchema.safeParse({ golesLocal: 2, golesVisitante: 1 }).success).toBe(true);
    expect(updateSchema.safeParse({ equipoLocalId: 'team-2' }).success).toBe(true);
  });
});
