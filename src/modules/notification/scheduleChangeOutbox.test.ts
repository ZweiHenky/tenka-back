import { describe, expect, it, vi } from 'vitest';
import { collectScheduleChanges, enqueueScheduleChange } from './scheduleChangeOutbox';

describe('schedule change outbox', () => {
  it('collects before and after participants only for material participant changes', () => {
    expect(collectScheduleChanges([
      {
        id: 'unchanged', jornadaId: 'jornada-1',
        expected: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
        data: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
      },
      {
        id: 'changed', jornadaId: 'jornada-2',
        expected: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
        data: { equipoLocalId: 'team-3', equipoVisitanteId: 'team-2' },
      },
    ])).toEqual({
      teamIds: ['team-1', 'team-2', 'team-3'],
      jornadaIds: ['jornada-2'],
      partidoIds: ['changed'],
    });
  });

  it('suppresses an outbox event when every rewrite is a no-op', async () => {
    const tx = { equipo: { findMany: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    await enqueueScheduleChange(tx as any, {
      divisionId: 'division-1', ligaId: 'liga-1',
      changes: collectScheduleChanges([{
        id: 'partido-1', jornadaId: 'jornada-1',
        expected: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
        data: { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
      }]),
    });
    expect(tx.equipo.findMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('deduplicates owners and uses one atomic aggregate upsert with a 30 second debounce', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const tx = {
      equipo: { findMany: vi.fn().mockResolvedValue([
        { userId: 'owner-2' }, { userId: 'owner-1' }, { userId: 'owner-2' },
      ]) }, $queryRaw: vi.fn().mockResolvedValue([{ set_config: 'public' }]),
      $executeRaw: executeRaw,
    };

    await enqueueScheduleChange(tx as any, {
      divisionId: 'division-1', ligaId: 'liga-1',
      changes: { teamIds: ['team-1'], jornadaIds: ['jornada-1'], partidoIds: ['partido-1'] },
    });

    expect(tx.equipo.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['team-1'] } }, select: { userId: true },
    });
    const sql = executeRaw.mock.calls[0][0].join(' ');
    const values = executeRaw.mock.calls[0].slice(1);
    expect(sql).toContain('ON CONFLICT ("aggregationKey") DO UPDATE');
    expect(sql).toContain("INTERVAL '30 seconds'");
    expect(sql).toContain('jsonb_array_elements_text');
    expect(values).toContain('schedule-change:division-1');
    expect(values).toContain('["owner-1","owner-2"]');
  });

  it('does not enqueue when affected teams have no owners', async () => {
    const tx = { equipo: { findMany: vi.fn().mockResolvedValue([]) }, $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    await enqueueScheduleChange(tx as any, {
      divisionId: 'division-1', ligaId: 'liga-1',
      changes: { teamIds: ['team-1'], jornadaIds: ['jornada-1'], partidoIds: ['partido-1'] },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
