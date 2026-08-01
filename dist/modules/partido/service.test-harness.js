"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partido = exports.context = exports.admin = exports.other = exports.owner = exports.prisma = exports.partidoService = exports.partidoRepository = exports.findDeterministicMatching = void 0;
exports.resetServiceTestHarness = resetServiceTestHarness;
const vitest_1 = require("vitest");
const database_1 = require("../../config/database");
Object.defineProperty(exports, "prisma", { enumerable: true, get: function () { return database_1.prisma; } });
const service_1 = require("./service");
Object.defineProperty(exports, "findDeterministicMatching", { enumerable: true, get: function () { return service_1.findDeterministicMatching; } });
Object.defineProperty(exports, "partidoService", { enumerable: true, get: function () { return service_1.partidoService; } });
const repository_1 = require("./repository");
Object.defineProperty(exports, "partidoRepository", { enumerable: true, get: function () { return repository_1.partidoRepository; } });
exports.owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
exports.other = { id: 'other-user', email: 'other@test.com', rol: 'LIGA' };
exports.admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
exports.context = {
    id: 'partido-1',
    ligaUserId: 'owner-1',
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
};
exports.partido = {
    ...exports.context,
    golesLocal: 0,
    golesVisitante: 0,
    penalesLocal: null,
    penalesVisitante: null,
};
function resetServiceTestHarness() {
    vitest_1.vi.clearAllMocks();
    vitest_1.vi.mocked(repository_1.partidoRepository.findAuthorizationContext).mockResolvedValue(exports.context);
    vitest_1.vi.mocked(repository_1.partidoRepository.findAllVisible).mockResolvedValue([exports.partido]);
    vitest_1.vi.mocked(repository_1.partidoRepository.findById).mockResolvedValue(exports.partido);
    vitest_1.vi.mocked(repository_1.partidoRepository.findVisibleById).mockResolvedValue(exports.partido);
    vitest_1.vi.mocked(repository_1.partidoRepository.findVisibleByJornada).mockResolvedValue([exports.partido]);
    vitest_1.vi.mocked(repository_1.partidoRepository.findVisibleByRondaPlayoff).mockResolvedValue([exports.partido]);
    vitest_1.vi.mocked(repository_1.partidoRepository.update).mockResolvedValue(exports.partido);
    vitest_1.vi.mocked(database_1.prisma.divisionEquipo.count).mockResolvedValue(1);
    vitest_1.vi.mocked(database_1.prisma.partido.findFirst).mockResolvedValue(null);
    vitest_1.vi.mocked(database_1.prisma.$transaction).mockImplementation(async (callback) => callback(database_1.prisma));
    vitest_1.vi.mocked(database_1.prisma.jornada.findUnique).mockResolvedValue({ numero: 1, divisionId: 'division-1' });
    vitest_1.vi.mocked(database_1.prisma.jornada.findMany).mockResolvedValue([{ id: 'jornada-1', numero: 1, partidos: [
                { id: 'partido-1', estado: 'PROGRAMADO', fecha: exports.context.fecha, equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                { id: 'partido-2', estado: 'PROGRAMADO', fecha: new Date('2026-08-01T20:00:00Z'), equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
            ] }]);
    vitest_1.vi.mocked(database_1.prisma.partido.update).mockImplementation((async ({ where, data }) => ({ ...exports.partido, id: where.id, ...data, arbitros: [] })));
    vitest_1.vi.mocked(database_1.prisma.partido.findMany).mockResolvedValue([{
            id: 'partido-2',
            estado: 'PROGRAMADO',
            fecha: new Date('2026-08-01T20:00:00Z'),
            fechaFin: new Date('2026-08-01T21:00:00Z'),
            equipoLocalId: 'equipo-3',
            equipoVisitanteId: 'equipo-4',
        }]);
}
//# sourceMappingURL=service.test-harness.js.map