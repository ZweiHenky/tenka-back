"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ findUnique: vitest_1.vi.fn() }));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: { partidoRefereeAccess: { findUnique: mocks.findUnique } },
}));
const repository_1 = require("./repository");
(0, vitest_1.describe)('refereeAccessRepository.findPartidoReadContextByTokenHash', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('loads the complete referee read context in one Prisma operation', async () => {
        mocks.findUnique.mockResolvedValue(null);
        await repository_1.refereeAccessRepository.findPartidoReadContextByTokenHash('token-hash');
        (0, vitest_1.expect)(mocks.findUnique).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findUnique).toHaveBeenCalledWith({
            where: { tokenHash: 'token-hash' },
            select: {
                expiresAt: true,
                usedAt: true,
                partido: {
                    select: {
                        id: true,
                        fecha: true,
                        estado: true,
                        golesLocal: true,
                        golesVisitante: true,
                        penalesLocal: true,
                        penalesVisitante: true,
                        tipoPartido: true,
                        equipoLocal: { select: { id: true, nombre: true, logo: true } },
                        equipoVisitante: { select: { id: true, nombre: true, logo: true } },
                        cancha: { select: { id: true, nombre: true } },
                        jornada: {
                            select: {
                                numero: true,
                                division: { select: { nombre: true, liga: { select: { nombre: true } } } },
                            },
                        },
                        rondaPlayoff: {
                            select: {
                                division: { select: { nombre: true, liga: { select: { nombre: true } } } },
                            },
                        },
                    },
                },
            },
        });
    });
});
//# sourceMappingURL=repository.test.js.map