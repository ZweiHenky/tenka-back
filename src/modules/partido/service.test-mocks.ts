import { vi } from 'vitest';

export const databaseModuleMock = {
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    divisionEquipo: { count: vi.fn() },
    equipo: { findMany: vi.fn() },
    partido: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    jornada: { findUnique: vi.fn(), findMany: vi.fn() },
  },
};

export const repositoryModuleMock = {
  PARTIDO_READ_INCLUDE: {},
  exposePartidoRead: (partido: any) => ({ ...partido, arbitros: partido.arbitros?.map((row: any) => row.arbitro) }),
  partidoRepository: {
    findAuthorizationContext: vi.fn(),
    findAllVisible: vi.fn(),
    findById: vi.fn(),
    findVisibleById: vi.fn(),
    findVisibleByJornada: vi.fn(),
    findVisibleByRondaPlayoff: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

export const tablaPosicionModuleMock = {
  tablaPosicionService: { recalcular: vi.fn() },
};

export const rondaPlayoffModuleMock = {
  rondaPlayoffService: { advanceWinners: vi.fn(), syncAdvancement: vi.fn() },
};
