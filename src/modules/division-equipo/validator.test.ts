import { describe, expect, it } from 'vitest';
import { reemplazoSchema, updateSchema } from './validator';

describe('divisionEquipo updateSchema', () => {
  it.each([
    ['0', '0.00'],
    ['0001.2', '1.20'],
    ['12.3', '12.30'],
    ['9999999999.99', '9999999999.99'],
  ])('accepts %s and emits a canonical string', (input, expected) => {
    expect(updateSchema.parse({ saldoPendiente: input })).toEqual({ saldoPendiente: expected });
  });

  it.each([
    {},
    { saldoPendiente: 1 },
    { saldoPendiente: '-1' },
    { saldoPendiente: '+1' },
    { saldoPendiente: '1.234' },
    { saldoPendiente: '.50' },
    { saldoPendiente: '1.' },
    { saldoPendiente: ' 1.00' },
    { saldoPendiente: '10000000000.00' },
    { saldoPendiente: '1.00', extra: true },
  ])('rejects invalid or non-strict payload %#', (payload) => {
    expect(updateSchema.safeParse(payload).success).toBe(false);
  });
});

describe('divisionEquipo reemplazoSchema', () => {
  it('accepts only a nonempty target id', () => {
    expect(reemplazoSchema.parse({ equipoNuevoId: 'equipo-2' })).toEqual({ equipoNuevoId: 'equipo-2' });
  });

  it.each([
    {},
    { equipoNuevoId: '' },
    { equipoNuevoId: 2 },
    { equipoNuevoId: 'equipo-2', extra: true },
  ])('rejects invalid or non-strict payload %#', (payload) => {
    expect(reemplazoSchema.safeParse(payload).success).toBe(false);
  });
});
