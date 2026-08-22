export interface CampeonEntity {
  id: string;
  divisionId: string;
  equipoId: string | null;
  equipoNombre: string;
  equipoLogo: string | null;
  jugadorId: string | null;
  jugadorNombre: string | null;
  jugadorFoto: string | null;
  jugadorGoles: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampeonWriteData {
  equipoId: string;
  equipoNombre: string;
  equipoLogo: string | null;
  jugadorId: string | null;
  jugadorNombre: string | null;
  jugadorFoto: string | null;
  jugadorGoles: number | null;
}
