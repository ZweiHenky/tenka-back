import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  ligaFindUnique: vi.fn(),
  tandaFindFirst: vi.fn(),
  tandaCreate: vi.fn(),
  tandaDelete: vi.fn(),
  linksFindMany: vi.fn(),
  linksCreateMany: vi.fn(),
  divisionFindMany: vi.fn(),
  refereeFindMany: vi.fn(),
  assignmentsFindMany: vi.fn(),
  assignmentsDeleteMany: vi.fn(),
  assignmentsCreateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    liga: { findUnique: db.ligaFindUnique },
    tandaArbitral: { findFirst: db.tandaFindFirst, delete: db.tandaDelete },
    tandaArbitralPartido: { findMany: db.linksFindMany },
    division: { findMany: db.divisionFindMany },
    ligaArbitro: { findMany: db.refereeFindMany },
    partidoArbitro: { findMany: db.assignmentsFindMany, deleteMany: db.assignmentsDeleteMany },
    $transaction: db.transaction,
  },
}));

import { arbitrajeService, planLeagueAssignments, overlaps } from './service';
import { asignacionesLigaSchema } from './validator';

const at = (hour: number, minute = 0) => new Date(2026, 6, 26, hour, minute);
const owner = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' as const };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (callback) => callback({
    tandaArbitral: { create: db.tandaCreate },
    tandaArbitralPartido: { findMany: db.linksFindMany, createMany: db.linksCreateMany },
    partidoArbitro: { deleteMany: db.assignmentsDeleteMany, createMany: db.assignmentsCreateMany },
  }));
});

