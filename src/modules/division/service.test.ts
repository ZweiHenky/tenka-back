import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ligaFindFirst: vi.fn(),
  ligaCanchaFindFirst: vi.fn(),
  divisionFindFirst: vi.fn(),
  estadoLigaFindFirstOrThrow: vi.fn(),
  transaction: vi.fn(),
  subscriptionsFindMany: vi.fn(),
  cleanupUpsert: vi.fn(),
  jornadaDeleteMany: vi.fn(),
  rondaPlayoffDeleteMany: vi.fn(),
  tablaPosicionDeleteMany: vi.fn(),
  campeonUpdateMany: vi.fn(),
  estadoLigaFindFirst: vi.fn(),
  divisionUpdate: vi.fn(),
  partidoCount: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  acquireLeagueScheduleLock: vi.fn(),
  ligaFindUnique: vi.fn(),
  ligaCanchaFindMany: vi.fn(),
  divisionCreate: vi.fn(),
  courtScheduleDeleteMany: vi.fn(),
  courtScheduleUpsert: vi.fn(),
  estadoLigaFindUnique: vi.fn(),
  acquireAccountQuotaLock: vi.fn(),
  assertAccountQuotaDelta: vi.fn(),
  assertMigrationAllowsResourceCreation: vi.fn(),
  ensureInitialFreeManagementGrant: vi.fn(),
  closeFreeManagementGrantForDeletedResource: vi.fn(),
  resolveAccountAccessPolicy: vi.fn(),
  observeResourceAccessShadowInTransaction: vi.fn(),
  assignDivisionCapacityInTransaction: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    $transaction: mocks.transaction,
    liga: { findFirst: mocks.ligaFindFirst },
    ligaCancha: { findFirst: mocks.ligaCanchaFindFirst },
    division: { findFirst: mocks.divisionFindFirst },
    estadoLiga: { findFirstOrThrow: mocks.estadoLigaFindFirstOrThrow },
    partido: { count: mocks.partidoCount },
  },
}));

vi.mock('./repository', () => ({
  divisionRepository: {
    create: mocks.create,
    update: mocks.update,
    delete: mocks.delete,
  },
}));

vi.mock('../../utils/leagueScheduleLock', () => ({
  acquireLeagueScheduleLock: mocks.acquireLeagueScheduleLock,
}));

vi.mock('../../utils/accountQuota', () => ({
  acquireAccountQuotaLock: mocks.acquireAccountQuotaLock,
  assertAccountQuotaDelta: mocks.assertAccountQuotaDelta,
  isActiveDivisionCode: (code: string) => code === 'ABIERTA' || code === 'EN_CURSO',
}));

vi.mock('../billing/service', () => ({
  assertMigrationAllowsResourceCreation: mocks.assertMigrationAllowsResourceCreation,
  ensureInitialFreeManagementGrant: mocks.ensureInitialFreeManagementGrant,
  closeFreeManagementGrantForDeletedResource: mocks.closeFreeManagementGrantForDeletedResource,
  resolveAccountAccessPolicy: mocks.resolveAccountAccessPolicy,
}));

vi.mock('../billing/resourceAccessShadow', () => ({
  observeResourceAccessShadowInTransaction: mocks.observeResourceAccessShadowInTransaction,
}));

vi.mock('../billing/capacityAssignment', () => ({
  assignDivisionCapacityInTransaction: mocks.assignDivisionCapacityInTransaction,
}));

import { divisionService } from './service';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

const createData = {
  nombre: 'Primera',
  maxEquipos: 12,
  ligaId: 'liga-1',
  categoriaId: 'categoria-1',
  tipoId: 'tipo-1',
  tipoCompetenciaId: 'competencia-1',
};

