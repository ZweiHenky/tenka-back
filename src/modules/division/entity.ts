export interface DivisionEntity {
  id: string;
  nombre: string;
  maxEquipos: number;
  arbitraje: number;
  diasPartido: string | null;
  horarioPartido: string | null;
  duracionPartido: number | null;
  descanso: number | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ligaId: string;
  estadoLigaId: string;
  categoriaId: string;
  tipoId: string;
  tipoCompetenciaId: string;
  liga?: { id: string; nombre: string; logo: string | null };
  estadoLiga?: { id: string; nombre: string };
}
