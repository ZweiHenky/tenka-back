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
  division: { findFirst: mocks.divisionFindFirst, create: mocks.divisionCreate },
  divisionCanchaHorario: { deleteMany: mocks.courtScheduleDeleteMany, upsert: mocks.courtScheduleUpsert },
  divisionNotificationSubscription: { findMany: mocks.subscriptionsFindMany },
  oneSignalTagCleanupJob: { upsert: mocks.cleanupUpsert },
  jornada: { deleteMany: mocks.jornadaDeleteMany },
  rondaPlayoff: { deleteMany: mocks.rondaPlayoffDeleteMany },
  tablaPosicion: { deleteMany: mocks.tablaPosicionDeleteMany },
  partido: { count: mocks.partidoCount },
};

describe('consultas privadas optimizadas de división', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1' });
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, usarPenalesEnEmpates: true });
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
  });

  describe('horarios por cancha', () => {
    const horariosPorCancha = [
      { canchaId: 'court-1', diasPartido: 'lun', horarioPartido: '18:00 - 20:00' },
      { canchaId: 'court-2', diasPartido: 'jue', horarioPartido: '20:00 - 22:00' },
    ];

    it('crea las filas y deriva el resumen bajo el lock de liga', async () => {
      await divisionService.create({ ...createData, estadoLigaId: 'estado-1', horariosPorCancha }, owner);

      expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
      const payload = mocks.divisionCreate.mock.calls[0][0].data;
      // Summary is the union of both courts, for the public listing and older clients.
      expect(payload.diasPartido).toBe('lun, jue');
      expect(payload.horarioPartido).toBe('18:00 - 22:00');
      expect(payload.canchaHorarios.create).toHaveLength(2);
    });

    it('no abre transacción cuando la creación no trae filas', async () => {
      await divisionService.create({ ...createData, estadoLigaId: 'estado-1' }, owner);

      expect(mocks.acquireLeagueScheduleLock).not.toHaveBeenCalled();
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });

    it('al actualizar reemplaza las filas y anula la cancha fija', async () => {
      await divisionService.update('division-1', { horariosPorCancha }, owner);

      expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
      expect(mocks.courtScheduleDeleteMany).toHaveBeenCalledWith({
        where: { divisionId: 'division-1', canchaId: { notIn: ['court-1', 'court-2'] } },
      });
      expect(mocks.courtScheduleUpsert).toHaveBeenCalledTimes(2);
      expect(mocks.update).toHaveBeenCalledWith('division-1', expect.objectContaining({
        diasPartido: 'lun, jue',
        horarioPartido: '18:00 - 22:00',
        canchaUnicaId: null,
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
      expect(written).not.toHaveProperty('canchaUnicaId');
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

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.ligaFindFirst).toHaveBeenCalledWith({ where, select: { id: true } });
    expect(mocks.estadoLigaFindFirstOrThrow).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('selecciona únicamente el id de la configuración Borrador cuando es necesaria', async () => {
    mocks.estadoLigaFindFirstOrThrow.mockResolvedValue({ id: 'borrador-1' });

    await divisionService.create(createData, owner);

    expect(mocks.estadoLigaFindFirstOrThrow).toHaveBeenCalledTimes(1);
    expect(mocks.estadoLigaFindFirstOrThrow).toHaveBeenCalledWith({
      where: { nombre: 'Borrador' },
      select: { id: true },
    });
    expect(mocks.create).toHaveBeenCalledWith({ ...createData, estadoLigaId: 'borrador-1' });
  });

  it.each([
    ['propietario', owner, { id: 'division-1', liga: { userId: owner.id } }],
    ['administrador', admin, { id: 'division-1' }],
  ])('autoriza una actualización en una consulta estrecha para %s', async (_label, actor, where) => {
    await divisionService.update('division-1', { nombre: 'Nueva' }, actor);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({ where, select: { id: true, ligaId: true, canchaUnicaId: true, registrarParticipaciones: true, usarPenalesEnEmpates: true } });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('guarda una cancha fija activa de la misma liga', async () => {
    mocks.ligaCanchaFindFirst.mockResolvedValue({ ligaId: 'liga-1', activa: true, liga: { multiplesCanchas: true } });

    await divisionService.update('division-1', { canchaUnicaId: 'court-1' }, owner);

    expect(mocks.update).toHaveBeenCalledWith('division-1', { canchaUnicaId: 'court-1' });
  });

  it.each([
    [{ ligaId: 'otra-liga', activa: true, liga: { multiplesCanchas: true } }, 'no pertenece a esta liga'],
    [{ ligaId: 'liga-1', activa: false, liga: { multiplesCanchas: true } }, 'no está activa'],
    [{ ligaId: 'liga-1', activa: true, liga: { multiplesCanchas: false } }, 'no tiene múltiples canchas'],
  ])('rechaza una cancha fija inválida', async (cancha, message) => {
    mocks.ligaCanchaFindFirst.mockResolvedValue(cancha);

    await expect(divisionService.update('division-1', { canchaUnicaId: 'court-1' }, owner)).rejects.toThrow(message);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('limpia la cancha fija al mover la división a otra liga', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: 'court-1' });

    await divisionService.update('division-1', { ligaId: 'liga-2' }, owner);

    expect(mocks.update).toHaveBeenCalledWith('division-1', { ligaId: 'liga-2', canchaUnicaId: null });
  });

  it('siempre bloquea la liga y relee la división cuando se envía registrarParticipaciones', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, registrarParticipaciones: false });

    await divisionService.update('division-1', { registrarParticipaciones: true }, owner);

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
    expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledTimes(1);
    expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.divisionFindFirst.mock.invocationCallOrder[1]);
    expect(mocks.update).toHaveBeenCalledWith('division-1', { registrarParticipaciones: true }, tx);
  });

  it('también bloquea cuando el valor preflight de registrarParticipaciones parece idéntico', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, registrarParticipaciones: true });

    await divisionService.update('division-1', { registrarParticipaciones: true }, owner);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
    expect(mocks.update).toHaveBeenCalledWith('division-1', { registrarParticipaciones: true }, tx);
  });

  it('permite cambiar la regla de penales antes de finalizar partidos', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null,
      registrarParticipaciones: false, usarPenalesEnEmpates: true,
    });

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
    mocks.divisionFindFirst.mockResolvedValue({
      id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null,
      registrarParticipaciones: false, usarPenalesEnEmpates: true,
    });
    mocks.partidoCount.mockResolvedValue(1);

    await expect(divisionService.update('division-1', { usarPenalesEnEmpates: false }, owner))
      .rejects.toThrow('ya tiene partidos finalizados');

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('reautoriza después del lock y no escribe si cambió el propietario', async () => {
    mocks.divisionFindFirst
      .mockResolvedValueOnce({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, registrarParticipaciones: false })
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
      .mockResolvedValueOnce({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, registrarParticipaciones: false })
      .mockResolvedValueOnce({ id: 'division-1', ligaId: 'liga-3', canchaUnicaId: null, registrarParticipaciones: false });

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

  it('ejecuta las tres limpiezas del reset en una transacción después de una sola autorización', async () => {
    await divisionService.resetDivision('division-1', owner);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', liga: { userId: owner.id } },
      select: { id: true },
    });
    expect(mocks.jornadaDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.jornadaDeleteMany).toHaveBeenCalledWith({ where: { divisionId: 'division-1' } });
    expect(mocks.rondaPlayoffDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.tablaPosicionDeleteMany).toHaveBeenCalledOnce();
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
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1', nombre: 'Primera' });
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