const tx = {
  liga: { findFirst: mocks.ligaFindFirst, findUnique: mocks.ligaFindUnique },
  ligaCancha: { findFirst: mocks.ligaCanchaFindFirst, findMany: mocks.ligaCanchaFindMany },
  division: { findFirst: mocks.divisionFindFirst, create: mocks.divisionCreate, update: mocks.divisionUpdate },
  divisionCanchaHorario: { deleteMany: mocks.courtScheduleDeleteMany, upsert: mocks.courtScheduleUpsert },
  divisionNotificationSubscription: { findMany: mocks.subscriptionsFindMany },
  oneSignalTagCleanupJob: { upsert: mocks.cleanupUpsert },
  jornada: { deleteMany: mocks.jornadaDeleteMany },
  rondaPlayoff: { deleteMany: mocks.rondaPlayoffDeleteMany },
  tablaPosicion: { deleteMany: mocks.tablaPosicionDeleteMany },
  divisionCampeon: { updateMany: mocks.campeonUpdateMany },
  estadoLiga: { findFirst: mocks.estadoLigaFindFirst, findUnique: mocks.estadoLigaFindUnique },
  partido: { count: mocks.partidoCount },
};

const divisionContext = (overrides: Record<string, unknown> = {}) => ({
  id: 'division-1',
  nombre: 'Primera',
  ligaId: 'liga-1',
  liga: { userId: owner.id },
  estadoLiga: { codigo: 'BORRADOR' },
  registrarParticipaciones: false,
  usarPenalesEnEmpates: true,
  ...overrides,
});