describe('direct league assignments', () => {
  const divisions = [
    { id: 'd1', partidos: [{ id: 'm1', fecha: at(9), fechaFin: at(10) }, { id: 'm2', fecha: at(10), fechaFin: at(11) }] },
  ];

  it('saves direct assignments and creates their history record in one transaction', async () => {
    db.ligaFindUnique.mockResolvedValue({ userId: 'user-1' });
    db.divisionFindMany.mockResolvedValue([{ id: 'd1', jornadas: [{ partidos: divisions[0].partidos }], rondasPlayoff: [] }]);
    db.refereeFindMany.mockResolvedValue([{ id: 'a', nombre: 'Ana' }]);
    db.assignmentsFindMany.mockResolvedValue([]);
    db.linksFindMany.mockResolvedValue([]);
    db.tandaCreate.mockResolvedValue({ id: 'batch-1' });

    const result = await arbitrajeService.replaceLeagueAssignments('league-1', owner, {
      divisionIds: ['d1'], asignaciones: [{ partidoId: 'm1', arbitroIds: ['a'] }],
    });

    expect(db.linksCreateMany).toHaveBeenCalledWith({ data: [{ tandaId: 'batch-1', partidoId: 'm1' }] });
    expect(db.assignmentsDeleteMany).toHaveBeenCalledWith({ where: { partidoId: { in: ['m1'] } } });
    expect(db.assignmentsCreateMany).toHaveBeenCalledWith({ data: [{ partidoId: 'm1', arbitroId: 'a' }] });
    expect(result).toMatchObject({ asignacionId: 'batch-1', partidosAsignados: 1, asignacionesCreadas: 1 });
  });

  it('deletes assignment referee rows and history in one transaction', async () => {
    db.ligaFindUnique.mockResolvedValue({ userId: 'user-1' });
    db.tandaFindFirst.mockResolvedValue({ id: 'batch-1', ligaId: 'league-1', liga: { userId: 'user-1' } });
    db.linksFindMany.mockResolvedValue([{ partidoId: 'm1' }, { partidoId: 'm2' }]);
    const removeRows = { operation: 'remove-rows' };
    const removeHistory = { operation: 'remove-history' };
    db.assignmentsDeleteMany.mockReturnValue(removeRows);
    db.tandaDelete.mockReturnValue(removeHistory);
    db.transaction.mockResolvedValue([]);

    await arbitrajeService.removeAssignment('league-1', 'batch-1', owner);

    expect(db.assignmentsDeleteMany).toHaveBeenCalledWith({ where: { partidoId: { in: ['m1', 'm2'] } } });
    expect(db.tandaDelete).toHaveBeenCalledWith({ where: { id: 'batch-1' } });
    expect(db.transaction).toHaveBeenCalledWith([removeRows, removeHistory]);
  });

  it('allows an administrator to manage a foreign league', async () => {
    db.ligaFindUnique.mockResolvedValue({ userId: 'user-1' });
    db.divisionFindMany.mockResolvedValue([]);
    db.refereeFindMany.mockResolvedValue([]);
    db.assignmentsFindMany.mockResolvedValue([]);
    db.linksFindMany.mockResolvedValue([]);
    db.tandaCreate.mockResolvedValue({ id: 'batch-1' });

    await expect(arbitrajeService.replaceLeagueAssignments('league-1', admin, {
      divisionIds: [], asignaciones: [],
    })).resolves.toMatchObject({ asignacionId: 'batch-1' });
  });

  it('checks ownership and batch membership once when editing', async () => {
    db.tandaFindFirst.mockResolvedValue({ id: 'batch-1', ligaId: 'league-1', liga: { userId: 'user-1' } });
    db.linksFindMany.mockResolvedValue([{ partidoId: 'm1' }]);
    db.divisionFindMany.mockResolvedValue([{ id: 'd1', jornadas: [{ partidos: divisions[0].partidos }], rondasPlayoff: [] }]);
    db.refereeFindMany.mockResolvedValue([{ id: 'a', nombre: 'Ana' }]);
    db.assignmentsFindMany.mockResolvedValue([]);

    await arbitrajeService.replaceLeagueAssignments('league-1', owner, {
      asignacionId: 'batch-1', divisionIds: ['d1'], asignaciones: [{ partidoId: 'm1', arbitroIds: ['a'] }],
    });

    expect(db.tandaFindFirst).toHaveBeenCalledTimes(1);
    expect(db.ligaFindUnique).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.assignmentsDeleteMany).toHaveBeenCalledWith({ where: { partidoId: { in: ['m1'] } } });
    expect(db.assignmentsCreateMany).toHaveBeenCalledWith({ data: [{ partidoId: 'm1', arbitroId: 'a' }] });
  });

  it('parses the replacement payload and allows back-to-back assignments', () => {
    expect(overlaps(at(9), at(10), at(10), at(11))).toBe(false);
    const payload = asignacionesLigaSchema.parse({
      divisionIds: ['d1'],
      asignaciones: [{ partidoId: 'm1', arbitroIds: ['a'] }, { partidoId: 'm2', arbitroIds: ['a', 'b'] }],
    });
    expect(planLeagueAssignments(payload.divisionIds, payload.asignaciones, divisions, ['a', 'b'])).toEqual([
      { partidoId: 'm1', arbitroId: 'a' },
      { partidoId: 'm2', arbitroId: 'a' },
      { partidoId: 'm2', arbitroId: 'b' },
    ]);
    expect(asignacionesLigaSchema.parse({ ...payload, asignacionId: 'batch-1' }).asignacionId).toBe('batch-1');
  });

  it('rejects duplicate ids and entities outside the selected league scope', () => {
    expect(() => planLeagueAssignments(['d1', 'd1'], [], divisions, [])).toThrow('divisiones no pueden repetirse');
    expect(() => planLeagueAssignments(['d1'], [{ partidoId: 'm1', arbitroIds: [] }, { partidoId: 'm1', arbitroIds: [] }], divisions, [])).toThrow('partidos no pueden repetirse');
    expect(() => planLeagueAssignments(['d1'], [{ partidoId: 'other', arbitroIds: [] }], divisions, [])).toThrow('división seleccionada');
    expect(() => planLeagueAssignments(['d1'], [{ partidoId: 'm1', arbitroIds: ['other'] }], divisions, ['a'])).toThrow('activos y pertenecer');
    expect(() => planLeagueAssignments(['d1'], [{ partidoId: 'm1', arbitroIds: ['a', 'a'] }], divisions, ['a'])).toThrow('repetirse en un partido');
  });

  it('requires valid dates for assigned matches and rejects overlap', () => {
    expect(() => planLeagueAssignments(['d1'], [{ partidoId: 'm1', arbitroIds: ['a'] }], [{ id: 'd1', partidos: [{ id: 'm1', fecha: null, fechaFin: null }] }], ['a'])).toThrow('fecha y fechaFin válidas');
    expect(() => planLeagueAssignments(['d1'], [{ partidoId: 'm1', arbitroIds: ['a'] }, { partidoId: 'm2', arbitroIds: ['a'] }], [{ id: 'd1', partidos: [{ id: 'm1', fecha: at(9), fechaFin: at(11) }, { id: 'm2', fecha: at(10), fechaFin: at(12) }] }], ['a'])).toThrow('traslapados');
  });

  it('rejects overlap with an assignment already saved elsewhere in the league', () => {
    expect(() => planLeagueAssignments(['d1'], [{ partidoId: 'm1', arbitroIds: ['a'] }], divisions, ['a'], [
      { arbitroId: 'a', fecha: at(9, 30), fechaFin: at(10, 30) },
    ])).toThrow('traslapados');
  });
});

