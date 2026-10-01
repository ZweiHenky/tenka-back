import crypto from 'node:crypto'
import { prisma } from '../../config/database'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors'
import type { AuthenticatedUser } from '../../types/auth'
import { assertOwnerOrAdmin } from '../../utils/authorization'
import { refereeAccessRepository } from './repository'
import { exposeAnotacionRead, exposeParticipacionRead, partidoRepository } from '../partido/repository'
import type { RefereeResultInput } from './validator'
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock'
import { gateResultWriteInTransaction, getResultContext, writeResultInTransaction } from '../partido/resultWriter'
import { observeResourceAccessShadowInTransaction } from '../billing/resourceAccessShadow'

const LINK_EXPIRY_MS = 4 * 60 * 60 * 1000
const TOKEN_BYTES = 32
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url')
}

function isValidTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9\-_]{43}$/.test(token)
}

function extractBearer(authHeader?: string): string {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ValidationError('Token de acceso no válido')
  }
  const token = authHeader.slice(7)
  if (!isValidTokenFormat(token)) {
    throw new ValidationError('Token de acceso no válido')
  }
  return token
}

export const refereeAccessService = {
  async createAccess(partidoId: string, actor: AuthenticatedUser): Promise<{ token: string; url: string; expiresAt: Date }> {
    const partido = await partidoRepository.findAuthorizationContext(partidoId)
    if (!partido) throw new NotFoundError('Partido')
    assertOwnerOrAdmin(actor, partido.ligaUserId, 'Partido')
    const token = generateToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + LINK_EXPIRY_MS)

    await prisma.$transaction(async (tx) => {
      if (partido.divisionId) {
        await observeResourceAccessShadowInTransaction(tx, {
          operation: 'referee-access.create', capability: 'MANAGE_DIVISION', actor, divisionId: partido.divisionId, resourceType: 'DIVISION',
        })
      }
      await tx.partidoRefereeAccess.upsert({
        where: { partidoId },
        update: { tokenHash, createdById: actor.id, expiresAt, usedAt: null },
        create: { tokenHash, partidoId, createdById: actor.id, expiresAt },
      })
    })
    const url = `https://tenka.studio/arbitro#token=${token}`
    return { token, url, expiresAt }
  },

  async revokeAccess(partidoId: string, actor: AuthenticatedUser): Promise<void> {
    const partido = await partidoRepository.findAuthorizationContext(partidoId)
    if (!partido) throw new NotFoundError('Partido')
    assertOwnerOrAdmin(actor, partido.ligaUserId, 'Partido')
    await prisma.$transaction(async (tx) => {
      if (partido.divisionId) {
        await observeResourceAccessShadowInTransaction(tx, {
          operation: 'referee-access.revoke', capability: 'MANAGE_DIVISION', actor, divisionId: partido.divisionId, resourceType: 'DIVISION',
        })
      }
      const existing = await tx.partidoRefereeAccess.findFirst({ where: { partidoId } })
      if (existing) await tx.partidoRefereeAccess.delete({ where: { id: existing.id } })
    })
  },

  async getLinkStatus(partidoId: string, actor: AuthenticatedUser): Promise<{ exists: boolean; expiresAt: Date | null }> {
    const partido = await partidoRepository.findAuthorizationContext(partidoId)
    if (!partido) throw new NotFoundError('Partido')
    assertOwnerOrAdmin(actor, partido.ligaUserId, 'Partido')

    const access = await refereeAccessRepository.findByPartidoId(partidoId)
    if (!access || access.usedAt || access.expiresAt < new Date()) {
      return { exists: false, expiresAt: null }
    }
    return { exists: true, expiresAt: access.expiresAt }
  },

  async getPartidoByToken(authHeader: string | undefined) {
    const token = extractBearer(authHeader)
    const access = await refereeAccessRepository.findPartidoReadContextByTokenHash(hashToken(token))
    if (!access) throw new ValidationError('Enlace no válido o expirado')
    if (access.usedAt) throw new ValidationError('Enlace no válido o expirado')
    if (access.expiresAt < new Date()) throw new ValidationError('Enlace no válido o expirado')

    const partido = access.partido
    if (!partido) throw new NotFoundError('Partido')

    const jornada = partido.jornada
    const ronda = partido.rondaPlayoff
    const division = jornada?.division ?? ronda?.division

    return {
      id: partido.id,
      fecha: partido.fecha,
      fechaFin: partido.fechaFin,
      horaInicio: partido.fecha,
      equipoLocal: partido.equipoLocal,
      equipoVisitante: partido.equipoVisitante,
      cancha: partido.cancha,
      canchaId: partido.canchaId,
      multiplesCanchas: division?.liga.multiplesCanchas ?? false,
      estado: partido.estado,
      version: partido.version,
      golesLocal: partido.golesLocal,
      golesVisitante: partido.golesVisitante,
      penalesLocal: partido.penalesLocal,
      penalesVisitante: partido.penalesVisitante,
      tipoPartido: partido.tipoPartido,
      notas: partido.notas,
      anotaciones: partido.anotaciones.map(exposeAnotacionRead),
      participaciones: partido.participaciones.map(exposeParticipacionRead),
      registrarParticipaciones: division?.registrarParticipaciones ?? false,
      registrarGoleo: division?.registrarGoleo ?? true,
      usarPenalesEnEmpates: division?.usarPenalesEnEmpates ?? true,
      jugadoresLocal: (division?.jugadores ?? [])
        .filter((row) => row.equipoId === partido.equipoLocal?.id)
        .map((row) => ({ ...row.jugador, dorsal: row.dorsal })) ?? [],
      jugadoresVisitante: (division?.jugadores ?? [])
        .filter((row) => row.equipoId === partido.equipoVisitante?.id)
        .map((row) => ({ ...row.jugador, dorsal: row.dorsal })) ?? [],
      jornadaNumero: jornada?.numero ?? null,
      divisionNombre: division?.nombre ?? '',
      ligaNombre: division?.liga.nombre ?? '',
    }
  },

  async updateResultByToken(authHeader: string | undefined, data: RefereeResultInput) {
    const token = extractBearer(authHeader)
    const tokenHash = hashToken(token)
    const initialAccess = await prisma.partidoRefereeAccess.findUnique({ where: { tokenHash } })
    if (!initialAccess || initialAccess.usedAt || initialAccess.expiresAt < new Date()) {
      throw new ValidationError('Enlace no válido o expirado')
    }
    const initial = await getResultContext(prisma, initialAccess.partidoId)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          const authorizedAccess = await tx.partidoRefereeAccess.findUnique({ where: { tokenHash } })
          if (!authorizedAccess || authorizedAccess.usedAt || authorizedAccess.expiresAt < new Date()) {
            throw new ValidationError('Enlace no válido o expirado')
          }
          await gateResultWriteInTransaction(tx, initial.division.id)
          await acquireLeagueScheduleLock(tx, initial.division.liga.id)

          const lockedAccess = await tx.partidoRefereeAccess.findUnique({ where: { tokenHash } })
          if (!lockedAccess || lockedAccess.usedAt || lockedAccess.expiresAt < new Date()) {
            throw new ValidationError('Enlace no válido o expirado')
          }
          const locked = await getResultContext(tx, lockedAccess.partidoId)
          if (locked.division.liga.id !== initial.division.liga.id) {
            throw new ValidationError('El partido cambió durante la actualización; vuelve a intentarlo')
          }
          const updated = await writeResultInTransaction(tx, lockedAccess.partidoId, data)
          await tx.partidoRefereeAccess.update({ where: { id: lockedAccess.id }, data: { usedAt: new Date() } })
          return updated
        }, { isolationLevel: 'ReadCommitted', timeout: 30_000 })
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < 2) continue
        if (error?.code === 'P2034') throw new ConflictError('El resultado cambió durante la actualización; vuelve a intentarlo')
        throw error
      }
    }
    throw new ConflictError('El resultado cambió durante la actualización; vuelve a intentarlo')
  },
}
