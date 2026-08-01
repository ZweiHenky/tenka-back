import { vi } from 'vitest';

export const databaseModuleMock = {
  prisma: {
    $transaction: vi.fn(),
    divisionEquipo: { count: vi.fn() },
    partido: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    jornada: { findUnique: vi.fn(), findMany: vi.fn() },
  },
};

export const repositoryModuleMock = {
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
  rondaPlayoffService: { advanceWinners: vi.fn() },
};
