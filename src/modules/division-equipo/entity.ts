import type { DivisionEntity } from '../division/entity';

export interface DivisionEquipoEntity {
  divisionId: string;
  equipoId: string;
  saldoPendiente?: string;
  division?: DivisionEntity;
  equipo?: {
    id: string;
    nombre: string;
    logo: string | null;
    userId: string;
  };
}
