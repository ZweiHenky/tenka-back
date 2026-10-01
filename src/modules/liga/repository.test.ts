import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ligaFindFirst: vi.fn(),
  ligaFindMany: vi.fn(),
  ligaCount: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    liga: { findFirst: mocks.ligaFindFirst, findMany: mocks.ligaFindMany, count: mocks.ligaCount },
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
        divisiones: { some: { estadoLiga: { codigo: { not: 'BORRADOR' } } } },
      },
      include: expect.objectContaining({
        divisiones: expect.objectContaining({
          where: { estadoLiga: { codigo: { not: 'BORRADOR' } } },
        }),
        canchas: expect.objectContaining({ where: { activa: true } }),
      }),
    }));
  });

  // La página pública se ve igual para todos: si al dueño le mostrara sus borradores, no habría
  // forma de comprobar qué ve el público.
  it('tampoco le muestra borradores al propietario, aunque pueda abrir su liga', async () => {
    mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1', userId: owner.id, user: { name: 'Owner' } });

    const result = await ligaRepository.findVisibleById('liga-1', owner);

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    const query = mocks.ligaFindFirst.mock.calls[0][0];
    // El dueño sigue pudiendo abrir la liga aunque no tenga ninguna división publicada.
    expect(query.where).toEqual({
      id: 'liga-1',
      OR: [
        { userId: owner.id },
        { divisiones: { some: { estadoLiga: { codigo: { not: 'BORRADOR' } } } } },
      ],
    });
    expect(query.include.divisiones.where).toEqual({ estadoLiga: { codigo: { not: 'BORRADOR' } } });
    // Sin esto el detalle no puede dibujar el selector de cancha.
    expect(query.include.divisiones.include).toHaveProperty('canchaHorarios');
    // Sin `codigo` la vista pública no distingue el formato y le muestra a un cuadro puro una
    // tabla de posiciones que nunca se va a llenar.
    expect(query.include.divisiones.include.tipoCompetencia)
      .toEqual({ select: { id: true, nombre: true, codigo: true } });
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
      userId: true, nombre: true, logo: true, logoPublicId: true, cancha: true, canchaPublicId: true,
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

  it('usa una proyeccion publica ligera para la lista paginada', async () => {
    mocks.ligaFindMany.mockResolvedValue([]);
    mocks.ligaCount.mockResolvedValue(0);

    await ligaRepository.findAllPaginated({ page: 1, limit: 5 });

    const select = mocks.ligaFindMany.mock.calls[0][0].select;
    expect(select).toEqual(expect.objectContaining({ id: true, nombre: true, descripcion: true, logo: true, cancha: true, ubicacionId: true }));
    expect(select.ubicacion).toEqual({ select: { nombreCompleto: true } });
    expect(select).not.toHaveProperty('user');
    expect(select).not.toHaveProperty('canchas');
    expect(select).not.toHaveProperty('arbitros');
    expect(select.divisiones.select).toEqual(expect.objectContaining({ id: true, nombre: true, maxEquipos: true, arbitraje: true }));
    // La tarjeta lo muestra junto al tipo, así que la proyección lo trae; el resto sigue liviano.
    expect(select.divisiones.select.tipoCompetencia).toEqual({ select: { id: true, nombre: true } });
  });

  it('usa un desempate estable por id sin coordenadas', async () => {
    mocks.ligaFindMany.mockResolvedValue([]);
    mocks.ligaCount.mockResolvedValue(0);

    await ligaRepository.findAllPaginated({ page: 2, limit: 5 });

    expect(mocks.ligaFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 5,
      take: 5,
    }));
  });

  it('usa la proyeccion minima de tarjetas para las ligas del propietario', async () => {
    mocks.ligaFindMany.mockResolvedValue([]);

    await ligaRepository.findByUser(owner.id);

    expect(mocks.ligaFindMany).toHaveBeenCalledWith({
      where: { userId: owner.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, nombre: true, logo: true },
    });
  });
});
