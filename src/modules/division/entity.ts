export interface DivisionEntity {
  id: string;
  nombre: string;
  maxEquipos: number;
  arbitraje: number;
  registrarParticipaciones: boolean;
  usarPenalesEnEmpates: boolean;
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
  canchaUnicaId: string | null;
  liga?: { id: string; nombre: string; logo: string | null };
  estadoLiga?: { id: string; nombre: string };
  /**
   * Días y horario por cancha. Cuando trae filas, son la configuración real y `diasPartido`/
   * `horarioPartido` son solo su resumen. Sin filas, la división usa los escalares.
   */
  canchaHorarios?: Array<{ canchaId: string; diasPartido: string; horarioPartido: string }>;
}