describe('consultas privadas optimizadas de división', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1', userId: owner.id });
    mocks.divisionFindFirst.mockResolvedValue(divisionContext());
    mocks.partidoCount.mockResolvedValue(0);
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.subscriptionsFindMany.mockResolvedValue([]);
    mocks.create.mockResolvedValue({ id: 'division-1' });
    mocks.update.mockResolvedValue({ id: 'division-1' });
    mocks.ligaFindUnique.mockResolvedValue({ multiplesCanchas: true });
    mocks.ligaCanchaFindMany.mockResolvedValue([
      { id: 'court-1', activa: true },
      { id: 'court-2', activa: true },
    ]);
    mocks.divisionCreate.mockResolvedValue({ id: 'division-1' });
    mocks.estadoLigaFindUnique.mockResolvedValue({ id: 'estado-1', codigo: 'BORRADOR' });
    mocks.estadoLigaFindFirst.mockResolvedValue({ id: 'borrador-1', codigo: 'BORRADOR' });
    mocks.resolveAccountAccessPolicy.mockResolvedValue({ effectiveAccess: 'FREE' });
  });

  describe('horarios por cancha', () => {
    const horariosPorCancha = [
      { canchaId: 'court-1', diasPartido: 'lun', horarioPartido: '18:00 - 20:00' },
      { canchaId: 'court-2', diasPartido: 'jue', horarioPartido: '20:00 - 22:00' },
    ];

    it('crea las filas y deriva el resumen bajo el lock de liga', async () => {
      await divisionService.create({ ...createData, estadoLigaId: 'estado-1', horariosPorCancha }, owner);

      expect(mocks.acquireAccountQuotaLock).toHaveBeenCalledWith(tx, owner.id);
      expect(mocks.assertAccountQuotaDelta).toHaveBeenCalledWith(tx, owner.id, { divisions: 1, activeDivisions: 0 });
      expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
      expect(mocks.ligaFindFirst.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.observeResourceAccessShadowInTransaction.mock.invocationCallOrder[0]);
      expect(mocks.acquireAccountQuotaLock.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.observeResourceAccessShadowInTransaction.mock.invocationCallOrder[0]);
      expect(mocks.observeResourceAccessShadowInTransaction.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0]);
      expect(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
      const payload = mocks.divisionUpdate.mock.calls[0][0].data;
      // Summary is the union of both courts, for the public listing and older clients.
      expect(payload.diasPartido).toBe('lun, jue');
      expect(payload.horarioPartido).toBe('18:00 - 22:00');
      expect(mocks.courtScheduleUpsert).toHaveBeenCalledTimes(2);
    });

    it('devuelve la división con sus horarios por cancha', async () => {
      // El cliente guarda esta respuesta en caché. Sin la relación, la división parecería no
      // tener configuración por cancha y la app mostraría todas las canchas de la liga.
      await divisionService.create({ ...createData, estadoLigaId: 'estado-1', horariosPorCancha }, owner);

      expect(mocks.divisionUpdate.mock.calls[0][0].include).toEqual({
        canchaHorarios: { select: { canchaId: true, diasPartido: true, horarioPartido: true } },
      });
    });

    it('mantiene la creación transaccional sin tomar el lock de horarios cuando no trae filas', async () => {
      await divisionService.create({ ...createData, estadoLigaId: 'estado-1' }, owner);

      expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable', timeout: 30_000,
      });
      expect(mocks.acquireLeagueScheduleLock).not.toHaveBeenCalled();
      expect(mocks.create).toHaveBeenCalledWith({ ...createData, estadoLigaId: 'estado-1' }, tx);
    });

    it('al actualizar reemplaza las filas y reescribe el resumen', async () => {
      await divisionService.update('division-1', { horariosPorCancha }, owner);

      expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
      expect(mocks.courtScheduleDeleteMany).toHaveBeenCalledWith({
        where: { divisionId: 'division-1', canchaId: { notIn: ['court-1', 'court-2'] } },
      });
      expect(mocks.courtScheduleUpsert).toHaveBeenCalledTimes(2);
      expect(mocks.update).toHaveBeenCalledWith('division-1', expect.objectContaining({
        diasPartido: 'lun, jue',
        horarioPartido: '18:00 - 22:00',
      }), tx);
    });

    it('un arreglo vacío borra las filas y conserva los escalares', async () => {
      await divisionService.update('division-1', { horariosPorCancha: [] }, owner);

      expect(mocks.courtScheduleDeleteMany).toHaveBeenCalledWith({
        where: { divisionId: 'division-1', canchaId: { notIn: [] } },
      });
      expect(mocks.courtScheduleUpsert).not.toHaveBeenCalled();
      const written = mocks.update.mock.calls[0][1];
      expect(written).not.toHaveProperty('diasPartido');
    });

    it('rechaza filas en una liga de cancha única', async () => {
      mocks.ligaFindUnique.mockResolvedValue({ multiplesCanchas: false });

      await expect(divisionService.update('division-1', { horariosPorCancha }, owner))
        .rejects.toThrow('no tiene múltiples canchas');
    });

    it('rechaza una cancha de otra liga', async () => {
      mocks.ligaCanchaFindMany.mockResolvedValue([{ id: 'court-1', activa: true }]);

      await expect(divisionService.update('division-1', { horariosPorCancha }, owner))
        .rejects.toThrow('no pertenece a esta liga');
    });

    it('rechaza una cancha inactiva', async () => {
      mocks.ligaCanchaFindMany.mockResolvedValue([
        { id: 'court-1', activa: true },
        { id: 'court-2', activa: false },
      ]);

      await expect(divisionService.update('division-1', { horariosPorCancha }, owner))
        .rejects.toThrow('no está activa');
    });
  });

  it.each([
    ['propietario', owner, { id: 'liga-1', userId: owner.id }],
    ['administrador', admin, { id: 'liga-1' }],
  ])('autoriza la liga con una proyección mínima para %s', async (_label, actor, where) => {
    await divisionService.create({ ...createData, estadoLigaId: 'estado-1' }, actor);

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.ligaFindFirst).toHaveBeenCalledWith({ where, select: { id: true, userId: true } });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('resuelve la configuración Borrador por código, no por nombre', async () => {
    await divisionService.create(createData, owner);

    expect(mocks.estadoLigaFindFirst).toHaveBeenCalledWith({
      where: { codigo: 'BORRADOR' },
      select: { id: true, codigo: true },
    });
    expect(mocks.create).toHaveBeenCalledWith({ ...createData, estadoLigaId: 'borrador-1' }, tx);
  });

  it.each([
    ['propietario', owner, { id: 'division-1', liga: { userId: owner.id } }],
    ['administrador', admin, { id: 'division-1' }],
  ])('autoriza una actualización en una consulta estrecha para %s', async (_label, actor, where) => {
    await divisionService.update('division-1', { nombre: 'Nueva' }, actor);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where,
      select: {
        id: true, ligaId: true,
        liga: { select: { userId: true } },
        estadoLiga: { select: { codigo: true } },
        registrarParticipaciones: true, usarPenalesEnEmpates: true,
      },
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('siempre bloquea la liga y relee la división cuando se envía registrarParticipaciones', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext());

    await divisionService.update('division-1', { registrarParticipaciones: true }, owner);

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
    expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledTimes(1);
    expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.divisionFindFirst.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.observeResourceAccessShadowInTransaction.mock.invocationCallOrder[0]);
    expect(mocks.acquireAccountQuotaLock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.observeResourceAccessShadowInTransaction.mock.invocationCallOrder[0]);
    expect(mocks.observeResourceAccessShadowInTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0]);
    expect(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.divisionFindFirst.mock.invocationCallOrder[1]);
    expect(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
    expect(mocks.update).toHaveBeenCalledWith('division-1', { registrarParticipaciones: true }, tx);
  });

  it('también bloquea cuando el valor preflight de registrarParticipaciones parece idéntico', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext({ registrarParticipaciones: true }));

    await divisionService.update('division-1', { registrarParticipaciones: true }, owner);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
    expect(mocks.update).toHaveBeenCalledWith('division-1', { registrarParticipaciones: true }, tx);
  });

  it('checks only an inactive-to-active state transition', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext());
    mocks.estadoLigaFindUnique.mockResolvedValue({ codigo: 'ABIERTA' });

    await divisionService.update('division-1', { estadoLigaId: 'abierta-1' }, owner);

    expect(mocks.assertAccountQuotaDelta).toHaveBeenCalledWith(tx, owner.id, { activeDivisions: 1 });
    expect(mocks.update).toHaveBeenCalledWith('division-1', { estadoLigaId: 'abierta-1' }, tx);
  });

  it('allows active-to-active transitions without a positive quota check', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext({ estadoLiga: { codigo: 'ABIERTA' } }));
    mocks.estadoLigaFindUnique.mockResolvedValue({ codigo: 'EN_CURSO' });

    await divisionService.update('division-1', { estadoLigaId: 'en-curso-1' }, owner);

    expect(mocks.assertAccountQuotaDelta).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalled();
  });

  it('rejects moving a division to a league owned by another account', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext());
    mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-2', userId: 'other-owner' });

    await expect(divisionService.update('division-1', { ligaId: 'liga-2' }, admin))
      .rejects.toThrow('mismo propietario');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  // El lock existe para lo que cambia lo que valida la generación de jornadas: horarios,
  // participaciones y penales. La tabla de goleo no toca la programación.
  it('no bloquea la liga por cambiar solo la tabla de goleo', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext());

    await divisionService.update('division-1', { registrarGoleo: false }, owner);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.acquireLeagueScheduleLock).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith('division-1', { registrarGoleo: false }, tx);
  });

  it('permite cambiar la regla de penales antes de finalizar partidos', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext());

    await divisionService.update('division-1', { usarPenalesEnEmpates: false }, owner);

    expect(mocks.partidoCount).toHaveBeenCalledWith({
      where: {
        estado: 'FINALIZADO',
        OR: [{ jornada: { divisionId: 'division-1' } }, { rondaPlayoff: { divisionId: 'division-1' } }],
      },
    });
    expect(mocks.update).toHaveBeenCalledWith('division-1', { usarPenalesEnEmpates: false }, tx);
  });

  it('bloquea cambiar la regla de penales después de finalizar un partido', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext());
    mocks.partidoCount.mockResolvedValue(1);

    await expect(divisionService.update('division-1', { usarPenalesEnEmpates: false }, owner))
      .rejects.toThrow('ya tiene partidos finalizados');

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('reautoriza después del lock y no escribe si cambió el propietario', async () => {
    mocks.divisionFindFirst
      .mockResolvedValueOnce(divisionContext())
      .mockResolvedValueOnce(null);

    await expect(divisionService.update('division-1', { registrarParticipaciones: true }, owner))
      .rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
    expect(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.divisionFindFirst.mock.invocationCallOrder[1]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('bloquea origen y destino y rechaza una liga actual obsoleta antes de mover la división', async () => {
    mocks.divisionFindFirst
      .mockResolvedValueOnce(divisionContext())
      .mockResolvedValueOnce(divisionContext({ ligaId: 'liga-3' }));

    await expect(divisionService.update('division-1', { ligaId: 'liga-2', registrarParticipaciones: true }, owner))
      .rejects.toMatchObject({ statusCode: 409 });

    expect(mocks.acquireLeagueScheduleLock.mock.calls).toEqual([[tx, 'liga-1'], [tx, 'liga-2']]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('conserva el 404 y evita escrituras cuando la división no es administrable', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);

    await expect(divisionService.update('division-1', { nombre: 'Nueva' }, owner)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Division no encontrado',
    });
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('ejecuta las cuatro limpiezas del reset en una transacción después de una sola autorización', async () => {
    await divisionService.resetDivision('division-1', owner);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', liga: { userId: owner.id } },
      select: { id: true, ligaId: true, liga: { select: { userId: true } }, estadoLiga: { select: { codigo: true } } },
    });
    expect(mocks.jornadaDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.jornadaDeleteMany).toHaveBeenCalledWith({ where: { divisionId: 'division-1' } });
    expect(mocks.rondaPlayoffDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.tablaPosicionDeleteMany).toHaveBeenCalledOnce();
    // Se archiva, no se borra: reiniciar es la forma normal de arrancar la temporada siguiente.
    expect(mocks.campeonUpdateMany).toHaveBeenCalledWith({
      where: { divisionId: 'division-1', archivadoEn: null },
      data: { archivadoEn: expect.any(Date) },
    });
  });

  it('propaga un fallo del reset y no ejecuta escrituras posteriores fuera de la transacción', async () => {
    const failure = new Error('playoff cleanup failed');
    mocks.rondaPlayoffDeleteMany.mockRejectedValue(failure);

    await expect(divisionService.resetDivision('division-1', owner)).rejects.toBe(failure);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.jornadaDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.rondaPlayoffDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.tablaPosicionDeleteMany).not.toHaveBeenCalled();
  });

  it('no abre una transacción de reset si falla la autorización', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);

    await expect(divisionService.resetDivision('division-1', owner)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Division no encontrado',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('crea los jobs de OneSignal en lote y elimina la división en la misma transacción', async () => {
    mocks.subscriptionsFindMany.mockResolvedValue([
      { oneSignalId: 'onesignal-1' },
      { oneSignalId: 'onesignal-2' },
    ]);

    await divisionService.delete('division-1', owner);

    expect(mocks.divisionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.subscriptionsFindMany).toHaveBeenCalledWith({
      where: { divisionId: 'division-1' },
      select: { oneSignalId: true },
    });
    expect(mocks.cleanupUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.cleanupUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { oneSignalId_tag: { oneSignalId: 'onesignal-1', tag: 'division_division-1' } },
      create: { oneSignalId: 'onesignal-1', tag: 'division_division-1', desired: false },
    }));
    expect(mocks.delete).toHaveBeenCalledWith('division-1', tx);
  });

  it('no elimina la división cuando falla la creación del lote de cleanup', async () => {
    mocks.subscriptionsFindMany.mockResolvedValue([{ oneSignalId: 'onesignal-1' }]);
    const failure = new Error('cleanup queue failed');
    mocks.cleanupUpsert.mockRejectedValue(failure);

    await expect(divisionService.delete('division-1', owner)).rejects.toBe(failure);

    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('omite createMany si no hay suscriptores y conserva el presupuesto de consultas', async () => {
    await divisionService.delete('division-1', owner);

    expect(mocks.divisionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.subscriptionsFindMany).toHaveBeenCalledOnce();
    expect(mocks.cleanupUpsert).not.toHaveBeenCalled();
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('no abre una transacción de eliminación si falla la autorización', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);

    await expect(divisionService.delete('division-1', owner)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Division no encontrado',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.subscriptionsFindMany).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});

describe('segunda condicion de eliminacion de division', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.divisionFindFirst.mockResolvedValue(divisionContext());
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.subscriptionsFindMany.mockResolvedValue([]);
  });

  it('permite eliminar cuando el nombre escrito coincide (ignorando mayusculas)', async () => {
    await expect(divisionService.delete('division-1', owner, 'primera')).resolves.toBeUndefined();
    expect(mocks.delete).toHaveBeenCalledWith('division-1', tx);
  });

  it('rechaza la eliminacion cuando el nombre no coincide', async () => {
    await expect(divisionService.delete('division-1', owner, 'otra division')).rejects.toMatchObject({
      statusCode: 422,
      message: 'El nombre no coincide. Escribe el nombre de la división para confirmar.',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});

describe('divisiones de solo lectura', () => {
  // resetAllMocks y no clearAllMocks: un test anterior deja un mockRejectedValue pegado en
  // rondaPlayoffDeleteMany, y clear no borra implementaciones.
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));
  });

  // Reiniciar es la excepción al modo solo lectura, junto a coronar: la división se auto-finaliza
  // al cerrarse la final, y es justo ahí donde se reinicia para la temporada siguiente.
  it.each(['FINALIZADA', 'CANCELADA'])('deja reiniciar una división en %s y la devuelve a En Curso', async (codigo) => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext({ estadoLiga: { codigo } }));
    mocks.estadoLigaFindFirst.mockResolvedValue({ id: 'en-curso-1' });

    await divisionService.resetDivision('division-1', owner);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.acquireAccountQuotaLock).toHaveBeenCalledWith(tx, owner.id);
    expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
    expect(mocks.divisionFindFirst.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.observeResourceAccessShadowInTransaction.mock.invocationCallOrder[0]);
    expect(mocks.acquireAccountQuotaLock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.observeResourceAccessShadowInTransaction.mock.invocationCallOrder[0]);
    expect(mocks.observeResourceAccessShadowInTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0]);
    expect(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.jornadaDeleteMany.mock.invocationCallOrder[0]);
    // Sin esto quedaría vacía pero todavía bloqueada, sin poder generar siquiera el cuadro nuevo.
    expect(mocks.divisionUpdate).toHaveBeenCalledWith({ where: { id: 'division-1' }, data: { estadoLigaId: 'en-curso-1' } });
    expect(mocks.assertAccountQuotaDelta).toHaveBeenCalledWith(tx, owner.id, { activeDivisions: 1 });
  });

  it('reiniciar una división en curso no le cambia el estado', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext({ estadoLiga: { codigo: 'EN_CURSO' } }));

    await divisionService.resetDivision('division-1', owner);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.divisionUpdate).not.toHaveBeenCalled();
  });

  it('reiniciar un borrador lo deja en borrador', async () => {
    mocks.divisionFindFirst.mockResolvedValue(divisionContext());

    await divisionService.resetDivision('division-1', owner);

    expect(mocks.divisionUpdate).not.toHaveBeenCalled();
  });
});
