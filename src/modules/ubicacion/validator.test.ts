import { describe, expect, it } from 'vitest';
import { createSchema, findOrCreateSchema, updateSchema } from './validator';

const location = {
  lat: 19.4326,
  lng: -99.1332,
  nombreCompleto: 'Centro',
  estado: 'CDMX',
  municipio: 'Cuauhtemoc',
};

describe('validacion geografica de ubicaciones', () => {
  it('acepta coordenadas validas en todos los flujos', () => {
    expect(createSchema.safeParse(location).success).toBe(true);
    expect(findOrCreateSchema.safeParse(location).success).toBe(true);
    expect(updateSchema.safeParse({ lat: 0, lng: 0 }).success).toBe(true);
  });

  it.each([
    { lat: 91 },
    { lat: -91 },
    { lng: 181 },
    { lng: -181 },
    { lat: Number.NaN },
  ])('rechaza coordenadas fuera de rango: %o', (invalid) => {
    expect(createSchema.safeParse({ ...location, ...invalid }).success).toBe(false);
  });
});
