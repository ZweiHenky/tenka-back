export interface TablaPosicionEntity {
  id: string;
  partidosJugados: number;
  ganados: number;
  empatados: number;
  perdidos: number;
  golesFavor: number;
  golesContra: number;
  diferenciaGoles: number;
  puntos: number;
  divisionId: string;
  equipoId: string;
  equipo?: { id: string; nombre: string; logo: string | null };
}
