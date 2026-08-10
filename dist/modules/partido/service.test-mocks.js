"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rondaPlayoffModuleMock = exports.tablaPosicionModuleMock = exports.repositoryModuleMock = exports.databaseModuleMock = void 0;
const vitest_1 = require("vitest");
exports.databaseModuleMock = {
    prisma: {
        $transaction: vitest_1.vi.fn(),
        $executeRaw: vitest_1.vi.fn(),
        $queryRaw: vitest_1.vi.fn(),
        $executeRawUnsafe: vitest_1.vi.fn(),
        divisionEquipo: { count: vitest_1.vi.fn() },
        equipo: { findMany: vitest_1.vi.fn() },
        partido: { findFirst: vitest_1.vi.fn(), findMany: vitest_1.vi.fn(), findUnique: vitest_1.vi.fn(), update: vitest_1.vi.fn(), updateMany: vitest_1.vi.fn() },
        jornada: { findUnique: vitest_1.vi.fn(), findMany: vitest_1.vi.fn() },
    },
};
exports.repositoryModuleMock = {
    PARTIDO_READ_INCLUDE: {},
    exposePartidoRead: (partido) => ({ ...partido, arbitros: partido.arbitros?.map((row) => row.arbitro) }),
    partidoRepository: {
        findAuthorizationContext: vitest_1.vi.fn(),
        findAllVisible: vitest_1.vi.fn(),
        findById: vitest_1.vi.fn(),
        findVisibleById: vitest_1.vi.fn(),
        findVisibleByJornada: vitest_1.vi.fn(),
        findVisibleByRondaPlayoff: vitest_1.vi.fn(),
        update: vitest_1.vi.fn(),
        delete: vitest_1.vi.fn(),
    },
};
exports.tablaPosicionModuleMock = {
    tablaPosicionService: { recalcular: vitest_1.vi.fn() },
};
exports.rondaPlayoffModuleMock = {
    rondaPlayoffService: { advanceWinners: vitest_1.vi.fn(), syncAdvancement: vitest_1.vi.fn() },
};
//# sourceMappingURL=service.test-mocks.js.map