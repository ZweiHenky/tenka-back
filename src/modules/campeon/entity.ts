export interface CampeonEntity {
  id: string;
  divisionId: string | null;
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

/**
 * Una división ganada, para el palmarés de un equipo.
 *
 * Los datos de la división salen de los **snapshots**, no de la relación: la división pudo
 * borrarse y el título sobrevive igual.
 */
export interface CampeonatoEquipoEntity {
  id: string;
  divisionId: string | null;
  /** Cuándo se coronó. Es el dato que la app muestra como fecha del logro. */
  createdAt: Date;
  divisionNombre: string;
  ligaId: string | null;
  ligaNombre: string;
  ligaLogo: string | null;
}

/** Un título de goleo, para el palmarés de un jugador. */
export interface CampeonatoJugadorEntity {
  id: string;
  divisionId: string | null;
  createdAt: Date;
  divisionNombre: string;
  ligaId: string | null;
  ligaNombre: string;
  ligaLogo: string | null;
  jugadorGoles: number | null;
}

/** Un título anterior de una división: lo mismo, más el equipo que lo ganó. */
export interface CampeonHistorialEntity {
  id: string;
  createdAt: Date;
  archivadoEn: Date | null;
  equipoId: string | null;
  equipoNombre: string;
  equipoLogo: string | null;
}

export interface CampeonWriteData {
  divisionNombre: string;
  ligaId: string;
  ligaNombre: string;
  ligaLogo: string | null;
  divisionEstadoCodigo: string;
  equipoId: string;
  equipoNombre: string;
  equipoLogo: string | null;
  jugadorId: string | null;
  jugadorNombre: string | null;
  jugadorFoto: string | null;
  jugadorGoles: number | null;
}
