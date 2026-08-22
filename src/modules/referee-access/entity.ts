export interface PartidoRefereeAccessEntity {
  id: string
  tokenHash: string
  partidoId: string
  createdById: string
  createdAt: Date
  expiresAt: Date
  usedAt: Date | null
}

interface RefereePartidoDivisionContext {
  nombre: string
  registrarParticipaciones: boolean
  registrarGoleo: boolean
  usarPenalesEnEmpates: boolean
  liga: { nombre: string; multiplesCanchas: boolean }
  jugadores: Array<{ equipoId: string; dorsal: number; jugador: { id: string; nombre: string; foto: string | null } }>
}

export interface RefereePartidoReadContext {
  expiresAt: Date
  usedAt: Date | null
  partido: {
    id: string
    version: number
    fecha: Date | null
    fechaFin: Date | null
    canchaId: string | null
    estado: string | null
    golesLocal: number
    golesVisitante: number
    penalesLocal: number | null
    penalesVisitante: number | null
    tipoPartido: string
    notas: string | null
    anotaciones: Array<{ id: string; jugadorId: string | null; equipoId: string | null; ladoMarcador: string; cantidad: number; jugadorNombre: string | null; equipoNombre: string | null; dorsal: number | null }>
    participaciones: Array<{ id: string; jugadorId: string | null; equipoId: string | null; ladoMarcador: string; jugadorIdSnapshot: string | null; equipoIdSnapshot: string | null; jugadorNombre: string | null; equipoNombre: string | null; dorsal: number | null }>
    equipoLocal: { id: string; nombre: string; logo: string | null } | null
    equipoVisitante: { id: string; nombre: string; logo: string | null } | null
    cancha: { id: string; nombre: string } | null
    jornada: { numero: number; division: RefereePartidoDivisionContext } | null
    rondaPlayoff: { division: RefereePartidoDivisionContext } | null
  } | null
}
