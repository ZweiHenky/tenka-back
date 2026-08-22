import { ValidationError } from './errors';

/**
 * Estados en los que una división acepta escrituras. Un solo lugar decide esto: antes convivían
 * dos criterios —agregar un partido exigía "En Curso", pero generar la jornada entera no miraba
 * el estado— y el resultado era que en una división finalizada podías crear una jornada completa
 * pero no añadirle un partido.
 *
 * `FINALIZADA` y `CANCELADA` son de solo lectura, resultados incluidos. Para corregir algo hay
 * que reabrir la división.
 */
const ESTADOS_ESCRIBIBLES = new Set(['BORRADOR', 'ABIERTA', 'EN_CURSO']);

const MOTIVO: Record<string, string> = {
  FINALIZADA: 'La división está finalizada y es de solo lectura. Cambia su estado para poder editarla.',
  CANCELADA: 'La división está cancelada y es de solo lectura. Cambia su estado para poder editarla.',
};

export function isDivisionWritable(codigo: string | null | undefined): boolean {
  // Un código desconocido se deja pasar: bloquear por no reconocerlo dejaría inservible una
  // división cuyo catálogo alguien amplió.
  return codigo == null || !MOTIVO[codigo];
}

export function assertDivisionWritable(estado: { codigo: string } | null | undefined): void {
  const codigo = estado?.codigo;
  if (isDivisionWritable(codigo)) return;
  throw new ValidationError(MOTIVO[codigo!]);
}

export { ESTADOS_ESCRIBIBLES };
