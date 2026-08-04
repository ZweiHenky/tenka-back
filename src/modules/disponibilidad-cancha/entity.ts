export interface CanchaDisponible {
  id: string;
  nombre: string;
}

export interface PartidoOcupacion {
  id: string;
  fecha: Date;
  fechaFin: Date;
  canchaId: string | null;
  division: { id: string; nombre: string };
}

export interface LigaDisponibilidadContext {
  id: string;
  multiplesCanchas: boolean;
  canchas: CanchaDisponible[];
}

export interface DisponibilidadCanchas {
  ligaId: string;
  mode: 'SINGLE' | 'MULTIPLE';
  inicio: Date;
  fin: Date;
  canchas: CanchaDisponible[];
  ocupaciones: PartidoOcupacion[];
  asignaciones: Record<string, PartidoOcupacion[]>;
  partidosSinCancha: PartidoOcupacion[];
}
