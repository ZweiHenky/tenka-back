import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  divisionId,
  jornadaRepository,
  jornadaService,
  logger,
  mockDivision,
  mockJornadaCreated,
  mockNoPreviousJornadas,
  mockPartidosCreatedReturn,
  mockTeams,
  notificationService,
  partidoRepository,
  prisma,
  resetGenerateNextHarness,
} from './support/generateNextHarness';

beforeEach(resetGenerateNextHarness);

describe('generateNext observability', () => {
  it('logs one structured completion event without generation diagnostics', async () => {
    mockDivision();
    mockTeams(['t1', 't2']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(1);

    await jornadaService.generateNext(divisionId);

    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith({
      divisionId,
      jornadaId: 'j-new-1',
      counts: { created: 1, playoffUpdated: 0, total: 1 },
      durationMs: expect.any(Number),
    }, 'Jornada generation completed');
  });

  it('keeps the regular generation query budget constant and batches writes', async () => {
    mockDivision({ maxEquipos: 6 });
    mockTeams(['t1', 't2', 't3', 't4', 't5', 't6']);
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await jornadaService.generateNext(divisionId);

    expect(prisma.division.findUnique).toHaveBeenCalledOnce();
    expect(prisma.rondaPlayoff.findFirst).toHaveBeenCalledOnce();
    expect(jornadaRepository.findGenerationHistory).toHaveBeenCalledOnce();
    expect(prisma.divisionEquipo.findMany).toHaveBeenCalledOnce();
    expect(prisma.partido.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.partido.createMany).toHaveBeenCalledOnce();
    expect(partidoRepository.findById).not.toHaveBeenCalled();
    expect(partidoRepository.create).toHaveBeenCalledTimes(3);
  });

  it('handles detached notification rejection with a structured warning', async () => {
    const notificationError = new Error('push failed');
    (notificationService.notifyJornadaGenerated as ReturnType<typeof vi.fn>).mockRejectedValue(notificationError);
    mockDivision();
    mockTeams(['t1', 't2']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(1);

    await jornadaService.generateNext(divisionId);
    await Promise.resolve();

    expect(logger.warn).toHaveBeenCalledWith({
      event: 'notification.failed',
      provider: 'onesignal',
      divisionId,
      jornadaId: 'j-new-1',
    }, 'Jornada generation notification failed');
  });
});
