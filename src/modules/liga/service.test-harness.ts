import { vi } from 'vitest';
import type { AuthenticatedUser } from '../../types/auth';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findVisibleById: vi.fn(),
  findUpdateContext: vi.fn(),
  findDeleteContext: vi.fn(),
  findManagementContext: vi.fn(),
  findManageableCanchas: vi.fn(),
  findManageableArbitros: vi.fn(),
  findRecentSchedule: vi.fn(),
  findByNormalizedName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  arbitroFindFirst: vi.fn(),
  arbitroFindUnique: vi.fn(),
  arbitroCount: vi.fn(),
  arbitroCreate: vi.fn(),
  arbitroUpdate: vi.fn(),
  arbitroDelete: vi.fn(),
  canchaFindUnique: vi.fn(),
  canchaFindFirst: vi.fn(),
  canchaCreate: vi.fn(),
  canchaCount: vi.fn(),
  canchaUpdate: vi.fn(),
  canchaDelete: vi.fn(),
  partidoCount: vi.fn(),
  divisionCount: vi.fn(),
  partidoArbitroCount: vi.fn(),
  ubicacionFindUnique: vi.fn(),
  executeRawUnsafe: vi.fn(),
  divisionCanchaHorarioCount: vi.fn(),
  divisionCanchaHorarioDeleteMany: vi.fn(),
}));

vi.mock('./repository', () => ({
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

vi.mock('../../config/database', () => ({
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
    divisionCanchaHorario: {
      count: mocks.divisionCanchaHorarioCount,
      deleteMany: mocks.divisionCanchaHorarioDeleteMany,
    },
    partidoArbitro: {
      count: mocks.partidoArbitroCount,
    },
    ubicacion: {
      findUnique: mocks.ubicacionFindUnique,
    },
  },
}));

vi.mock('../media/service', () => ({
  mediaService: { scheduleImageCleanup: vi.fn() },
}));

export const owner: AuthenticatedUser = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' };
export const foreignUser: AuthenticatedUser = { id: 'user-2', email: 'foreign@test.com', rol: 'LIGA' };
export const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

export const existingLiga = {
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

export function resetServiceMocks() {
  vi.clearAllMocks();
  mocks.ubicacionFindUnique.mockResolvedValue({ timeZone: 'America/Mexico_City' });
  mocks.divisionCanchaHorarioCount.mockResolvedValue(0);
  mocks.divisionCanchaHorarioDeleteMany.mockResolvedValue({ count: 0 });
}

export function getServiceMocks() {
  return mocks;
}

export async function loadLigaService() {
  return (await import('./service')).ligaService;
}
