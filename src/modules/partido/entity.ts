export interface PartidoEntity {
  id: string;
  golesLocal: number;
  golesVisitante: number;
  penalesLocal: number | null;
  penalesVisitante: number | null;
  fecha: Date | null;
  fechaFin: Date | null;
  estado: string | null;
  llave: number | null;
  tipoPartido: string;
  exhibicionLocal: boolean;
  exhibicionVisitante: boolean;
  createdAt: Date;
  updatedAt: Date;
  jornadaId: string | null;
  rondaPlayoffId: string | null;
  equipoLocalId: string | null;
  equipoVisitanteId: string | null;
  canchaId: string | null;
  equipoLocal?: { id: string; nombre: string; logo: string | null } | null;
  equipoVisitante?: { id: string; nombre: string; logo: string | null } | null;
  cancha?: { id: string; nombre: string } | null;
  arbitros?: Array<{ id: string; nombre: string }>;
  jornadasRecalculadas?: number;
}
