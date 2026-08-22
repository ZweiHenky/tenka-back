/**
 * Estados que la app sabe manejar. El nombre es editable por API; el código no debe cambiar,
 * porque de él dependen la visibilidad pública y la regla de solo lectura.
 */
export const ESTADOS_LIGA = ['BORRADOR', 'ABIERTA', 'EN_CURSO', 'FINALIZADA', 'CANCELADA'] as const;
export type CodigoEstadoLiga = (typeof ESTADOS_LIGA)[number];

export interface EstadoLigaEntity {
  id: string;
  nombre: string;
  codigo: string;
}
