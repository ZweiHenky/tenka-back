import { vi } from 'vitest';

import { prisma } from '../../config/database';
import { findDeterministicMatching, partidoService } from './service';
import { partidoRepository } from './repository';
import { tablaPosicionService } from '../tabla-posicion/service';

export { findDeterministicMatching, partidoRepository, partidoService, prisma, tablaPosicionService };

export const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' as const };
export const other = { id: 'other-user', email: 'other@test.com', rol: 'LIGA' as const };
export const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' as const };

export const context = {
  id: 'partido-1',
  version: 0,
  ligaUserId: 'owner-1',
  ligaId: 'liga-1',
  estado: 'PROGRAMADO',
  golesLocal: 0,
  golesVisitante: 0,
  penalesLocal: null,
  penalesVisitante: null,
  jornadaId: 'jornada-1',
  rondaPlayoffId: null,
  divisionId: 'division-1',
  tipoPartido: 'REGULAR',
  equipoLocalId: 'equipo-1',
  equipoVisitanteId: 'equipo-2',
  fecha: new Date('2026-08-01T18:00:00Z'),
  fechaFin: new Date('2026-08-01T19:00:00Z'),
  canchaId: null,
  multiplesCanchas: false,
};

export const partido = {
  ...context,
  golesLocal: 0,
  golesVisitante: 0,
  penalesLocal: null,
  penalesVisitante: null,
};

export function resetServiceTestHarness(): void {
  vi.clearAllMocks();
  vi.mocked(tablaPosicionService.recalcular).mockReset().mockResolvedValue(undefined);
  vi.mocked(partidoRepository.findAuthorizationContext).mockResolvedValue(context);
  vi.mocked(partidoRepository.findAllVisible).mockResolvedValue([partido] as any);
  vi.mocked(partidoRepository.findById).mockResolvedValue(partido as any);
  vi.mocked(partidoRepository.findVisibleById).mockResolvedValue(partido as any);
  vi.mocked(partidoRepository.findVisibleByJornada).mockResolvedValue([partido] as any);
  vi.mocked(partidoRepository.findVisibleByRondaPlayoff).mockResolvedValue([partido] as any);
  vi.mocked(partidoRepository.update).mockResolvedValue(partido as any);
  vi.mocked(partidoRepository.delete).mockResolvedValue(partido as any);
  vi.mocked(prisma.divisionEquipo.count).mockResolvedValue(1);
  vi.mocked(prisma.partido.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(0);
  vi.mocked(prisma.$executeRaw).mockResolvedValue(1);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ set_config: 'public' }]);
  vi.mocked(prisma.equipo.findMany).mockResolvedValue([
    { userId: 'owner-1' },
    { userId: 'owner-2' },
  ] as any);
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
  vi.mocked(prisma.jornada.findUnique).mockResolvedValue({ numero: 1, divisionId: 'division-1' } as any);
  vi.mocked(prisma.jornada.findMany).mockResolvedValue([{ id: 'jornada-1', numero: 1, partidos: [
    { id: 'partido-1', estado: 'PROGRAMADO', fecha: context.fecha, fechaFin: context.fechaFin, equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
    { id: 'partido-2', estado: 'PROGRAMADO', fecha: new Date('2026-08-01T20:00:00Z'), fechaFin: new Date('2026-08-01T21:00:00Z'), equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
  ] }] as any);
  vi.mocked(prisma.partido.update).mockImplementation((async ({ where, data }: any) => ({ ...partido, id: where.id, ...data, arbitros: [] })) as any);
  vi.mocked(prisma.partido.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.partido.findUnique).mockResolvedValue({ ...partido, arbitros: [] } as any);
  vi.mocked(prisma.partido.findMany).mockResolvedValue([{
    id: 'partido-2',
    estado: 'PROGRAMADO',
    fecha: new Date('2026-08-01T20:00:00Z'),
    fechaFin: new Date('2026-08-01T21:00:00Z'),
    equipoLocalId: 'equipo-3',
    equipoVisitanteId: 'equipo-4',
  }] as any);
}
