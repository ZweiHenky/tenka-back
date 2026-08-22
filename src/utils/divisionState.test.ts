import { describe, expect, it } from 'vitest';
import { assertDivisionWritable, isDivisionWritable } from './divisionState';

describe('isDivisionWritable', () => {
  it.each(['BORRADOR', 'ABIERTA', 'EN_CURSO'])('deja escribir en %s', (codigo) => {
    expect(isDivisionWritable(codigo)).toBe(true);
  });

  it.each(['FINALIZADA', 'CANCELADA'])('congela %s', (codigo) => {
    expect(isDivisionWritable(codigo)).toBe(false);
  });

  // Bloquear por no reconocer el código dejaría inservible una división cuyo catálogo alguien
  // amplió. Ante la duda, se deja pasar.
  it.each([null, undefined, 'ESTADO_NUEVO'])('deja pasar un código que no reconoce (%s)', (codigo) => {
    expect(isDivisionWritable(codigo)).toBe(true);
  });
});

describe('assertDivisionWritable', () => {
  it('no lanza con un estado escribible', () => {
    expect(() => assertDivisionWritable({ codigo: 'EN_CURSO' })).not.toThrow();
  });

  it.each([
    ['FINALIZADA', 'finalizada'],
    ['CANCELADA', 'cancelada'],
  ])('lanza 422 nombrando el estado en %s', (codigo, palabra) => {
    try {
      assertDivisionWritable({ codigo });
      throw new Error('debió lanzar');
    } catch (error: any) {
      expect(error.statusCode).toBe(422);
      expect(error.message).toContain(palabra);
      // El mensaje tiene que decir cómo salir del bloqueo, no solo que está bloqueado.
      expect(error.message).toContain('Cambia su estado');
    }
  });

  it('no lanza sin estado', () => {
    expect(() => assertDivisionWritable(null)).not.toThrow();
    expect(() => assertDivisionWritable(undefined)).not.toThrow();
  });
});
