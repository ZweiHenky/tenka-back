/** Formatos que la app sabe manejar. El nombre es editable; el código no debe cambiar. */
export const FORMATOS_COMPETENCIA = ['LIGA_Y_ELIMINATORIAS', 'ELIMINATORIA'] as const;
export type FormatoCompetencia = (typeof FORMATOS_COMPETENCIA)[number];

export interface TipoCompetenciaEntity {
  id: string;
  nombre: string;
  codigo: string;
}
