import { describe, expect, it } from 'vitest';
import { createInJornadaSchema, resultSchema, updateSchema } from './validator';

describe('partido createInJornadaSchema', () => {
  const base = {
    equipoLocalId: 'team-1',
    equipoVisitanteId: 'team-2',
    tipoPartido: 'REGULAR',
    fecha: '2026-08-13',
    horaInicio: '20:00',
    horaFin: '21:00',
    canchaId: null,
  };

  it('accepts the same civil date and time contract as jornada generation', () => {
    expect(createInJornadaSchema.safeParse(base).success).toBe(true);
  });

  it('rejects ISO instants and missing civil times', () => {
    expect(createInJornadaSchema.safeParse({ ...base, fecha: '2026-08-14T02:00:00.000Z' }).success).toBe(false);
    const { horaInicio: _horaInicio, ...withoutStart } = base;
    expect(createInJornadaSchema.safeParse(withoutStart).success).toBe(false);
  });
});

describe('partido updateSchema', () => {
  it.each(['canchaId', 'fecha', 'fechaFin'])('rejects structural field %s', (field) => {
    expect(updateSchema.safeParse({ [field]: '2099-01-01T18:00:00.000Z' }).success).toBe(false);
  });

  it('keeps score and one-team swap updates available', () => {
    expect(updateSchema.safeParse({ golesLocal: 2, golesVisitante: 1 }).success).toBe(true);
    expect(updateSchema.safeParse({ equipoLocalId: 'team-2' }).success).toBe(true);
  });
});

describe('partido resultSchema participaciones', () => {
  const base = { expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0, allocations: [] };

  it('accepts participaciones with side and player', () => {
    expect(resultSchema.safeParse({ ...base, participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }] }).success).toBe(true);
  });

  it('accepts an empty participaciones list and treats the field as optional', () => {
    expect(resultSchema.safeParse({ ...base, participaciones: [] }).success).toBe(true);
    expect(resultSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a participacion without a player or with an empty id', () => {
    expect(resultSchema.safeParse({ ...base, participaciones: [{ ladoMarcador: 'LOCAL' }] }).success).toBe(false);
    expect(resultSchema.safeParse({ ...base, participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: '' }] }).success).toBe(false);
  });
});

describe('partido resultSchema notas', () => {
  const base = { expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0, allocations: [] };

  it('accepts an optional notas field', () => {
    expect(resultSchema.safeParse({ ...base, notas: 'Incidencias del partido' }).success).toBe(true);
    expect(resultSchema.safeParse({ ...base, notas: null }).success).toBe(true);
    expect(resultSchema.safeParse(base).success).toBe(true);
  });

  it('trims notas and converts an empty string to null', () => {
    expect(resultSchema.safeParse({ ...base, notas: '' }).data?.notas).toBeNull();
    expect(resultSchema.safeParse({ ...base, notas: '   ' }).data?.notas).toBeNull();
    expect(resultSchema.safeParse({ ...base, notas: '  texto  ' }).data?.notas).toBe('texto');
  });

  it('rejects notas longer than 1000 characters', () => {
    expect(resultSchema.safeParse({ ...base, notas: 'x'.repeat(1001) }).success).toBe(false);
    expect(resultSchema.safeParse({ ...base, notas: 'x'.repeat(1000) }).success).toBe(true);
  });
});