describe('private assignment reads', () => {
  const refereeRow = { arbitro: { id: 'a', nombre: 'Ana' } };
  const match = {
    id: 'm1', fecha: at(9), fechaFin: at(10), equipoLocal: null, equipoVisitante: null, cancha: null, arbitros: [refereeRow],
  };

  it('lists batches with ownership and counts in one query', async () => {
    const batches = [{ id: 'batch-1', ligaId: 'league-1', nombre: 'Asignación', _count: { partidos: 2 } }];
    db.ligaFindUnique.mockResolvedValue({ userId: 'user-1', tandasArbitrales: batches });

    await expect(arbitrajeService.list('league-1', owner)).resolves.toEqual(batches);

    expect(db.ligaFindUnique).toHaveBeenCalledTimes(1);
    expect(db.tandaFindFirst).not.toHaveBeenCalled();
    expect(db.ligaFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ userId: true, tandasArbitrales: expect.any(Object) }),
    }));
  });

  it('loads an owned batch detail in one query without exposing the ownership relation', async () => {
    db.tandaFindFirst.mockResolvedValue({
      id: 'batch-1', ligaId: 'league-1', nombre: 'Asignación', liga: { userId: 'user-1' },
      partidos: [{ tandaId: 'batch-1', partidoId: 'm1', partido: { ...match, jornada: null, rondaPlayoff: null } }],
    });

    const result = await arbitrajeService.detail('league-1', 'batch-1', owner);

    expect(db.tandaFindFirst).toHaveBeenCalledTimes(1);
    expect(db.ligaFindUnique).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('liga');
    expect(result.partidos[0].arbitros).toEqual([{ id: 'a', nombre: 'Ana' }]);
  });

  it('loads candidates in one narrow query and restores existing parent response fields', async () => {
    db.ligaFindUnique.mockResolvedValue({
      userId: 'user-1',
      divisiones: [{
        id: 'd1', nombre: 'Primera',
        jornadas: [{ id: 'j1', numero: 1, partidos: [match] }],
        rondasPlayoff: [{ id: 'r1', nombre: 'Final', orden: 1, partidos: [{ ...match, id: 'm2' }] }],
      }],
    });

    const result = await arbitrajeService.candidates('league-1', owner);

    expect(db.ligaFindUnique).toHaveBeenCalledTimes(1);
    expect(db.divisionFindMany).not.toHaveBeenCalled();
    expect(result[0].jornadas[0].partidos[0]).toMatchObject({
      jornada: { id: 'j1', numero: 1, division: { id: 'd1', nombre: 'Primera' } }, rondaPlayoff: null,
      arbitros: [{ id: 'a', nombre: 'Ana' }],
    });
    expect(result[0].rondasPlayoff[0].partidos[0]).toMatchObject({
      jornada: null, rondaPlayoff: { id: 'r1', nombre: 'Final', division: { id: 'd1', nombre: 'Primera' } },
    });
    const query = db.ligaFindUnique.mock.calls[0][0];
    const jornadaMatch = query.select.divisiones.select.jornadas.select.partidos;
    expect(jornadaMatch.include).not.toHaveProperty('jornada');
    expect(jornadaMatch.include).not.toHaveProperty('rondaPlayoff');
  });
});
