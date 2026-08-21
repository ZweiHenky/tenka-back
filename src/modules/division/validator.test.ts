import { describe, expect, it } from 'vitest';
import { createDivisionSchema, updateDivisionSchema } from './validator';
import { firstIssueMessage } from '../../utils/validation';

/** Lo mínimo que el formulario manda siempre, sin la parte de horario. */
const base = {
  nombre: 'Primera',
  maxEquipos: 8,
  arbitraje: 0,
  ligaId: 'liga-1',
  categoriaId: 'categoria-1',
  tipoId: 'tipo-1',
  tipoCompetenciaId: 'competencia-1',
  duracionPartido: 60,
  descanso: 0,
  usarPenalesEnEmpates: true,
};

const rows = [
  { canchaId: 'court-1', diasPartido: 'L', horarioPartido: '18:00 - 20:00' },
  { canchaId: 'court-2', diasPartido: 'J', horarioPartido: '20:00 - 22:00' },
];

describe('createDivisionSchema', () => {
  it('acepta el modo "mismo horario" con los escalares', () => {
    const result = createDivisionSchema.safeParse({ ...base, diasPartido: 'L,J', horarioPartido: '18:00 - 20:00' });
    expect(result.success).toBe(true);
  });

  it('acepta el modo por cancha sin escalares', () => {
    const result = createDivisionSchema.safeParse({ ...base, horariosPorCancha: rows });
    expect(result.success).toBe(true);
  });

  it('rechaza sin ninguno de los dos formatos, con un mensaje accionable', () => {
    const result = createDivisionSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssueMessage(result.error)).toBe('Configura días y horario de partido, o al menos una cancha con horario');
    }
  });

  it('rechaza escalares a medias', () => {
    expect(createDivisionSchema.safeParse({ ...base, diasPartido: 'L,J' }).success).toBe(false);
  });

  it('rechaza canchas repetidas', () => {
    const result = createDivisionSchema.safeParse({
      ...base,
      horariosPorCancha: [rows[0], { ...rows[1], canchaId: 'court-1' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toBe('No repitas la misma cancha en los horarios');
  });

  it('rechaza un horario sin rangos válidos', () => {
    const result = createDivisionSchema.safeParse({
      ...base,
      horariosPorCancha: [{ canchaId: 'court-1', diasPartido: 'L', horarioPartido: 'cuando sea' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toContain('Rango de horario inválido');
  });

  it('exige duracionPartido: sin ella la división no puede generar jornadas', () => {
    const { duracionPartido: _omitida, ...sinDuracion } = base;
    const result = createDivisionSchema.safeParse({ ...sinDuracion, diasPartido: 'L', horarioPartido: '18:00 - 20:00' });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toMatch(/^duracionPartido: /);
  });

  it('nombra el campo cuando falta uno obligatorio', () => {
    const { nombre: _omitido, ...sinNombre } = base;
    const result = createDivisionSchema.safeParse({ ...sinNombre, diasPartido: 'L', horarioPartido: '18:00 - 20:00' });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toMatch(/^nombre: /);
  });
});

describe('updateDivisionSchema', () => {
  it('acepta volver a horario compartido con un arreglo vacío', () => {
    const result = updateDivisionSchema.safeParse({
      diasPartido: 'L,J',
      horarioPartido: '18:00 - 20:00',
      horariosPorCancha: [],
    });
    expect(result.success).toBe(true);
  });

  it('acepta solo la configuración por cancha', () => {
    expect(updateDivisionSchema.safeParse({ horariosPorCancha: rows }).success).toBe(true);
  });

  it('acepta una edición que no toca el horario', () => {
    expect(updateDivisionSchema.safeParse({ nombre: 'Segunda' }).success).toBe(true);
  });

  it('rechaza canchas repetidas', () => {
    const result = updateDivisionSchema.safeParse({ horariosPorCancha: [rows[0], rows[0]] });
    expect(result.success).toBe(false);
  });
});

describe('el formato se fija al crear', () => {
  it('descarta tipoCompetenciaId en una actualización', () => {
    const result = updateDivisionSchema.safeParse({ nombre: 'A', tipoCompetenciaId: 'otro-formato' });

    expect(result.success).toBe(true);
    // Cambiar el formato dejaría a la división con jornadas o rondas que ya no aplican.
    if (result.success) expect(result.data).not.toHaveProperty('tipoCompetenciaId');
  });
});
