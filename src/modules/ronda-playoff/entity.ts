import type { PartidoEntity } from '../partido/entity';

export interface RondaPlayoffEntity {
  id: string;
  nombre: string;
  orden: number;
  createdAt: Date;
  updatedAt: Date;
  divisionId: string;
}

export interface RondaPlayoffReadEntity extends RondaPlayoffEntity {
  partidos: PartidoEntity[];
}
