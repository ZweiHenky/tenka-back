import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findVisibleByDivision: vi.fn(),
  upsert: vi.fn(),
  deleteByDivision: vi.fn(),
  divisionFindUnique: vi.fn(),
  rondaFindFirst: vi.fn(),
  divisionEquipoFindUnique: vi.fn(),
  goleadores: vi.fn(),
}));

vi.mock('./repository', () => ({ campeonRepository: mocks }));
vi.mock('../goleadores/service', () => ({ goleadoresService: { findByDivision: mocks.goleadores } }));
vi.mock('../../config/database', () => ({
  prisma: {
    division: { findUnique: mocks.divisionFindUnique },
    rondaPlayoff: { findFirst: mocks.rondaFindFirst },
    divisionEquipo: { findUnique: mocks.divisionEquipoFindUnique },
  },
}));

import { campeonService } from './service';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };

function cuadroTerminado() {
  mocks.rondaFindFirst.mockResolvedValue({ partidos: [{ estado: 'FINALIZADO' }, { estado: 'FINALIZADO' }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.divisionFindUnique.mockResolvedValue({ registrarGoleo: true, liga: { userId: owner.id } });
  mocks.divisionEquipoFindUnique.mockResolvedValue({ equipo: { nombre: 'Cuauhtémoc', logo: 'logo.png' } });
  mocks.upsert.mockImplementation(async (divisionId: string, data: unknown) => ({ id: 'campeon-1', divisionId, ...(data as object) }));
  cuadroTerminado();
});

describe('lectura', () => {
  it('devuelve null cuando la división es visible pero todavía no tiene campeón', async () => {
    mocks.findVisibleByDivision.mockResolvedValue({ campeon: null });
    await expect(campeonService.findByDivision('division-1', owner)).resolves.toBeNull();
  });

  it('devuelve 404 cuando la división no existe o está oculta', async () => {
    mocks.findVisibleByDivision.mockResolvedValue(null);
    await expect(campeonService.findByDivision('division-1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'División no encontrado',
    });
  });
});

describe('asignación', () => {
  it('rechaza asignar mientras la última ronda no esté terminada', async () => {
    mocks.rondaFindFirst.mockResolvedValue({ partidos: [{ estado: 'FINALIZADO' }, { estado: 'PROGRAMADO' }] });

    await expect(campeonService.assign('division-1', { equipoId: 'equipo-1' }, owner)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Termina todos los partidos de la última ronda antes de asignar al campeón.',
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rechaza asignar cuando la división no tiene cuadro', async () => {
    mocks.rondaFindFirst.mockResolvedValue(null);

    await expect(campeonService.assign('division-1', { equipoId: 'equipo-1' }, owner)).rejects.toMatchObject({ statusCode: 422 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rechaza un equipo que no está inscrito en la división', async () => {
    mocks.divisionEquipoFindUnique.mockResolvedValue(null);

    await expect(campeonService.assign('division-1', { equipoId: 'ajeno' }, owner)).rejects.toMatchObject({
      statusCode: 422,
      message: 'El equipo no pertenece a esta división.',
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('guarda el campeón sin goleador y no consulta la tabla de goleo', async () => {
    const guardado = await campeonService.assign('division-1', { equipoId: 'equipo-1' }, owner);

    expect(mocks.goleadores).not.toHaveBeenCalled();
    expect(guardado).toMatchObject({
      equipoId: 'equipo-1',
      equipoNombre: 'Cuauhtémoc',
      equipoLogo: 'logo.png',
      jugadorId: null,
      jugadorNombre: null,
      jugadorGoles: null,
    });
  });

  it('rechaza un goleador que no tiene goles en la división', async () => {
    mocks.goleadores.mockResolvedValue({ rows: [{ jugadorId: 'otro', nombre: 'Otro', foto: null, goles: 3 }] });

    await expect(campeonService.assign('division-1', { equipoId: 'equipo-1', jugadorId: 'sin-goles' }, owner)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Ese jugador no tiene goles registrados en la división.',
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  // Los snapshots los escribe el servidor: un nombre o un conteo venidos del cliente serían
  // falsificables, y el equipo o el jugador pueden borrarse después.
  it('toma nombre, foto y goles de la tabla de goleo, no del cliente', async () => {
    mocks.goleadores.mockResolvedValue({ rows: [{ jugadorId: 'jugador-1', nombre: 'Ronaldo', foto: 'foto.png', goles: 12 }] });

    const guardado = await campeonService.assign(
      'division-1',
      { equipoId: 'equipo-1', jugadorId: 'jugador-1', jugadorNombre: 'Impostor', jugadorGoles: 99 } as never,
      owner,
    );

    expect(guardado).toMatchObject({ jugadorId: 'jugador-1', jugadorNombre: 'Ronaldo', jugadorFoto: 'foto.png', jugadorGoles: 12 });
  });

  it('reasignar reemplaza en vez de duplicar', async () => {
    await campeonService.assign('division-1', { equipoId: 'equipo-1' }, owner);
    mocks.divisionEquipoFindUnique.mockResolvedValue({ equipo: { nombre: 'Halcones', logo: null } });
    await campeonService.assign('division-1', { equipoId: 'equipo-2' }, owner);

    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.upsert).toHaveBeenLastCalledWith('division-1', expect.objectContaining({ equipoId: 'equipo-2', equipoNombre: 'Halcones' }));
  });

  it('exige ser dueño de la liga', async () => {
    mocks.divisionFindUnique.mockResolvedValue({ registrarGoleo: true, liga: { userId: 'otro-usuario' } });

    await expect(campeonService.assign('division-1', { equipoId: 'equipo-1' }, owner)).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  // Con la tabla de goleo apagada no se muestra en ningún lado, así que el premio no tendría
  // dónde verse.
  it('rechaza un goleador si la división tiene la tabla de goleo desactivada', async () => {
    mocks.divisionFindUnique.mockResolvedValue({ registrarGoleo: false, liga: { userId: owner.id } });

    await expect(campeonService.assign('division-1', { equipoId: 'equipo-1', jugadorId: 'jugador-1' }, owner)).rejects.toMatchObject({
      statusCode: 422,
      message: 'La división tiene la tabla de goleo desactivada.',
    });
    expect(mocks.goleadores).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('con el goleo desactivado el campeón de equipo se asigna igual', async () => {
    mocks.divisionFindUnique.mockResolvedValue({ registrarGoleo: false, liga: { userId: owner.id } });

    await expect(campeonService.assign('division-1', { equipoId: 'equipo-1' }, owner)).resolves.toMatchObject({ equipoId: 'equipo-1', jugadorId: null });
  });
});

describe('quitar el título', () => {
  it('borra por división y es idempotente', async () => {
    await campeonService.remove('division-1', owner);
    expect(mocks.deleteByDivision).toHaveBeenCalledWith('division-1');
  });

  it('exige ser dueño de la liga', async () => {
    mocks.divisionFindUnique.mockResolvedValue({ registrarGoleo: true, liga: { userId: 'otro-usuario' } });
    await expect(campeonService.remove('division-1', owner)).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.deleteByDivision).not.toHaveBeenCalled();
  });
});

// La excepción deliberada: coronar es el acto de cierre. Bloquearlo en Finalizada haría
// imposible cerrar una división después de marcarla como tal.
describe('la división finalizada no bloquea al campeón', () => {
  it('permite asignarlo con la división de solo lectura', async () => {
    mocks.divisionFindUnique.mockResolvedValue({ registrarGoleo: true, estadoLiga: { codigo: 'FINALIZADA' }, liga: { userId: owner.id } });

    await expect(campeonService.assign('division-1', { equipoId: 'equipo-1' }, owner))
      .resolves.toMatchObject({ equipoId: 'equipo-1' });
  });

  it('permite quitarlo también', async () => {
    mocks.divisionFindUnique.mockResolvedValue({ registrarGoleo: true, estadoLiga: { codigo: 'FINALIZADA' }, liga: { userId: owner.id } });

    await campeonService.remove('division-1', owner);
    expect(mocks.deleteByDivision).toHaveBeenCalledWith('division-1');
  });
});
