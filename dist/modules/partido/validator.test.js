"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validator_1 = require("./validator");
(0, vitest_1.describe)('partido createInJornadaSchema', () => {
    const base = {
        equipoLocalId: 'team-1',
        equipoVisitanteId: 'team-2',
        tipoPartido: 'REGULAR',
        fecha: '2026-08-13',
        horaInicio: '20:00',
        horaFin: '21:00',
        canchaId: null,
    };
    (0, vitest_1.it)('accepts the same civil date and time contract as jornada generation', () => {
        (0, vitest_1.expect)(validator_1.createInJornadaSchema.safeParse(base).success).toBe(true);
    });
    (0, vitest_1.it)('rejects ISO instants and missing civil times', () => {
        (0, vitest_1.expect)(validator_1.createInJornadaSchema.safeParse({ ...base, fecha: '2026-08-14T02:00:00.000Z' }).success).toBe(false);
        const { horaInicio: _horaInicio, ...withoutStart } = base;
        (0, vitest_1.expect)(validator_1.createInJornadaSchema.safeParse(withoutStart).success).toBe(false);
    });
});
(0, vitest_1.describe)('partido updateSchema', () => {
    vitest_1.it.each(['canchaId', 'fecha', 'fechaFin'])('rejects structural field %s', (field) => {
        (0, vitest_1.expect)(validator_1.updateSchema.safeParse({ [field]: '2099-01-01T18:00:00.000Z' }).success).toBe(false);
    });
    (0, vitest_1.it)('keeps score and one-team swap updates available', () => {
        (0, vitest_1.expect)(validator_1.updateSchema.safeParse({ golesLocal: 2, golesVisitante: 1 }).success).toBe(true);
        (0, vitest_1.expect)(validator_1.updateSchema.safeParse({ equipoLocalId: 'team-2' }).success).toBe(true);
    });
});
(0, vitest_1.describe)('partido resultSchema participaciones', () => {
    const base = { expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0, allocations: [] };
    (0, vitest_1.it)('accepts participaciones with side and player', () => {
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }] }).success).toBe(true);
    });
    (0, vitest_1.it)('accepts an empty participaciones list and treats the field as optional', () => {
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, participaciones: [] }).success).toBe(true);
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse(base).success).toBe(true);
    });
    (0, vitest_1.it)('rejects a participacion without a player or with an empty id', () => {
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, participaciones: [{ ladoMarcador: 'LOCAL' }] }).success).toBe(false);
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: '' }] }).success).toBe(false);
    });
});
(0, vitest_1.describe)('partido resultSchema notas', () => {
    const base = { expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0, allocations: [] };
    (0, vitest_1.it)('accepts an optional notas field', () => {
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, notas: 'Incidencias del partido' }).success).toBe(true);
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, notas: null }).success).toBe(true);
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse(base).success).toBe(true);
    });
    (0, vitest_1.it)('trims notas and converts an empty string to null', () => {
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, notas: '' }).data?.notas).toBeNull();
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, notas: '   ' }).data?.notas).toBeNull();
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, notas: '  texto  ' }).data?.notas).toBe('texto');
    });
    (0, vitest_1.it)('rejects notas longer than 1000 characters', () => {
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, notas: 'x'.repeat(1001) }).success).toBe(false);
        (0, vitest_1.expect)(validator_1.resultSchema.safeParse({ ...base, notas: 'x'.repeat(1000) }).success).toBe(true);
    });
});
//# sourceMappingURL=validator.test.js.map