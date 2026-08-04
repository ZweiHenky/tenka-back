import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ligaFindFirst: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    liga: { findFirst: mocks.ligaFindFirst },
  },
}));

import { ligaRepository } from './repository';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

describe('consultas de lectura de liga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filtra ligas y divisiones publicadas para anonimos en una operacion Prisma', async () => {
    mocks.ligaFindFirst.mockResolvedValue(null);

    await ligaRepository.findVisibleById('liga-1');

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.ligaFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'liga-1',
        divisiones: { some: { estadoLiga: { nombre: { not: 'Borrador' } } } },
      },
      include: expect.objectContaining({
        divisiones: expect.objectContaining({
          where: { estadoLiga: { nombre: { not: 'Borrador' } } },
        }),
        canchas: expect.objectContaining({ where: { activa: true } }),
      }),
    }));
  });

  it('permite al propietario ver borradores y exige publicacion al resto en la misma consulta', async () => {
    mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1', userId: owner.id, user: { name: 'Owner' } });

    const result = await ligaRepository.findVisibleById('liga-1', owner);

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    const query = mocks.ligaFindFirst.mock.calls[0][0];
    expect(query.where).toEqual({
      id: 'liga-1',
      OR: [
        { userId: owner.id },
        { divisiones: { some: { estadoLiga: { nombre: { not: 'Borrador' } } } } },
      ],
    });
    expect(query.include.divisiones.where).toEqual({
      OR: [
        { estadoLiga: { nombre: { not: 'Borrador' } } },
        { liga: { userId: owner.id } },
      ],
    });
    expect(query.include.canchas.where).toEqual({
      OR: [{ activa: true }, { liga: { userId: owner.id } }],
    });
    expect(result).not.toHaveProperty('user');
  });

  it('no aplica filtros de publicacion al administrador', async () => {
    mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1', userId: 'owner-1' });

    await ligaRepository.findVisibleById('liga-1', admin);

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.ligaFindFirst.mock.calls[0][0]).toMatchObject({
      where: { id: 'liga-1' },
      include: { user: false, divisiones: { where: undefined } },
    });
    expect(mocks.ligaFindFirst.mock.calls[0][0].include.canchas).not.toHaveProperty('where');
  });

  it.each([
    ['propietario', owner, { id: 'liga-1', userId: owner.id }],
    ['administrador', admin, { id: 'liga-1' }],
  ])('selecciona solo canchas y autorizacion para %s en una operacion Prisma', async (_label, actor, where) => {
    mocks.ligaFindFirst.mockResolvedValue({ canchas: [] });

    await expect(ligaRepository.findManageableCanchas('liga-1', actor)).resolves.toEqual([]);

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.ligaFindFirst).toHaveBeenCalledWith({
      where,
      select: {
        canchas: {
          select: { id: true, nombre: true, nombreNormalizado: true, activa: true, createdAt: true, updatedAt: true, ligaId: true },
        },
      },
    });
  });

  it('distingue una liga oculta de una liga existente sin canchas', async () => {
    mocks.ligaFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ canchas: [] });

    await expect(ligaRepository.findManageableCanchas('liga-1', owner)).resolves.toBeNull();
    await expect(ligaRepository.findManageableCanchas('liga-1', owner)).resolves.toEqual([]);
  });

  it.each([
    ['actualizacion', 'findUpdateContext', {
      logo: true,
      logoPublicId: true,
      cancha: true,
      canchaPublicId: true,
      multiplesCanchas: true,
      usaArbitros: true,
      canchas: { select: { id: true, nombre: true, nombreNormalizado: true, activa: true } },
      arbitros: { where: { activo: true }, select: { nombre: true } },
    }],
    ['eliminacion', 'findDeleteContext', {
      logo: true, logoPublicId: true, cancha: true, canchaPublicId: true,
    }],
    ['configuracion', 'findManagementContext', {
      multiplesCanchas: true, usaArbitros: true,
    }],
  ] as const)('selecciona solo el contexto de %s', async (_label, method, select) => {
    mocks.ligaFindFirst.mockResolvedValue({});

    await ligaRepository[method]('liga-1', owner);

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.ligaFindFirst).toHaveBeenCalledWith({
      where: { id: 'liga-1', userId: owner.id },
      select,
    });
  });

  it('selecciona solo arbitros y autorizacion al listar', async () => {
    mocks.ligaFindFirst.mockResolvedValue({ arbitros: [] });

    await expect(ligaRepository.findManageableArbitros('liga-1', admin)).resolves.toEqual([]);

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.ligaFindFirst).toHaveBeenCalledWith({
      where: { id: 'liga-1' },
      select: {
        arbitros: {
          select: { id: true, nombre: true, activo: true, createdAt: true, updatedAt: true, ligaId: true },
        },
      },
    });
  });

  it('obtiene todas las divisiones con categoria y solo su ultima jornada en una operacion Prisma', async () => {
    mocks.ligaFindFirst.mockResolvedValue({
      id: 'liga-1',
      nombre: 'Liga Centro',
      multiplesCanchas: true,
      divisiones: [
        {
          id: 'division-1',
          nombre: 'Primera',
          categoria: { id: 'categoria-1', nombre: 'Libre' },
          jornadas: [{
            id: 'jornada-2',
            numero: 2,
            fechaInicio: null,
            fechaFin: null,
            partidos: [{
              id: 'partido-1',
              fecha: new Date('2026-07-31T20:00:00.000Z'),
              fechaFin: null,
              equipoLocal: { id: 'equipo-1', nombre: 'Local', logo: null },
              equipoVisitante: { id: 'equipo-2', nombre: 'Visitante', logo: 'logo.png' },
              cancha: { id: 'cancha-1', nombre: 'Central' },
            }],
          }],
        },
        {
          id: 'division-2',
          nombre: 'Segunda',
          categoria: { id: 'categoria-2', nombre: 'Femenil' },
          jornadas: [],
        },
      ],
    });

    const result = await ligaRepository.findRecentSchedule('liga-1', owner);

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    const query = mocks.ligaFindFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: 'liga-1', userId: owner.id });
    expect(query.select.multiplesCanchas).toBe(true);
    expect(query.select.divisiones).toMatchObject({
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      select: {
        categoria: { select: { id: true, nombre: true } },
        jornadas: {
          orderBy: [{ numero: 'desc' }, { id: 'asc' }],
          take: 1,
          select: {
            partidos: {
              orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
    expect(query.select.divisiones.select.jornadas.select.partidos.select).not.toHaveProperty('arbitros');
    expect(result?.divisiones[0].categoria).toEqual({ id: 'categoria-1', nombre: 'Libre' });
    expect(result?.multiplesCanchas).toBe(true);
    expect(result?.divisiones[0].jornadas[0].partidos[0]).not.toHaveProperty('arbitros');
    expect(result?.divisiones[1].jornadas).toEqual([]);
  });

  it('autoriza al administrador sin restringir por propietario al consultar la programacion', async () => {
    mocks.ligaFindFirst.mockResolvedValue(null);

    await ligaRepository.findRecentSchedule('liga-1', admin);

    expect(mocks.ligaFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'liga-1' } }));
  });

  it('selecciona solo id al buscar nombres duplicados', async () => {
    mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-2' });

    await ligaRepository.findByNormalizedName('liga centro', 'liga-1');

    expect(mocks.ligaFindFirst).toHaveBeenCalledWith({
      where: { nombreNormalizado: 'liga centro', id: { not: 'liga-1' } },
      select: { id: true },
    });
  });
});
