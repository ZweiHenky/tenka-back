import { describe, expect, it } from 'vitest';
import { createSchema, updateSchema } from './validator';

describe('equipo nombre validator', () => {
  it('recorta el nombre al crear y actualizar', () => {
    expect(createSchema.parse({ nombre: '  Halcones  ', userId: 'user-1' }).nombre).toBe('Halcones');
    expect(updateSchema.parse({ nombre: '  Leones  ' }).nombre).toBe('Leones');
  });

  it('rechaza un nombre compuesto solo por espacios', () => {
    expect(createSchema.safeParse({ nombre: '   ', userId: 'user-1' }).success).toBe(false);
  });

  it('does not expose ownership in create or update inputs', () => {
    expect(createSchema.parse({ nombre: 'Halcones', userId: 'other-user' })).not.toHaveProperty('userId');
    expect(updateSchema.parse({ nombre: 'Leones', userId: 'other-user' })).not.toHaveProperty('userId');
  });
});
