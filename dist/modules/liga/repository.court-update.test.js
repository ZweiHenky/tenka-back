"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    transaction: vitest_1.vi.fn(),
    courtUpdate: vitest_1.vi.fn(),
    courtCreate: vitest_1.vi.fn(),
    refereeDeleteMany: vitest_1.vi.fn(),
    refereeCreateMany: vitest_1.vi.fn(),
    leagueUpdate: vitest_1.vi.fn(),
    divisionUpdateMany: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        $transaction: mocks.transaction,
    },
}));
const repository_1 = require("./repository");
(0, vitest_1.describe)('actualizacion atomica de canchas', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.transaction.mockImplementation(async (operation) => operation({
            ligaCancha: { update: mocks.courtUpdate, create: mocks.courtCreate },
            ligaArbitro: { deleteMany: mocks.refereeDeleteMany, createMany: mocks.refereeCreateMany },
            liga: { update: mocks.leagueUpdate },
            division: { updateMany: mocks.divisionUpdateMany },
        }));
        mocks.leagueUpdate.mockResolvedValue({ id: 'liga-1' });
    });
    (0, vitest_1.it)('limpia las canchas fijas dentro de la transacción al desactivar el modo múltiple', async () => {
        await repository_1.ligaRepository.update('liga-1', { multiplesCanchas: false }, undefined, undefined, true);
        (0, vitest_1.expect)(mocks.divisionUpdateMany).toHaveBeenCalledWith({
            where: { ligaId: 'liga-1' },
            data: { canchaUnicaId: null },
        });
        (0, vitest_1.expect)(mocks.leagueUpdate).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('actualiza ids estables, crea nuevas y cambia la liga dentro de una transaccion', async () => {
        await repository_1.ligaRepository.update('liga-1', { multiplesCanchas: true }, [
            {
                id: 'court-1',
                nombre: 'Central',
                nombreNormalizado: 'central',
                nombreNormalizadoAnterior: 'principal',
                activa: true,
            },
            { nombre: 'Norte', nombreNormalizado: 'norte', activa: true },
        ]);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.courtUpdate).toHaveBeenNthCalledWith(1, {
            where: { id: 'court-1' },
            data: { nombreNormalizado: '__liga_cancha_tmp_court-1' },
        });
        (0, vitest_1.expect)(mocks.courtUpdate).toHaveBeenNthCalledWith(2, {
            where: { id: 'court-1' },
            data: { nombre: 'Central', nombreNormalizado: 'central', activa: true },
        });
        (0, vitest_1.expect)(mocks.courtCreate).toHaveBeenCalledWith({
            data: { ligaId: 'liga-1', nombre: 'Norte', nombreNormalizado: 'norte', activa: true },
        });
        (0, vitest_1.expect)(mocks.leagueUpdate).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { id: 'liga-1' },
            data: { multiplesCanchas: true },
        }));
    });
});
//# sourceMappingURL=repository.court-update.test.js.map