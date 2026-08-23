import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ campeonFindMany: vi.fn() }));

vi.mock('../../config/database', () => ({
  prisma: { divisionCampeon: { findMany: mocks.campeonFindMany } },
}));

import { campeonRepository } from './repository';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

describe('palmarés de un equipo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.campeonFindMany.mockResolvedValue([]);
  });

  it('acota por equipo y por visibilidad, más nuevos primero', async () => {
    const filas = [{ id: 'c1' }, { id: 'c2' }];
    mocks.campeonFindMany.mockResolvedValue(filas);

    await expect(campeonRepository.findByEquipo('equipo-1', owner)).resolves.toBe(filas);
    expect(mocks.campeonFindMany).toHaveBeenCalledTimes(1);
    const query = mocks.campeonFindMany.mock.calls[0][0];
    expect(query.where.equipoId).toBe('equipo-1');
    expect(query.orderBy).toEqual({ createdAt: 'desc' });
  });

  // El contrato de seguridad: un campeonato de una división en borrador no puede filtrarse.
  // Con la división viva manda su estado de ahora; si se borró, el snapshot del estado en que se
  // coronó. Esa segunda rama es la que deja sobrevivir al palmarés.
  it('para un anónimo: división visible, o huérfana no coronada en borrador', async () => {
    await campeonRepository.findByEquipo('equipo-1');

    expect(mocks.campeonFindMany.mock.calls[0][0].where.OR).toEqual([
      { division: { estadoLiga: { codigo: { not: 'BORRADOR' } } } },
      { divisionId: null, divisionEstadoCodigo: { not: 'BORRADOR' } },
    ]);
  });

  it('al dueño de la liga le suma sus propias divisiones', async () => {
    await campeonRepository.findByEquipo('equipo-1', owner);

    expect(mocks.campeonFindMany.mock.calls[0][0].where.OR[0].division).toEqual({
      OR: [
        { estadoLiga: { codigo: { not: 'BORRADOR' } } },
        { liga: { userId: owner.id } },
      ],
    });
  });

  it('el administrador no lleva filtro sobre la división viva', async () => {
    await campeonRepository.findByEquipo('equipo-1', admin);

    expect(mocks.campeonFindMany.mock.calls[0][0].where.OR[0].division).toEqual({});
  });

  // Los datos salen de los snapshots, no de la relación: una fila huérfana se dibuja igual.
  it('proyecta los snapshots, no la relación con la división', async () => {
    await campeonRepository.findByEquipo('equipo-1');

    const { select } = mocks.campeonFindMany.mock.calls[0][0];
    expect(Object.keys(select).sort())
      .toEqual(['createdAt', 'divisionId', 'divisionNombre', 'id', 'ligaId', 'ligaLogo', 'ligaNombre']);
    expect(select.division).toBeUndefined();
  });

  // El caso que motivó guardar el estado por título: la legitimidad es de cada título, no de la
  // división. Una división borrada que coronó unos En Curso y otro en Borrador conserva los
  // primeros.
  it('el filtro de huérfanos mira el estado de cada título, no el de la división', async () => {
    await campeonRepository.findByEquipo('equipo-1');

    const huerfanos = mocks.campeonFindMany.mock.calls[0][0].where.OR[1];
    expect(huerfanos).toEqual({ divisionId: null, divisionEstadoCodigo: { not: 'BORRADOR' } });
  });
});

describe('títulos anteriores de una división', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.campeonFindMany.mockResolvedValue([]);
  });

  it('devuelve solo los archivados, más nuevos primero, con la visibilidad embebida', async () => {
    await campeonRepository.findHistorialByDivision('division-1');

    const query = mocks.campeonFindMany.mock.calls[0][0];
    expect(query.where.divisionId).toBe('division-1');
    expect(query.where.archivadoEn).toEqual({ not: null });
    expect(query.where.division).toEqual({ estadoLiga: { codigo: { not: 'BORRADOR' } } });
    expect(query.orderBy).toEqual({ archivadoEn: 'desc' });
  });
});

describe('palmarés de goleo de un jugador', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.campeonFindMany.mockResolvedValue([]);
  });

  it('acota por jugador, más nuevos primero, y trae los goles', async () => {
    await campeonRepository.findByJugador('jugador-1');

    const query = mocks.campeonFindMany.mock.calls[0][0];
    expect(query.where.jugadorId).toBe('jugador-1');
    expect(query.orderBy).toEqual({ createdAt: 'desc' });
    expect(query.select.jugadorGoles).toBe(true);
  });

  // Las dos lecturas comparten `campeonVisibleWhere`. Este test es lo que impide que se separen:
  // si una empezara a filtrar distinto, el palmarés del jugador y el del equipo mostrarían
  // divisiones diferentes de la misma realidad.
  it.each([undefined, owner, admin])('usa el mismo filtro de visibilidad que el equipo (%#)', async (actor) => {
    await campeonRepository.findByEquipo('equipo-1', actor);
    const porEquipo = mocks.campeonFindMany.mock.calls[0][0].where.OR;

    vi.clearAllMocks();
    await campeonRepository.findByJugador('jugador-1', actor);
    const porJugador = mocks.campeonFindMany.mock.calls[0][0].where.OR;

    expect(porJugador).toEqual(porEquipo);
  });

  it('los títulos huérfanos coronados en borrador no se ven', async () => {
    await campeonRepository.findByJugador('jugador-1');

    expect(mocks.campeonFindMany.mock.calls[0][0].where.OR[1])
      .toEqual({ divisionId: null, divisionEstadoCodigo: { not: 'BORRADOR' } });
  });
});
