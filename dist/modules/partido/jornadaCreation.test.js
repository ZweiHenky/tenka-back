"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const jornadaCreation_1 = require("./jornadaCreation");
(0, vitest_1.describe)('jornada partido creation helpers', () => {
    (0, vitest_1.it)('counts both regular teams, only the complemento local, and ignores friendlies', () => {
        const covered = (0, jornadaCreation_1.coveredTeamIds)([
            { tipoPartido: 'REGULAR', equipoLocalId: 'a', equipoVisitanteId: 'b' },
            { tipoPartido: 'COMPLEMENTO', equipoLocalId: 'c', equipoVisitanteId: 'd' },
            { tipoPartido: 'AMISTOSO', equipoLocalId: 'e', equipoVisitanteId: 'f' },
        ]);
        (0, vitest_1.expect)([...covered].sort()).toEqual(['a', 'b', 'c']);
    });
    (0, vitest_1.it)('parses configured days including accents and wrapped ranges', () => {
        (0, vitest_1.expect)([...(0, jornadaCreation_1.parseConfiguredDays)('Sábado / Domingo')].sort()).toEqual([0, 6]);
        (0, vitest_1.expect)([...(0, jornadaCreation_1.parseConfiguredDays)('viernes a lunes')].sort()).toEqual([0, 1, 5, 6]);
        (0, vitest_1.expect)([...(0, jornadaCreation_1.parseConfiguredDays)('L-V')].sort()).toEqual([1, 2, 3, 4, 5]);
    });
    (0, vitest_1.it)('parses valid time ranges and ignores malformed or overnight ranges', () => {
        (0, vitest_1.expect)((0, jornadaCreation_1.parseConfiguredRanges)('08:00 - 10:00 / 18:30-20:00 / inválido')).toEqual([
            { start: 480, end: 600 },
            { start: 1110, end: 1200 },
        ]);
    });
    (0, vitest_1.it)('calculates the complete week around the jornada anchor', () => {
        const bounds = (0, jornadaCreation_1.weekBounds)(new Date(2026, 7, 26, 0, 1));
        (0, vitest_1.expect)(bounds.start).toEqual(new Date(2026, 7, 24, 0, 0, 0, 0));
        (0, vitest_1.expect)(bounds.end).toEqual(new Date(2026, 7, 30, 23, 59, 59, 999));
    });
    (0, vitest_1.it)('generates every configured remaining weekday, not only today', () => {
        const candidates = (0, jornadaCreation_1.configuredCandidates)(new Date(2026, 7, 12, 14, 30), new Date(2026, 7, 10, 0, 1), 'America/Mexico_City', (0, jornadaCreation_1.parseConfiguredDays)('L-V'), (0, jornadaCreation_1.parseConfiguredRanges)('18:00 - 20:00'), 60, 0);
        (0, vitest_1.expect)([...new Set(candidates.map(({ fecha }) => fecha))]).toEqual(['2026-08-12', '2026-08-13', '2026-08-14']);
        (0, vitest_1.expect)(candidates).toHaveLength(6);
        (0, vitest_1.expect)(candidates[0]).toMatchObject({ fecha: '2026-08-12', horaInicio: '18:00', horaFin: '19:00' });
    });
    (0, vitest_1.it)('uses every configured day from a future jornada week', () => {
        const candidates = (0, jornadaCreation_1.configuredCandidates)(new Date(2026, 7, 12, 14, 30), new Date(2026, 7, 24, 0, 1), 'America/Mexico_City', (0, jornadaCreation_1.parseConfiguredDays)('L-V'), (0, jornadaCreation_1.parseConfiguredRanges)('18:00 - 19:00'), 60, 0);
        (0, vitest_1.expect)(candidates.map(({ fecha }) => fecha)).toEqual([
            '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
        ]);
    });
    (0, vitest_1.it)('returns no options when the jornada week already ended', () => {
        (0, vitest_1.expect)((0, jornadaCreation_1.configuredCandidates)(new Date(2026, 7, 12, 14, 30), new Date(2026, 7, 3, 0, 1), 'America/Mexico_City', (0, jornadaCreation_1.parseConfiguredDays)('L-V'), (0, jornadaCreation_1.parseConfiguredRanges)('18:00 - 19:00'), 60, 0)).toEqual([]);
    });
});
//# sourceMappingURL=jornadaCreation.test.js.map