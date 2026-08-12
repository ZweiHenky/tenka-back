import { describe, expect, it } from 'vitest';
import { configuredCandidates, coveredTeamIds, parseConfiguredDays, parseConfiguredRanges, weekBounds } from './jornadaCreation';

describe('jornada partido creation helpers', () => {
  it('counts both regular teams, only the complemento local, and ignores friendlies', () => {
    const covered = coveredTeamIds([
      { tipoPartido: 'REGULAR', equipoLocalId: 'a', equipoVisitanteId: 'b' },
      { tipoPartido: 'COMPLEMENTO', equipoLocalId: 'c', equipoVisitanteId: 'd' },
      { tipoPartido: 'AMISTOSO', equipoLocalId: 'e', equipoVisitanteId: 'f' },
    ]);

    expect([...covered].sort()).toEqual(['a', 'b', 'c']);
  });

  it('parses configured days including accents and wrapped ranges', () => {
    expect([...parseConfiguredDays('Sábado / Domingo')].sort()).toEqual([0, 6]);
    expect([...parseConfiguredDays('viernes a lunes')].sort()).toEqual([0, 1, 5, 6]);
    expect([...parseConfiguredDays('L-V')].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses valid time ranges and ignores malformed or overnight ranges', () => {
    expect(parseConfiguredRanges('08:00 - 10:00 / 18:30-20:00 / inválido')).toEqual([
      { start: 480, end: 600 },
      { start: 1110, end: 1200 },
    ]);
  });

  it('calculates the complete week around the jornada anchor', () => {
    const bounds = weekBounds(new Date(2026, 7, 26, 0, 1));

    expect(bounds.start).toEqual(new Date(2026, 7, 24, 0, 0, 0, 0));
    expect(bounds.end).toEqual(new Date(2026, 7, 30, 23, 59, 59, 999));
  });

  it('generates every configured remaining weekday, not only today', () => {
    const candidates = configuredCandidates(
      new Date(2026, 7, 12, 14, 30),
      new Date(2026, 7, 10, 0, 1),
      parseConfiguredDays('L-V'),
      parseConfiguredRanges('18:00 - 20:00'),
      60,
      0,
    );

    expect([...new Set(candidates.map(({ fecha }) => fecha))]).toEqual(['2026-08-12', '2026-08-13', '2026-08-14']);
    expect(candidates).toHaveLength(6);
    expect(candidates[0]).toMatchObject({ fecha: '2026-08-12', horaInicio: '18:00', horaFin: '19:00' });
  });

  it('uses every configured day from a future jornada week', () => {
    const candidates = configuredCandidates(
      new Date(2026, 7, 12, 14, 30),
      new Date(2026, 7, 24, 0, 1),
      parseConfiguredDays('L-V'),
      parseConfiguredRanges('18:00 - 19:00'),
      60,
      0,
    );

    expect(candidates.map(({ fecha }) => fecha)).toEqual([
      '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
    ]);
  });

  it('returns no options when the jornada week already ended', () => {
    expect(configuredCandidates(
      new Date(2026, 7, 12, 14, 30),
      new Date(2026, 7, 3, 0, 1),
      parseConfiguredDays('L-V'),
      parseConfiguredRanges('18:00 - 19:00'),
      60,
      0,
    )).toEqual([]);
  });
});
