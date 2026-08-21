import { describe, expect, it } from 'vitest';
import { firstIssueMessage } from '../../utils/validation';
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

describe('siembra', () => {
  const base = { divisionId: 'division-1', cantidadEquipos: 4 };
  const llave = (equipoLocalId: string, equipoVisitanteId: string) => ({ equipoLocalId, equipoVisitanteId });

  it('cae en POSICIONES cuando no viene, para no romper clientes viejos', () => {
    const result = generateSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.siembra).toBe('POSICIONES');
  });

  it('acepta manual con la cantidad exacta de llaves', () => {
    const result = generateSchema.safeParse({
      ...base,
      siembra: 'MANUAL',
      llaves: [llave('a', 'b'), llave('c', 'd')],
    });
    expect(result.success).toBe(true);
  });

  it('rechaza manual sin llaves', () => {
    const result = generateSchema.safeParse({ ...base, siembra: 'MANUAL' });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toBe('La siembra manual necesita las llaves');
  });

  it('dice cuántas llaves faltan cuando no cuadran', () => {
    const result = generateSchema.safeParse({ ...base, siembra: 'MANUAL', llaves: [llave('a', 'b')] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssueMessage(result.error)).toBe('Se esperaban 2 llaves para 4 equipos, llegaron 1');
    }
  });

  // Aceptarlas en silencio haría creer que el cruce enviado se respetó.
  it.each(['POSICIONES', 'ALEATORIA'])('rechaza llaves en siembra %s', (siembra) => {
    const result = generateSchema.safeParse({ ...base, siembra, llaves: [llave('a', 'b'), llave('c', 'd')] });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toBe('Solo la siembra manual acepta llaves');
  });

  it('rechaza una siembra desconocida', () => {
    expect(generateSchema.safeParse({ ...base, siembra: 'SORTEO' }).success).toBe(false);
  });
});
