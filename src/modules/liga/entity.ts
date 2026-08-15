export interface DivisionConRelaciones {
  id: string;
  nombre: string;
  maxEquipos: number;
  arbitraje: number;
  diasPartido: string | null;
  horarioPartido: string | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  categoria: { id: string; nombre: string };
  tipo: { id: string; nombre: string };
  estadoLiga: { id: string; nombre: string };
  tipoCompetencia: { id: string; nombre: string };
}

export interface LigaCanchaEntity {
  id: string;
  nombre: string;
  nombreNormalizado: string;
  activa: boolean;
  createdAt: Date;
  updatedAt: Date;
  ligaId: string;
}

export interface LigaArbitroEntity {
  id: string;
  nombre: string;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
  ligaId: string;
}

export interface ProgramacionRecientePartidoDto {
  id: string;
  fecha: Date | null;
  fechaFin: Date | null;
  equipoLocal: { id: string; nombre: string; logo: string | null } | null;
  equipoVisitante: { id: string; nombre: string; logo: string | null } | null;
  cancha: { id: string; nombre: string } | null;
}

export interface ProgramacionRecienteJornadaDto {
  id: string;
  numero: number;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  partidos: ProgramacionRecientePartidoDto[];
}

export interface ProgramacionRecienteLigaDto {
  id: string;
  nombre: string;
  multiplesCanchas: boolean;
  divisiones: Array<{
    id: string;
    nombre: string;
    categoria: { id: string; nombre: string };
    jornadas: ProgramacionRecienteJornadaDto[];
  }>;
}

export interface LigaReglaItem {
  titulo: string;
  detalle: string;
}

export interface LigaEntity {
  id: string;
  nombre: string;
  nombreNormalizado: string;
  descripcion: string;
  logo: string | null;
  logoPublicId: string | null;
  cancha: string | null;
  canchaPublicId: string | null;
  multiplesCanchas: boolean;
  usaArbitros: boolean;
  timeZone: string;
  reglas?: LigaReglaItem[] | null;
  createdAt: Date;
  updatedAt: Date;
  ubicacionId: string;
  userId: string;
  user?: {
    name: string | null;
    phoneNumber: string | null;
    showPhoneInPublicLeague: boolean;
  };
  ubicacion?: {
    id: string;
    nombreCompleto: string;
    estado: string;
    municipio: string;
    lat: number;
    lng: number;
    timeZone: string;
  };
  divisiones?: DivisionConRelaciones[];
  canchas?: LigaCanchaEntity[];
  arbitros?: LigaArbitroEntity[];
}

export interface UserLeagueListDto {
  id: string;
  nombre: string;
  logo: string | null;
}

export interface PublicLeagueListDto extends UserLeagueListDto {
  descripcion: string;
  cancha: string | null;
  ubicacionId: string;
  divisiones: Array<{
    id: string;
    nombre: string;
    maxEquipos: number;
    arbitraje: number;
    diasPartido: string | null;
    horarioPartido: string | null;
    categoria: { id: string; nombre: string };
    tipo: { id: string; nombre: string };
    estadoLiga: { id: string; nombre: string };
  }>;
}
