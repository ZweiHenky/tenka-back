import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/database', async () => (await import('./service.test-mocks')).databaseModuleMock)
vi.mock('./repository', async () => (await import('./service.test-mocks')).repositoryModuleMock)
vi.mock('../tabla-posicion/service', async () => (await import('./service.test-mocks')).tablaPosicionModuleMock)
vi.mock('../ronda-playoff/service', async () => (await import('./service.test-mocks')).rondaPlayoffModuleMock)

import {
  context,
  owner,
  partido,
  partidoRepository,
  partidoService,
  resetServiceTestHarness,
} from './service.test-harness'

const playoff = {
  ...context,
  jornadaId: null,
  rondaPlayoffId: 'round-1',
  tipoPartido: 'ELIMINATORIA',
}

beforeEach(() => {
  resetServiceTestHarness()
  vi.mocked(partidoRepository.findAuthorizationContext).mockResolvedValue(playoff)
  vi.mocked(partidoRepository.update).mockResolvedValue({ ...partido, ...playoff, estado: 'FINALIZADO', golesLocal: 1 } as any)
})

describe('partidoService playoff finalization schedule', () => {
  it.each([
    ['missing dates', { fecha: null, fechaFin: null }, 'primero genera la jornada'],
    ['invalid interval', { fechaFin: playoff.fecha }, 'primero genera la jornada'],
    ['multiple-court missing court', { multiplesCanchas: true, canchaId: null }, 'sin cancha'],
  ])('rejects %s from the locked persisted context', async (_case, override, message) => {
    vi.mocked(partidoRepository.findAuthorizationContext).mockResolvedValue({ ...playoff, ...override })

    await expect(partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 1 }, owner))
      .rejects.toThrow(message)
    expect(partidoRepository.update).not.toHaveBeenCalled()
  })

  it('allows a null court for a single-court league', async () => {
    const updated = { ...partido, ...playoff, estado: 'FINALIZADO', golesLocal: 1 } as any
    vi.mocked(partidoRepository.update).mockResolvedValue(updated)

    await expect(partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 1 }, owner))
      .resolves.toBe(updated)
  })
})
