export interface JornadaEntity {
  id: string;
  numero: number;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  createdAt: Date;
  updatedAt: Date;
  divisionId: string;
  partidos?: Array<{
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
    jornadaId: string | null;
    rondaPlayoffId: string | null;
    equipoLocalId: string | null;
    equipoVisitanteId: string | null;
    canchaId: string | null;
    exhibicionLocal: boolean;
    exhibicionVisitante: boolean;
    equipoLocal?: { id: string; nombre: string; logo: string | null } | null;
    equipoVisitante?: { id: string; nombre: string; logo: string | null } | null;
    cancha?: { id: string; nombre: string } | null;
    arbitros?: Array<{ id: string; nombre: string }>;
  }>;
}
