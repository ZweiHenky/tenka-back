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
  liga: { nombre: string }
}

export interface RefereePartidoReadContext {
  expiresAt: Date
  usedAt: Date | null
  partido: {
    id: string
    fecha: Date | null
    estado: string | null
    golesLocal: number
    golesVisitante: number
    penalesLocal: number | null
    penalesVisitante: number | null
    tipoPartido: string
    equipoLocal: { id: string; nombre: string; logo: string | null } | null
    equipoVisitante: { id: string; nombre: string; logo: string | null } | null
    cancha: { id: string; nombre: string } | null
    jornada: { numero: number; division: RefereePartidoDivisionContext } | null
    rondaPlayoff: { division: RefereePartidoDivisionContext } | null
  } | null
}
