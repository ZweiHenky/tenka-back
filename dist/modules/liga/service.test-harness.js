"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.existingLiga = exports.admin = exports.foreignUser = exports.owner = void 0;
exports.resetServiceMocks = resetServiceMocks;
exports.getServiceMocks = getServiceMocks;
exports.loadLigaService = loadLigaService;
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    findById: vitest_1.vi.fn(),
    findVisibleById: vitest_1.vi.fn(),
    findUpdateContext: vitest_1.vi.fn(),
    findDeleteContext: vitest_1.vi.fn(),
    findManagementContext: vitest_1.vi.fn(),
    findManageableCanchas: vitest_1.vi.fn(),
    findManageableArbitros: vitest_1.vi.fn(),
    findRecentSchedule: vitest_1.vi.fn(),
    findByNormalizedName: vitest_1.vi.fn(),
    create: vitest_1.vi.fn(),
    update: vitest_1.vi.fn(),
    delete: vitest_1.vi.fn(),
    arbitroFindFirst: vitest_1.vi.fn(),
    arbitroFindUnique: vitest_1.vi.fn(),
    arbitroCount: vitest_1.vi.fn(),
    arbitroCreate: vitest_1.vi.fn(),
    arbitroUpdate: vitest_1.vi.fn(),
    arbitroDelete: vitest_1.vi.fn(),
    canchaFindUnique: vitest_1.vi.fn(),
    canchaFindFirst: vitest_1.vi.fn(),
    canchaCreate: vitest_1.vi.fn(),
    canchaCount: vitest_1.vi.fn(),
    canchaUpdate: vitest_1.vi.fn(),
    canchaDelete: vitest_1.vi.fn(),
    partidoCount: vitest_1.vi.fn(),
    divisionCount: vitest_1.vi.fn(),
    partidoArbitroCount: vitest_1.vi.fn(),
    ubicacionFindUnique: vitest_1.vi.fn(),
    executeRawUnsafe: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('./repository', () => ({
    ligaRepository: {
        findById: mocks.findById,
        findVisibleById: mocks.findVisibleById,
        findUpdateContext: mocks.findUpdateContext,
        findDeleteContext: mocks.findDeleteContext,
        findManagementContext: mocks.findManagementContext,
        findManageableCanchas: mocks.findManageableCanchas,
        findManageableArbitros: mocks.findManageableArbitros,
        findRecentSchedule: mocks.findRecentSchedule,
        findByNormalizedName: mocks.findByNormalizedName,
        create: mocks.create,
        update: mocks.update,
        delete: mocks.delete,
    },
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        // acquireLeagueScheduleLock runs against whatever client runInTransaction hands it; with no
        // $transaction on the mock that is this object, so it needs the raw-exec entry point.
        $executeRawUnsafe: mocks.executeRawUnsafe,
        ligaArbitro: {
            findFirst: mocks.arbitroFindFirst,
            findUnique: mocks.arbitroFindUnique,
            count: mocks.arbitroCount,
            create: mocks.arbitroCreate,
            update: mocks.arbitroUpdate,
            delete: mocks.arbitroDelete,
        },
        ligaCancha: {
            findUnique: mocks.canchaFindUnique,
            findFirst: mocks.canchaFindFirst,
            create: mocks.canchaCreate,
            count: mocks.canchaCount,
            update: mocks.canchaUpdate,
            delete: mocks.canchaDelete,
        },
        partido: {
            count: mocks.partidoCount,
        },
        division: {
            count: mocks.divisionCount,
        },
        partidoArbitro: {
            count: mocks.partidoArbitroCount,
        },
        ubicacion: {
            findUnique: mocks.ubicacionFindUnique,
        },
    },
}));
vitest_1.vi.mock('../media/service', () => ({
    mediaService: { scheduleImageCleanup: vitest_1.vi.fn() },
}));
exports.owner = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' };
exports.foreignUser = { id: 'user-2', email: 'foreign@test.com', rol: 'LIGA' };
exports.admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
exports.existingLiga = {
    id: 'liga-1',
    nombre: 'Liga Centro',
    nombreNormalizado: 'liga centro',
    descripcion: '',
    logo: null,
    logoPublicId: null,
    cancha: null,
    canchaPublicId: null,
    multiplesCanchas: false,
    usaArbitros: false,
    canchas: [],
    arbitros: [],
    userId: 'user-1',
    ubicacionId: 'ubicacion-1',
};
function resetServiceMocks() {
    vitest_1.vi.clearAllMocks();
    mocks.ubicacionFindUnique.mockResolvedValue({ timeZone: 'America/Mexico_City' });
}
function getServiceMocks() {
    return mocks;
}
async function loadLigaService() {
    return (await Promise.resolve().then(() => __importStar(require('./service')))).ligaService;
}
//# sourceMappingURL=service.test-harness.js.map