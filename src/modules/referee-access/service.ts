import crypto from 'node:crypto'
import { prisma } from '../../config/database'
import { NotFoundError, ValidationError } from '../../utils/errors'
import type { AuthenticatedUser } from '../../types/auth'
import { assertOwnerOrAdmin } from '../../utils/authorization'
import { refereeAccessRepository } from './repository'
import { partidoRepository } from '../partido/repository'
import { tablaPosicionService } from '../tabla-posicion/service'
import { rondaPlayoffService } from '../ronda-playoff/service'
import type { RefereeResultInput } from './validator'

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

    await refereeAccessRepository.upsert({ tokenHash, partidoId, createdById: actor.id, expiresAt })
    const url = `https://tenka.studio/arbitro#token=${token}`
    return { token, url, expiresAt }
  },

  async revokeAccess(partidoId: string, actor: AuthenticatedUser): Promise<void> {
    const partido = await partidoRepository.findAuthorizationContext(partidoId)
    if (!partido) throw new NotFoundError('Partido')
    assertOwnerOrAdmin(actor, partido.ligaUserId, 'Partido')

    const existing = await refereeAccessRepository.findByPartidoId(partidoId)
    if (existing) {
      await refereeAccessRepository.delete(existing.id)
    }
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
      horaInicio: partido.fecha,
      equipoLocal: partido.equipoLocal,
      equipoVisitante: partido.equipoVisitante,
      cancha: partido.cancha,
      estado: partido.estado,
      golesLocal: partido.golesLocal,
      golesVisitante: partido.golesVisitante,
      penalesLocal: partido.penalesLocal,
      penalesVisitante: partido.penalesVisitante,
      tipoPartido: partido.tipoPartido,
      jornadaNumero: jornada?.numero ?? null,
      divisionNombre: division?.nombre ?? '',
      ligaNombre: division?.liga.nombre ?? '',
    }
  },

  async updateResultByToken(authHeader: string | undefined, data: RefereeResultInput) {
    const token = extractBearer(authHeader)
    const tokenHash = hashToken(token)

    return prisma.$transaction(async (tx) => {
      const access = await tx.partidoRefereeAccess.findUnique({ where: { tokenHash } })
      if (!access) throw new ValidationError('Enlace no válido o expirado')
      if (access.usedAt) throw new ValidationError('Enlace no válido o expirado')
      if (access.expiresAt < new Date()) throw new ValidationError('Enlace no válido o expirado')

      const old = await tx.partido.findUnique({
        where: { id: access.partidoId },
        select: { estado: true, rondaPlayoffId: true, jornadaId: true },
      })
      if (!old) throw new NotFoundError('Partido')
      if (old.estado === 'FINALIZADO') throw new ValidationError('Este partido ya fue finalizado')

      if (old.rondaPlayoffId) {
        if (data.golesLocal === data.golesVisitante) {
          if (data.penalesLocal == null || data.penalesVisitante == null || data.penalesLocal === data.penalesVisitante) {
            throw new ValidationError('El partido de eliminatoria no puede terminar empatado. Define un ganador por penales.')
          }
        }
      }

      const updated = await tx.partido.update({
        where: { id: access.partidoId },
        data: {
          golesLocal: data.golesLocal,
          golesVisitante: data.golesVisitante,
          penalesLocal: data.penalesLocal ?? null,
          penalesVisitante: data.penalesVisitante ?? null,
          estado: data.estado,
        },
      })

      await tx.partidoRefereeAccess.update({ where: { id: access.id }, data: { usedAt: new Date() } })

      return {
        id: updated.id,
        golesLocal: updated.golesLocal,
        golesVisitante: updated.golesVisitante,
        penalesLocal: updated.penalesLocal,
        penalesVisitante: updated.penalesVisitante,
        estado: updated.estado,
        jornadaId: old.jornadaId,
        rondaPlayoffId: old.rondaPlayoffId,
      }
    }).then(async (result) => {
      if (result.estado === 'FINALIZADO' && result.jornadaId) {
        const jornada = await prisma.jornada.findUnique({ where: { id: result.jornadaId }, select: { divisionId: true } })
        if (jornada) {
          await tablaPosicionService.recalcular(jornada.divisionId)
        }
      }

      if (result.estado === 'FINALIZADO' && result.rondaPlayoffId) {
        await rondaPlayoffService.advanceWinners(result.rondaPlayoffId)
      }

      return {
        id: result.id,
        golesLocal: result.golesLocal,
        golesVisitante: result.golesVisitante,
        penalesLocal: result.penalesLocal,
        penalesVisitante: result.penalesVisitante,
        estado: result.estado,
      }
    })
  },
}
