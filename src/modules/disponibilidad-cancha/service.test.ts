import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../types/auth';
import { NotFoundError } from '../../utils/errors';
import { DisponibilidadCanchaService } from './service';
import type { DisponibilidadCanchaRepository } from './repository.interface';

const actor: AuthenticatedUser = { id: 'owner', email: 'owner@test.com', rol: 'LIGA' };
const inicio = new Date('2026-08-01T00:00:00.000Z');
const fin = new Date('2026-08-02T00:00:00.000Z');
const assigned = { id: 'p1', fecha: inicio, fechaFin: fin, canchaId: 'court', division: { id: 'd1', nombre: 'Primera' } };
const unassigned = { ...assigned, id: 'p2', canchaId: null };

function repository(context: Awaited<ReturnType<DisponibilidadCanchaRepository['findLeagueContext']>>) {
  return {
    findLeagueContext: vi.fn().mockResolvedValue(context),
    findOccupancy: vi.fn().mockResolvedValue([assigned, unassigned]),
  } satisfies DisponibilidadCanchaRepository;
}

describe('DisponibilidadCanchaService', () => {
  it('returns MULTIPLE assignments keyed by cancha and scheduled matches without cancha separately', async () => {
    const repo = repository({ id: 'liga', multiplesCanchas: true, canchas: [{ id: 'court', nombre: 'Central' }] });
    const result = await new DisponibilidadCanchaService(repo).get('liga', inicio, fin, actor);

    expect(result).toMatchObject({
      mode: 'MULTIPLE',
      canchas: [{ id: 'court', nombre: 'Central' }],
      asignaciones: { court: [assigned] },
      partidosSinCancha: [unassigned],
      ocupaciones: [assigned, unassigned],
    });
    expect(repo.findOccupancy).toHaveBeenCalledWith('liga', inicio, fin);
  });

  it('returns all matches as virtual occupancy and no courts in SINGLE mode', async () => {
    const repo = repository({ id: 'liga', multiplesCanchas: false, canchas: [{ id: 'court', nombre: 'Ignored' }] });
    const result = await new DisponibilidadCanchaService(repo).get('liga', inicio, fin, actor);

    expect(result.mode).toBe('SINGLE');
    expect(result.canchas).toEqual([]);
    expect(result.ocupaciones).toEqual([assigned, unassigned]);
    expect(result.asignaciones).toEqual({});
    expect(result.partidosSinCancha).toEqual([]);
  });

  it('returns 404 semantics without querying matches for missing or foreign leagues', async () => {
    const repo = repository(null);
    await expect(new DisponibilidadCanchaService(repo).get('foreign', inicio, fin, actor))
      .rejects.toEqual(new NotFoundError('Liga'));
    expect(repo.findOccupancy).not.toHaveBeenCalled();
  });
});
