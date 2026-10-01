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
  observeResourceAccess,
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

    expect(prisma.division.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.rondaPlayoff.findFirst).toHaveBeenCalledOnce();
    expect(jornadaRepository.findGenerationHistory).toHaveBeenCalledTimes(2);
    expect(prisma.divisionEquipo.findMany).toHaveBeenCalledOnce();
    expect(prisma.partido.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', 'liga-1');
    expect(observeResourceAccess).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      operation: 'jornada.generate',
      divisionId,
    }));
    expect(vi.mocked(observeResourceAccess).mock.invocationCallOrder[0])
      .toBeLessThan((prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    expect(prisma.partido.createMany).toHaveBeenCalledOnce();
    expect(partidoRepository.findById).not.toHaveBeenCalled();
    expect(partidoRepository.create).toHaveBeenCalledTimes(3);
  });

  it('creates both notification audiences in the jornada transaction', async () => {
    mockDivision();
    mockTeams(['t1', 't2']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(1);

    await jornadaService.generateNext(divisionId);
    expect(prisma.notificationOutbox.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ eventKey: 'jornada-generated:j-new-1:registered', audience: 'REGISTERED', jornadaId: 'j-new-1', divisionId }),
        expect.objectContaining({ eventKey: 'jornada-generated:j-new-1:followers', audience: 'FOLLOWERS', jornadaId: 'j-new-1', divisionId }),
      ],
      skipDuplicates: true,
    });
  });
});
