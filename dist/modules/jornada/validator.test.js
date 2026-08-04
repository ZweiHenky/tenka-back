"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validator_1 = require("./validator");
const slot = {
    fecha: '2099-01-31',
    horaInicio: '18:00',
    horaFin: '19:30',
    equipoLocalId: 'team-1',
    equipoVisitanteId: 'team-2',
    tipo: 'regular',
    canchaId: null,
};
(0, vitest_1.describe)('generateNextSchema', () => {
    (0, vitest_1.it)('accepts a strict valid generation request', () => {
        (0, vitest_1.expect)(validator_1.generateNextSchema.safeParse({ slots: [slot], equipoIds: ['team-1', 'team-2'] }).success).toBe(true);
    });
    vitest_1.it.each([
        { ...slot, fecha: '2099-02-29' },
        { ...slot, horaInicio: '24:00' },
        { ...slot, horaFin: '18:7' },
        { ...slot, tipo: 'entrenamiento' },
        { ...slot, equipoLocalId: '' },
        { ...slot, unexpected: true },
    ])('rejects malformed slots', (invalidSlot) => {
        (0, vitest_1.expect)(validator_1.generateNextSchema.safeParse({ slots: [invalidSlot] }).success).toBe(false);
    });
    (0, vitest_1.it)('rejects unknown request fields and duplicate team IDs', () => {
        (0, vitest_1.expect)(validator_1.generateNextSchema.safeParse({ slots: [slot], unknown: true }).success).toBe(false);
        (0, vitest_1.expect)(validator_1.generateNextSchema.safeParse({ equipoIds: ['team-1', 'team-1'] }).success).toBe(false);
    });
});
(0, vitest_1.describe)('idempotencyKeySchema', () => {
    (0, vitest_1.it)('normalizes a valid key and rejects missing, short, or oversized keys', () => {
        (0, vitest_1.expect)(validator_1.idempotencyKeySchema.parse('  generation-key-1  ')).toBe('generation-key-1');
        (0, vitest_1.expect)(validator_1.idempotencyKeySchema.safeParse(undefined).success).toBe(false);
        (0, vitest_1.expect)(validator_1.idempotencyKeySchema.safeParse('short').success).toBe(false);
        (0, vitest_1.expect)(validator_1.idempotencyKeySchema.safeParse('x'.repeat(129)).success).toBe(false);
    });
});
//# sourceMappingURL=validator.test.js.map