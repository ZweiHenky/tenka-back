"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = __importDefault(require("node:crypto"));
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    findReadContext: vitest_1.vi.fn(),
    findByTokenHash: vitest_1.vi.fn(),
    partidoFindById: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({ prisma: {} }));
vitest_1.vi.mock('./repository', () => ({
    refereeAccessRepository: {
        findPartidoReadContextByTokenHash: mocks.findReadContext,
        findByTokenHash: mocks.findByTokenHash,
    },
}));
vitest_1.vi.mock('../partido/repository', () => ({
    partidoRepository: { findById: mocks.partidoFindById },
}));
vitest_1.vi.mock('../tabla-posicion/service', () => ({ tablaPosicionService: {} }));
vitest_1.vi.mock('../ronda-playoff/service', () => ({ rondaPlayoffService: {} }));
const service_1 = require("./service");
const token = 'a'.repeat(43);
const fecha = new Date('2026-08-01T18:00:00.000Z');
const activeUntil = new Date(Date.now() + 60000);
const basePartido = {
    id: 'partido-1',
    fecha,
    estado: 'PROGRAMADO',
    golesLocal: 1,
    golesVisitante: 0,
    penalesLocal: null,
    penalesVisitante: null,
    tipoPartido: 'REGULAR',
    equipoLocal: { id: 'local-1', nombre: 'Locales', logo: 'local.png' },
    equipoVisitante: { id: 'visitante-1', nombre: 'Visitantes', logo: null },
    cancha: { id: 'cancha-1', nombre: 'Cancha Central' },
    jornada: null,
    rondaPlayoff: null,
};
(0, vitest_1.describe)('refereeAccessService.getPartidoByToken', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.findReadContext.mockResolvedValue({ expiresAt: activeUntil, usedAt: null, partido: basePartido });
    });
    (0, vitest_1.it)('preserves aliases and jornada context using one repository operation', async () => {
        mocks.findReadContext.mockResolvedValue({
            expiresAt: activeUntil,
            usedAt: null,
            partido: {
                ...basePartido,
                jornada: { numero: 4, division: { nombre: 'Primera', liga: { nombre: 'Liga Uno' } } },
            },
        });
        await (0, vitest_1.expect)(service_1.refereeAccessService.getPartidoByToken(`Bearer ${token}`)).resolves.toEqual({
            id: 'partido-1',
            fecha,
            horaInicio: fecha,
            equipoLocal: basePartido.equipoLocal,
            equipoVisitante: basePartido.equipoVisitante,
            cancha: basePartido.cancha,
            estado: 'PROGRAMADO',
            golesLocal: 1,
            golesVisitante: 0,
            penalesLocal: null,
            penalesVisitante: null,
            tipoPartido: 'REGULAR',
            jornadaNumero: 4,
            divisionNombre: 'Primera',
            ligaNombre: 'Liga Uno',
        });
        (0, vitest_1.expect)(mocks.findReadContext).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.findReadContext).toHaveBeenCalledWith(node_crypto_1.default.createHash('sha256').update(token).digest('hex'));
        (0, vitest_1.expect)(mocks.findByTokenHash).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.partidoFindById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('preserves playoff context and empty competition fallbacks', async () => {
        mocks.findReadContext
            .mockResolvedValueOnce({
            expiresAt: activeUntil,
            usedAt: null,
            partido: {
                ...basePartido,
                tipoPartido: 'ELIMINATORIA',
                rondaPlayoff: { division: { nombre: 'Copa', liga: { nombre: 'Liga Dos' } } },
            },
        })
            .mockResolvedValueOnce({ expiresAt: activeUntil, usedAt: null, partido: basePartido });
        await (0, vitest_1.expect)(service_1.refereeAccessService.getPartidoByToken(`Bearer ${token}`)).resolves.toMatchObject({
            jornadaNumero: null,
            divisionNombre: 'Copa',
            ligaNombre: 'Liga Dos',
        });
        await (0, vitest_1.expect)(service_1.refereeAccessService.getPartidoByToken(`Bearer ${token}`)).resolves.toMatchObject({
            jornadaNumero: null,
            divisionNombre: '',
            ligaNombre: '',
        });
        (0, vitest_1.expect)(mocks.findReadContext).toHaveBeenCalledTimes(2);
    });
    vitest_1.it.each([
        ['missing', null],
        ['used', { expiresAt: activeUntil, usedAt: new Date(), partido: basePartido }],
        ['expired', { expiresAt: new Date(0), usedAt: null, partido: basePartido }],
    ])('keeps the generic 422 error for %s access', async (_case, access) => {
        mocks.findReadContext.mockResolvedValue(access);
        await (0, vitest_1.expect)(service_1.refereeAccessService.getPartidoByToken(`Bearer ${token}`)).rejects.toMatchObject({
            statusCode: 422,
            message: 'Enlace no válido o expirado',
        });
    });
    vitest_1.it.each([undefined, 'Basic value', 'Bearer short'])('keeps malformed authorization errors generic', async (header) => {
        await (0, vitest_1.expect)(service_1.refereeAccessService.getPartidoByToken(header)).rejects.toMatchObject({
            statusCode: 422,
            message: 'Token de acceso no válido',
        });
        (0, vitest_1.expect)(mocks.findReadContext).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('preserves the partido 404 for an absent joined partido', async () => {
        mocks.findReadContext.mockResolvedValue({ expiresAt: activeUntil, usedAt: null, partido: null });
        await (0, vitest_1.expect)(service_1.refereeAccessService.getPartidoByToken(`Bearer ${token}`)).rejects.toMatchObject({
            statusCode: 404,
            message: 'Partido no encontrado',
        });
    });
});
//# sourceMappingURL=service.test.js.map